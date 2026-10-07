// ABOUTME: Renders A/B pairs of the live portrait with and without input-edge EMA position smoothing.
// ABOUTME: Listening preview for the proposed live-input smoothing, rendered without touching the engine.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { OfflineAudioContext } from "node-web-audio-api";
import { SoundEngine } from "../../extension/website/shared/sound/SoundEngine";
import { PROGRESSIONS } from "../../extension/website/shared/sound/scales";
import type {
  CantusVariant,
  SoloistVoice,
  TrailSoundFrame,
} from "../../extension/website/shared/sound/types";
import { scanForClicks, type ScanReport } from "./clickDetector";
import { scanForFlutter, type FlutterReport } from "./flutterDetector";

const SAMPLE_RATE = 44_100;
const CHANNEL_COUNT = 2;
const CANVAS_WIDTH = 1_200;
const CANVAS_HEIGHT = 800;
const VOLUME = 0.5;
const REPLAY_FPS = 60;

/** Preview length. Long enough to cross several chord rotations and batches. */
const PREVIEW_SECONDS = 60;

/**
 * The chord dwell the previews run at, matching the scan renderer's, so the
 * harmony moves inside a minute rather than sitting on one chord throughout.
 */
const DEMO_CHORD_DWELL_MS = 8_000;
const BASE_CHORD_DWELL_MS = 20_000;

/**
 * Time constant of the input-edge position EMA, in ms.
 *
 * The proposal's range is 80-120ms; 100ms sits in the middle. The engine's own
 * soloist velocity EMA already runs at 120ms
 * (`SPOTLIGHT_TUNING.velocitySmoothingMs`), so a shorter constant here keeps
 * the two from stacking into one long lag while still removing the per-frame
 * step that a rebased batch puts into a single tick.
 */
const SMOOTHING_TAU_MS = 100;

Object.assign(globalThis, {
  window: { innerWidth: CANVAS_WIDTH, innerHeight: CANVAS_HEIGHT },
});

const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const hash = (value: string): number => {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
};

interface DrivenContext {
  audioContext: OfflineAudioContext;
  setClock: (seconds: number) => void;
}

const createDrivenContext = (durationSeconds: number): DrivenContext => {
  const audioContext = new OfflineAudioContext(
    CHANNEL_COUNT,
    Math.ceil(durationSeconds * SAMPLE_RATE),
    SAMPLE_RATE,
  );
  Object.defineProperty(audioContext, "state", { value: "running" });

  let clockSeconds = 0;
  Object.defineProperty(audioContext, "currentTime", {
    get: () => clockSeconds,
    configurable: true,
  });

  return {
    audioContext,
    setClock: (seconds: number) => {
      clockSeconds = seconds;
    },
  };
};

const REPLAY_COLORS = [
  "#4a9a8a",
  "#c4724e",
  "#5b8db8",
  "#d4b85c",
  "#8a6fa8",
  "#6f8a4a",
];

/**
 * The arrangement Spencer listens to: spotlight and cursor instruments off, so
 * the sustained bed carries the mix and every trail holds one continuously
 * updated voice. That is where an input-edge jitter shows up as gain wobble
 * rather than being buried under a soloist.
 */
const SPENCER_ARRANGEMENT = {
  mode: "spotlight",
  spotlight: false,
  cursorInstruments: false,
  choralTimbre: true,
  bassPedal: true,
  swells: true,
  chordVoicing: true,
  trailVoices: true,
  chordRotation: true,
  energyArc: true,
  trailArrivals: true,
  navigationSounds: true,
  crossings: "off",
} as const;

interface Scene {
  id: string;
  durationSeconds: number;
  soloistVoice: SoloistVoice;
  advance: (engine: SoundEngine, sampleMs: number) => TrailSoundFrame[];
  nextStepMs?: (sampleMs: number) => number;
  config?: Record<string, unknown>;
  cantus?: CantusVariant;
}

/** The cadence the live portrait ticks the engine on. Mirrors `clickScan.ts`. */
const liveStepMs = (random: () => number) => {
  let nextBatchMs = 0;
  let nextStallMs = 3_000;
  return (sampleMs: number): number => {
    if (sampleMs >= nextStallMs) {
      nextStallMs = sampleMs + 2_400 + random() * 2_600;
      return 200 + random() * 300;
    }
    if (sampleMs >= nextBatchMs) {
      nextBatchMs = sampleMs + 850 + random() * 400;
      return 45 + random() * 55;
    }
    return 8 + random() * 22;
  };
};

