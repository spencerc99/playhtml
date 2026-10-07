// ABOUTME: Renders matched live scenes with individual gain-path suspects disabled.
// ABOUTME: Saves listening probes and envelope measurements without changing production tuning.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { liveScene, renderScene, SPENCER_ARRANGEMENT } from "./clickScan";
import { measurePumping, verifyPumpingDetector } from "./pumpingDetector";
import { scanForClicks } from "./clickDetector";
import { PROGRESSIONS } from "../../extension/website/shared/sound/scales";
import type { SoundEngine } from "../../extension/website/shared/sound/SoundEngine";

// Diagnostic access stays in this renderer; production has no bypass switches.
interface GainControls {
  compressor: DynamicsCompressorNode;
  breathGainScale: () => number;
  updateMasterGainForPolyphony: (count: number) => void;
}

function writeWave(buffer: AudioBuffer, file: string): void {
  const channels = buffer.numberOfChannels;
  const bytes = buffer.length * channels * 2;
  const wave = Buffer.alloc(44 + bytes);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(36 + bytes, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(channels, 22);
  wave.writeUInt32LE(buffer.sampleRate, 24);
  wave.writeUInt32LE(buffer.sampleRate * channels * 2, 28);
  wave.writeUInt16LE(channels * 2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(bytes, 40);
  const samples = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = samples[channel][i];
      if (Math.abs(sample) > 1) throw new Error(`Clipping in ${file}`);
      wave.writeInt16LE(Math.round(sample * 32767), 44 + (i * channels + channel) * 2);
    }
  }
  writeFileSync(file, wave);
}

const output = resolve(dirname(fileURLToPath(import.meta.url)), "../../internal-docs/sound-samples/live-fix-probes");
mkdirSync(output, { recursive: true });
verifyPumpingDetector();
const variants = ["baseline", "compressor-off", "duck-fixed", "breath-off", "input-smoothed"] as const;
const rows = [];
const selectors = process.argv.slice(2);
const dwell = Object.values(PROGRESSIONS).map((progression) => [progression, progression.dwellScale] as const);
try {
  for (const [progression, scale] of dwell) progression.dwellScale = scale * 0.4;
  for (const { count, churn } of [{ count: 6, churn: false }, { count: 12, churn: false }, { count: 12, churn: true }]) {
    for (const variant of variants) {
      if (selectors.length && !selectors.includes(variant)) continue;
      const scene = {
        ...liveScene(`pump-live-${count}`, "presence", 40, { trailCount: count, reviveTrails: true, soloistChurn: true }),
        config: SPENCER_ARRANGEMENT,
        cantus: "tenor" as const,
      };
      const advance = scene.advance;
      const counts = new Set<number>();
      const positions = new Map<number, { x: number; y: number; ms: number }>();
      scene.advance = (engine, ms) => {
        const frames = advance(engine, ms);
        const active = churn && Math.floor(ms / 330) % 2 === 1
          ? frames.filter((frame) => frame.trailIndex % 2 === 0)
          : frames;
        counts.add(active.length);
        if (variant !== "input-smoothed") return active;
        const present = new Set(active.map((frame) => frame.trailIndex));
        for (const index of positions.keys()) if (!present.has(index)) positions.delete(index);
        return active.map((frame) => {
          const previous = positions.get(frame.trailIndex);
          const alpha = previous ? 1 - Math.exp(-(ms - previous.ms) / 100) : 1;
          const x = previous ? previous.x + alpha * (frame.x - previous.x) : frame.x;
          const y = previous ? previous.y + alpha * (frame.y - previous.y) : frame.y;
          positions.set(frame.trailIndex, { x, y, ms });
          return { ...frame, x, y, prevX: x, prevY: y };
        });
      };
      const buffer = await renderScene(scene, (engine: SoundEngine) => {
        const controls = engine as unknown as GainControls;
        if (variant === "compressor-off") controls.compressor.ratio.value = 1;
        if (variant === "breath-off") controls.breathGainScale = () => 1;
        if (variant === "duck-fixed") {
          const update = controls.updateMasterGainForPolyphony.bind(engine);
          controls.updateMasterGainForPolyphony = () => update(count);
        }
      });
      const file = `live-${count}${churn ? "-churn" : ""}-${variant}.wav`;
      const clicks = scanForClicks(buffer, file);
      const row = { file, trailCounts: [...counts].sort((a, b) => a - b), ...measurePumping(buffer), clicks: clicks.hits.length, peak: clicks.peak };
      rows.push(row);
      console.log(JSON.stringify(row));
      writeWave(buffer, resolve(output, file));
      if (clicks.hits.length) process.exitCode = 1;
    }
  }
} finally {
  for (const [progression, scale] of dwell) progression.dwellScale = scale;
}
writeFileSync(resolve(output, selectors.length ? "pumping-selected-results.json" : "pumping-results.json"), JSON.stringify(rows, null, 2) + "\n");