const LIVE_BATCH_INTERVAL_MS = 1_000;

/**
 * The live portrait as the engine experiences it: heads rebased whenever a
 * WebSocket batch lands, clicks arriving in bursts on the batch boundary, and
 * an irregular tick interval underneath. Mirrors `liveScene` in `clickScan.ts`.
 */
const liveScene = (
  id: string,
  soloistVoice: SoloistVoice,
  durationSeconds: number,
  { trailCount = 6, allText = false, soloistChurn = false } = {},
): Scene => {
  const random = seededRandom(hash(`live-${id}`));

  interface LiveTrail {
    trailIndex: number;
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    approach: number;
    lastBatchMs: number;
    settled: boolean;
    firstSeen: boolean;
  }

  const trails: LiveTrail[] = [];
  for (let index = 0; index < trailCount; index++) {
    trails.push({
      trailIndex: index,
      x: CANVAS_WIDTH * random(),
      y: CANVAS_HEIGHT * random(),
      targetX: CANVAS_WIDTH * random(),
      targetY: CANVAS_HEIGHT * random(),
      approach: 0.04,
      lastBatchMs: 0,
      settled: false,
      firstSeen: true,
    });
  }

  let nextBatchMs = 0;
  let lastClickMs = 0;
  let batchCount = 0;

  return {
    id,
    durationSeconds,
    soloistVoice,
    nextStepMs: liveStepMs(random),
    advance: (engine, sampleMs) => {
      if (sampleMs >= nextBatchMs) {
        nextBatchMs = sampleMs + LIVE_BATCH_INTERVAL_MS;
        const batchIndex = batchCount++;
        for (const trail of trails) {
          if (random() >= 0.55) continue;
          trail.lastBatchMs = sampleMs;
          trail.settled = false;
          trail.targetX = CANVAS_WIDTH * random();
          trail.targetY = CANVAS_HEIGHT * random();
          const isRunner = soloistChurn
            ? trail.trailIndex === batchIndex % trails.length
            : trail.trailIndex === 0;
          trail.approach = isRunner
            ? 0.22 + random() * 0.2
            : 0.01 + random() * 0.03;
          trail.x += (trail.targetX - trail.x) * (isRunner ? 0.35 : 0.08);
          trail.y += (trail.targetY - trail.y) * (isRunner ? 0.35 : 0.08);
        }

        const burst = 1 + Math.floor(random() * 4);
        for (let index = 0; index < burst; index++) {
          engine.triggerClick({
            x: CANVAS_WIDTH * random(),
            y: CANVAS_HEIGHT * random(),
            holdDuration: random() < 0.25 ? 200 + random() * 900 : undefined,
          });
        }
        if (random() < 0.4) {
          engine.triggerNavigation({ x: CANVAS_WIDTH * random() });
        }
      }

      if (sampleMs - lastClickMs > 300 && random() < 0.15) {
        lastClickMs = sampleMs;
        engine.triggerClick({
          x: CANVAS_WIDTH * random(),
          y: CANVAS_HEIGHT * random(),
          holdDuration: undefined,
        });
      }

      const frames: TrailSoundFrame[] = [];
      for (const trail of trails) {
        if (sampleMs - trail.lastBatchMs > 8_000) {
          if (!trail.settled) {
            trail.settled = true;
            engine.retireTrail(trail.trailIndex);
          }
          continue;
        }

        trail.x += (trail.targetX - trail.x) * trail.approach;
        trail.y += (trail.targetY - trail.y) * trail.approach;

        frames.push({
          trailIndex: trail.trailIndex,
          x: trail.x,
          y: trail.y,
          prevX: trail.x,
          prevY: trail.y,
          cursorType:
            allText || trail.trailIndex % 3 === 0 ? "text" : "default",
          progress: 0,
          color: REPLAY_COLORS[trail.trailIndex % REPLAY_COLORS.length],
          isNewlyActive: trail.firstSeen,
          identityKey: `live-${trail.trailIndex}`,
        });
        trail.firstSeen = false;
      }
      return frames;
    },
  };
};

/**
 * The replay control: trails interpolated off a timeline already in memory and
 * ticked on a smooth 60fps clock. There is no per-frame jitter for the
 * smoothing to remove, so it should be nearly inaudible here.
 */
const sweepScene = (
  id: string,
  soloistVoice: SoloistVoice,
  durationSeconds: number,
  { trailCount = 6 } = {},
): Scene => {
  const random = seededRandom(hash(`sweep-${id}`));
  const phases: number[] = [];
  const rates: number[] = [];
  for (let index = 0; index < trailCount; index++) {
    phases.push(random() * Math.PI * 2);
    rates.push(0.35 + random() * 0.9);
  }
  let lastClickMs = 0;

  return {
    id,
    durationSeconds,
    soloistVoice,
    advance: (engine, sampleMs) => {
      if (sampleMs - lastClickMs > 700) {
        lastClickMs = sampleMs;
        engine.triggerClick({
          x: CANVAS_WIDTH * random(),
          y: CANVAS_HEIGHT * random(),
          holdDuration: random() < 0.25 ? 200 + random() * 900 : undefined,
        });
      }

      const seconds = sampleMs / 1_000;
      const frames: TrailSoundFrame[] = [];
      for (let index = 0; index < trailCount; index++) {
        const x =
          CANVAS_WIDTH * (0.5 + 0.48 * Math.sin(seconds * rates[index] + phases[index]));
        const y =
          CANVAS_HEIGHT *
          (0.5 + 0.4 * Math.cos(seconds * rates[index] * 0.83 + phases[index]));
        frames.push({
          trailIndex: index,
          x,
          y,
          prevX: x,
          prevY: y,
          cursorType: index % 3 === 0 ? "text" : "default",
          progress: 0,
          color: REPLAY_COLORS[index % REPLAY_COLORS.length],
          isNewlyActive: sampleMs < 1 / REPLAY_FPS,
          identityKey: `sweep-${index}`,
        });
      }
      return frames;
    },
  };
};

/**
 * The proposed input-edge smoothing, as a pre-processing pass over the frame
 * stream. Nothing inside the engine changes: the frames it is handed simply
 * carry a smoothed head position instead of the raw streamed one.
 *
 * Per trail, per tick, with `dt` the tick interval in ms:
 *
 *   alpha = 1 - exp(-dt / TAU)
 *   sx += (rawX - sx) * alpha
 *   sy += (rawY - sy) * alpha
 *
 * The exponential form is what makes this a real time constant rather than a
 * per-frame fraction. The live cadence hands the engine intervals from 8ms to
 * 500ms, so a fixed alpha would smooth hard on the dense frames and barely at
 * all across a stall, which is the opposite of what is wanted: the long frames
 * are exactly the ones a rebased batch lands on. With the exponential form,
 * `alpha` approaches 1 as `dt` grows past TAU, so a tick that covers more than
 * a time constant of real time simply adopts the new position — no lag is
 * accumulated across a stall.
 *
 * The engine derives velocity from the difference between the position it was
 * handed last tick and this one, so smoothing the position is exactly
 * smoothing the per-frame delta it divides by the tick interval.
 *
 * A trail's first frame seeds the filter at its raw position rather than at
 * zero, so an arriving trail does not sweep in from the canvas origin.
 */
const smoothFrames = (tau: number) => {
  const state = new Map<number, { x: number; y: number }>();
  let lastSampleMs: number | null = null;

  return (frames: TrailSoundFrame[], sampleMs: number): TrailSoundFrame[] => {
    const dt = lastSampleMs === null ? 1_000 / REPLAY_FPS : sampleMs - lastSampleMs;
    lastSampleMs = sampleMs;
    const alpha = 1 - Math.exp(-Math.max(0, dt) / tau);

    const live = new Set<number>();
    const smoothed = frames.map((frame) => {
      live.add(frame.trailIndex);
      const previous = state.get(frame.trailIndex);
      if (previous === undefined) {
        state.set(frame.trailIndex, { x: frame.x, y: frame.y });
        return frame;
      }
      previous.x += (frame.x - previous.x) * alpha;
      previous.y += (frame.y - previous.y) * alpha;
      return { ...frame, x: previous.x, y: previous.y, prevX: previous.x, prevY: previous.y };
    });

    // A trail that stops being reported has settled; the next frame carrying
    // its index is a new arrival and must reseed rather than continue from a
    // stale head.
    for (const index of [...state.keys()]) {
      if (!live.has(index)) state.delete(index);
    }

    return smoothed;
  };
};

const renderScene = async (
  scene: Scene,
  smoothing: boolean,
): Promise<AudioBuffer> => {
  Math.random = seededRandom(hash(scene.id));
  const { audioContext, setClock } = createDrivenContext(scene.durationSeconds);
  const engine = new SoundEngine(audioContext as unknown as BaseAudioContext);
  await engine.init();
  engine.setCanvasWidth(CANVAS_WIDTH);
  engine.setVolume(VOLUME);
  engine.setConfig({
    ...SPENCER_ARRANGEMENT,
    soloistVoice: scene.soloistVoice,
    ...scene.config,
  });
  if (scene.cantus) engine.setCantus(scene.cantus);

  const smooth = smoothing ? smoothFrames(SMOOTHING_TAU_MS) : null;
  const stepMs = 1_000 / REPLAY_FPS;
  const endMs = scene.durationSeconds * 1_000;
  for (let sampleMs = 0; sampleMs <= endMs; ) {
    setClock(sampleMs / 1_000);
    const raw = scene.advance(engine, sampleMs);
    engine.tick(sampleMs, smooth ? smooth(raw, sampleMs) : raw);
    sampleMs += scene.nextStepMs ? scene.nextStepMs(sampleMs) : stepMs;
  }

  return (await audioContext.startRendering()) as unknown as AudioBuffer;
};

const encodeWave = (buffer: AudioBuffer): Uint8Array => {
  const bytesPerSample = 2;
  const frameCount = buffer.length;
  const dataSize = frameCount * CHANNEL_COUNT * bytesPerSample;
  const wave = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wave);

  const writeText = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNEL_COUNT, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * CHANNEL_COUNT * bytesPerSample, true);
  view.setUint16(32, CHANNEL_COUNT * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: CHANNEL_COUNT }, (_, channel) =>
    buffer.getChannelData(channel),
  );
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
      view.setInt16(offset, sample < 0 ? sample * 32_768 : sample * 32_767, true);
      offset += bytesPerSample;
    }
  }

  return new Uint8Array(wave);
};

interface PairStats {
  peakRaw: number;
  peakSmoothed: number;
  peakDifference: number;
  rmsRaw: number;
  rmsSmoothed: number;
  rmsDifference: number;
}

/**
 * Peak and RMS of each buffer, plus of their sample-by-sample difference.
 *
 * The difference measures are the ones that carry the control claim: two
 * renders that sound the same but were rendered independently still differ by
 * more than nothing, and the honest number for "how much did smoothing change
 * this" is the level of what was added or removed, not the change in the
 * summary level of each side.
 */
const comparePair = (raw: AudioBuffer, smoothed: AudioBuffer): PairStats => {
  const frameCount = Math.min(raw.length, smoothed.length);
  let peakRaw = 0;
  let peakSmoothed = 0;
  let peakDifference = 0;
  let sumRaw = 0;
  let sumSmoothed = 0;
  let sumDifference = 0;
  let count = 0;

  for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
    const a = raw.getChannelData(channel);
    const b = smoothed.getChannelData(channel);
    for (let frame = 0; frame < frameCount; frame++) {
      const difference = a[frame] - b[frame];
      peakRaw = Math.max(peakRaw, Math.abs(a[frame]));
      peakSmoothed = Math.max(peakSmoothed, Math.abs(b[frame]));
      peakDifference = Math.max(peakDifference, Math.abs(difference));
      sumRaw += a[frame] * a[frame];
      sumSmoothed += b[frame] * b[frame];
      sumDifference += difference * difference;
      count++;
    }
  }

  return {
    peakRaw,
    peakSmoothed,
    peakDifference,
    rmsRaw: Math.sqrt(sumRaw / count),
    rmsSmoothed: Math.sqrt(sumSmoothed / count),
    rmsDifference: Math.sqrt(sumDifference / count),
  };
};

const decibels = (ratio: number): string =>
  ratio <= 0 ? "-inf dB" : `${(20 * Math.log10(ratio)).toFixed(1)} dB`;

const reportScan = (
  label: string,
  scan: ScanReport,
  flutter: FlutterReport,
): void => {
  console.log(
    `${label.padEnd(30)} clicks ${String(scan.hits.length).padStart(4)}  ` +
      `max ratio ${scan.maxRatio.toFixed(4)}  peak ${scan.peak.toFixed(4)}  ` +
      `flutter ${String(flutter.hits.length).padStart(4)} max depth ${flutter.maxDepth.toFixed(3)}`,
  );
};

const outputDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../internal-docs/sound-samples/smoothing-preview",
);

/**
 * Each pair builds its scene through a factory rather than holding one scene
 * object, because a scene is stateful: it closes over its own seeded generator,
 * its trail positions and its batch counter. Rendering the same object twice
 * would hand the second render a generator that the first had already run to
 * exhaustion and trails parked wherever the first render left them, so the two
 * sides of the pair would be different scenes and the comparison meaningless.
 */
const PAIRS: Array<{
  id: string;
  makeScene: () => Scene;
  rawFile: string;
  smoothedFile: string;
}> = [
  {
    id: "live-spencer",
    makeScene: () => ({
      ...liveScene("live-spencer", "presence", PREVIEW_SECONDS),
      cantus: "tenor" as CantusVariant,
    }),
    rawFile: "raw-live-1.wav",
    smoothedFile: "smoothed-live-1.wav",
  },
  {
    id: "live-spencer-dense",
    makeScene: () => ({
      ...liveScene("live-spencer-dense", "presence", PREVIEW_SECONDS, {
        trailCount: 12,
        soloistChurn: true,
      }),
      cantus: "duet" as CantusVariant,
    }),
    rawFile: "raw-live-2.wav",
    smoothedFile: "smoothed-live-2.wav",
  },
  {
    id: "sweeps-spencer",
    makeScene: () => ({
      ...sweepScene("sweeps-spencer", "presence", PREVIEW_SECONDS),
      cantus: "tenor" as CantusVariant,
    }),
    rawFile: "control-raw.wav",
    smoothedFile: "control-smoothed.wav",
  },
];

const originalDwellScales = new Map(
  Object.values(PROGRESSIONS).map((progression) => [
    progression.id,
    progression.dwellScale,
  ]),
);
for (const progression of Object.values(PROGRESSIONS)) {
  progression.dwellScale =
    (originalDwellScales.get(progression.id) ?? 1) *
    (DEMO_CHORD_DWELL_MS / BASE_CHORD_DWELL_MS);
}

let totalClicks = 0;
try {
  mkdirSync(outputDirectory, { recursive: true });

  console.log(
    `smoothing: alpha = 1 - exp(-dt / ${SMOOTHING_TAU_MS}ms), applied per trail ` +
      `to the head position before engine.tick\n`,
  );

  for (const pair of PAIRS) {
    const raw = await renderScene(pair.makeScene(), false);
    const smoothed = await renderScene(pair.makeScene(), true);

    writeFileSync(resolve(outputDirectory, pair.rawFile), encodeWave(raw));
    writeFileSync(
      resolve(outputDirectory, pair.smoothedFile),
      encodeWave(smoothed),
    );

    const stats = comparePair(raw, smoothed);
    console.log(`${pair.id}`);
    console.log(
      `  peak      raw ${stats.peakRaw.toFixed(4)}  smoothed ${stats.peakSmoothed.toFixed(4)}  ` +
        `difference ${stats.peakDifference.toFixed(4)} (${decibels(stats.peakDifference)})`,
    );
    console.log(
      `  rms       raw ${stats.rmsRaw.toFixed(4)}  smoothed ${stats.rmsSmoothed.toFixed(4)}  ` +
        `difference ${stats.rmsDifference.toFixed(4)} (${decibels(stats.rmsDifference)}, ` +
        `${decibels(stats.rmsDifference / stats.rmsRaw)} relative to raw)`,
    );

    for (const [label, buffer] of [
      [`${pair.id} raw`, raw],
      [`${pair.id} smoothed`, smoothed],
    ] as const) {
      const scan = scanForClicks(buffer, label);
      const flutter = scanForFlutter(buffer, label);
      reportScan(`  ${label}`, scan, flutter);
      totalClicks += scan.hits.length;
    }
    console.log("");
  }
} finally {
  for (const progression of Object.values(PROGRESSIONS)) {
    progression.dwellScale = originalDwellScales.get(progression.id) ?? 1;
  }
}

console.log(`wrote ${PAIRS.length * 2} files to ${outputDirectory}`);
console.log(`total clicks across all renders: ${totalClicks}`);
if (totalClicks > 0) process.exitCode = 1;
