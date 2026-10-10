// ABOUTME: Renders the morning listening kit under Spencer's saved arrangement, varying only the soloist voice.
// ABOUTME: Scans every rendered buffer for clicks and writes the kit's README beside the WAV files.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OfflineAudioContext } from "node-web-audio-api";
import { SoundEngine } from "../../extension/website/shared/sound/SoundEngine";
import { PROGRESSIONS } from "../../extension/website/shared/sound/scales";
import type { SoloistVoice } from "../../extension/website/shared/sound/SoundEngine";
import type { TrailSoundFrame } from "../../extension/website/shared/sound/types";
import {
  buildMoveTracks,
  interpolateTrackPosition,
  type MoveTrack,
  type SampleEvent,
} from "../../extension/website/sounds/SamplePlayback";
import fixtureEvents from "../../extension/website/sounds/sampleEvents.json";
import { scanForClicks, type ScanReport } from "./clickDetector";

const SAMPLE_RATE = 44_100;
const CHANNEL_COUNT = 2;
const CANVAS_WIDTH = 1_200;
const CANVAS_HEIGHT = 800;
const REPLAY_FPS = 60;
const TRAIL_IDLE_TIMEOUT_MS = 4_000;

/**
 * Chord dwell used while rendering, in ms. The shipped base is 20s, which a
 * minute-long listen never gets past — the whole kit would sit on one chord.
 * Applied by overriding each progression's `dwellScale` for this process only;
 * the shipped constant is untouched and the scales are restored on exit, as
 * both the sample renderer and the click scanner do.
 */
const DEMO_CHORD_DWELL_MS = 8_000;
const BASE_CHORD_DWELL_MS = 20_000;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(
  scriptDirectory,
  "../../internal-docs/sound-samples/morning",
);

Object.assign(globalThis, {
  window: { innerWidth: CANVAS_WIDTH, innerHeight: CANVAS_HEIGHT },
});

/**
 * Spencer's saved arrangement, split the way the playground stores it: scene
 * globals and layer settings go to `setConfig`, and `cantus`, `volume` and
 * `voicing` are applied through their own calls, `voicing` being read by the
 * driver at trigger time.
 *
 * `spotlight` is deliberately absent from the globals: the engine derives it
 * from `mode`, and setting it explicitly would suppress that derivation.
 */
const ARRANGEMENT = {
  globals: {
    mode: "spotlight",
    chordRotation: true,
    progression: "dorian",
    energyArc: true,
    trailVoices: true,
    swells: true,
    choralTimbre: true,
    cursorInstruments: true,
    traceability: 0,
  },
  layers: {
    bassPedal: true,
    trailArrivals: true,
    navigationSounds: true,
    crossings: "off",
  },
  cantus: "soprano",
  voicing: { click: "bells", hold: "rootFifth" },
  volume: 0.5,
} as const;

/** How the kit's README describes that arrangement. */
const CONFIG_SUMMARY =
  "mode spotlight, chordRotation on, progression dorian, energyArc on, " +
  "trailVoices on, swells on, choralTimbre on, cursorInstruments on, " +
  "traceability 0, volume 0.5; bassPedal on, trailArrivals on, " +
  "navigationSounds on, crossings off; cantus soprano; " +
  `click bells, hold timp. rootFifth; chord dwell ${DEMO_CHORD_DWELL_MS / 1_000}s`;

const REPLAY_COLORS = [
  "#4a9a8a",
  "#c4724e",
  "#5b8db8",
  "#d4b85c",
  "#8a6fa8",
  "#6f8a4a",
];

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

const peakOf = (buffer: AudioBuffer): number => {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index++) {
      peak = Math.max(peak, Math.abs(samples[index]));
    }
  }
  return peak;
};

const toDbfs = (amplitude: number): number =>
  amplitude === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(amplitude);

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
      view.setInt16(
        offset,
        sample < 0 ? sample * 32_768 : sample * 32_767,
        true,
      );
      offset += bytesPerSample;
    }
  }

  return new Uint8Array(wave);
};

/**
 * An offline context whose clock the caller drives, so a synchronous replay
 * renders as the timeline it represents rather than stacking onto instant
 * zero. Same construction the sample renderer and the click scanner use.
 */
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

interface ReplayTrail {
  trailIndex: number;
  pid: string;
  color: string;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  cursorType: string | undefined;
  lastEventMs: number;
  firstSeen: boolean;
  searchIndex: number;
}

const fixture = fixtureEvents as SampleEvent[];

/**
 * The fixture's busiest `windowMs`, rebased to zero.
 *
 * The candidate renders deliberately pick a calm slice so one instrument under
 * test stays audible. A morning listen wants the opposite: the densest stretch
 * the archive contains, because that is where the voice count, the promotion
 * churn and the note budget are all under the most pressure — the same window
 * the click scanner runs against.
 */
const busiestSlice = (
  events: SampleEvent[],
  windowMs: number,
): SampleEvent[] => {
  let bestStart = 0;
  let bestCount = 0;
  let end = 0;

  for (let start = 0; start < events.length; start++) {
    if (end < start) end = start;
    while (end < events.length && events[end].t < events[start].t + windowMs) {
      end++;
    }
    if (end - start > bestCount) {
      bestCount = end - start;
      bestStart = start;
    }
  }

  const slice = events.slice(bestStart, bestStart + bestCount);
  const origin = slice[0].t;
  return slice.map((event) => ({ ...event, t: event.t - origin }));
};

/** A scene the engine is driven through, as a function from tick time to frames. */
interface Scene {
  id: string;
  durationSeconds: number;
  advance: (engine: SoundEngine, sampleMs: number) => TrailSoundFrame[];
}

const fixtureScene = (id: string, durationSeconds: number): Scene => {
  const events = busiestSlice(fixture, durationSeconds * 1_000);
  const tracks: Map<string, MoveTrack> = buildMoveTracks(events);
  const trails = new Map<string, ReplayTrail>();
  let nextTrailIndex = 0;
  let cursor = 0;

  return {
    id,
    durationSeconds,
    advance: (engine, sampleMs) => {
      while (cursor < events.length && events[cursor].t <= sampleMs) {
        const event = events[cursor++];
        const x = (event.x ?? 0.5) * CANVAS_WIDTH;
        const y = (event.y ?? 0.5) * CANVAS_HEIGHT;

        if (event.type === "navigation") {
          if (event.event === "focus" || event.event === "popstate") {
            engine.triggerNavigation({ x });
          }
          continue;
        }
        if (event.type !== "cursor") continue;

        let trail = trails.get(event.pid);
        if (!trail) {
          const trailIndex = nextTrailIndex++;
          trail = {
            trailIndex,
            pid: event.pid,
            color: REPLAY_COLORS[trailIndex % REPLAY_COLORS.length],
            x,
            y,
            prevX: x,
            prevY: y,
            cursorType: event.cursor,
            lastEventMs: sampleMs,
            firstSeen: true,
            searchIndex: 0,
          };
          trails.set(event.pid, trail);
        }

        trail.lastEventMs = sampleMs;
        if (event.cursor) trail.cursorType = event.cursor;

        if (event.event !== "click" && event.event !== "hold") continue;

        // The voicing the pad's driver applies: a timpani hold voice takes the
        // hold, and the bell click voice takes everything else.
        const isHold = event.event === "hold" || event.duration !== undefined;
        if (isHold) {
          engine.triggerHold(
            x,
            ARRANGEMENT.voicing.hold,
            event.duration === undefined ? undefined : event.duration / 1_000,
          );
        } else {
          engine.triggerClick({ x, y, holdDuration: event.duration });
        }
      }

      for (const trail of trails.values()) {
        const track = tracks.get(trail.pid);
        if (!track) continue;
        const position = interpolateTrackPosition(
          track,
          sampleMs,
          trail.searchIndex,
        );
        if (!position) continue;
        trail.searchIndex = position.index;
        trail.prevX = trail.x;
        trail.prevY = trail.y;
        trail.x = position.x * CANVAS_WIDTH;
        trail.y = position.y * CANVAS_HEIGHT;
        if (position.cursor) trail.cursorType = position.cursor;
      }

      for (const [pid, trail] of trails) {
        if (sampleMs - trail.lastEventMs > TRAIL_IDLE_TIMEOUT_MS) {
          engine.retireTrail(trail.trailIndex);
          trails.delete(pid);
        }
      }

      const frames: TrailSoundFrame[] = [];
      for (const trail of trails.values()) {
        frames.push({
          trailIndex: trail.trailIndex,
          x: trail.x,
          y: trail.y,
          prevX: trail.prevX,
          prevY: trail.prevY,
          cursorType: trail.cursorType,
          progress: 0,
          color: trail.color,
          isNewlyActive: trail.firstSeen,
          identityKey: `morning-${trail.pid}`,
        });
        trail.firstSeen = false;
      }
      return frames;
    },
  };
};

/** How many trails the synthetic scene runs, well past a real archive day. */
const SWEEP_TRAIL_COUNT = 10;
/** How often a different trail is handed the fast sweep, in ms. */
const SWEEP_HANDOVER_MS = 900;
/** How often the synthetic scene fires a click, in ms. */
const SWEEP_CLICK_INTERVAL_MS = 120;

/**
 * The synthetic worst case, identical to the click scanner's sweep scene: many
 * trails, one sweeping fast enough to take the spotlight, the sweep handed on
 * every `SWEEP_HANDOVER_MS` so promotions churn far faster than any recorded
 * scene produces them, and a dense click stream keeping the flourish note
 * budget under constant eviction pressure. This is the stretch that used to
 * crackle, rendered so it can be heard rather than only measured.
 */
const sweepScene = (id: string, durationSeconds: number): Scene => {
  let lastClickMs = 0;
  const phase = (index: number): number => index * 0.7;

  return {
    id,
    durationSeconds,
    advance: (engine, sampleMs) => {
      const seconds = sampleMs / 1_000;
      const sweeper =
        Math.floor(sampleMs / SWEEP_HANDOVER_MS) % SWEEP_TRAIL_COUNT;

      if (sampleMs - lastClickMs >= SWEEP_CLICK_INTERVAL_MS) {
        lastClickMs = sampleMs;
        const step = Math.round(sampleMs / SWEEP_CLICK_INTERVAL_MS);
        engine.triggerClick({
          x: (step * 137) % CANVAS_WIDTH,
          y: (step * 61) % CANVAS_HEIGHT,
          // Every fourth click is a hold, so the held-click path and the longer
          // decays it schedules are exercised too.
          holdDuration: step % 4 === 0 ? 900 : undefined,
        });
      }

      const frames: TrailSoundFrame[] = [];
      for (let index = 0; index < SWEEP_TRAIL_COUNT; index++) {
        const isSweeper = index === sweeper;
        const rate = isSweeper ? 6.5 : 0.25;
        const x =
          CANVAS_WIDTH * (0.5 + 0.48 * Math.sin(seconds * rate + phase(index)));
        const y =
          CANVAS_HEIGHT *
          (0.5 + 0.4 * Math.cos(seconds * rate * 0.83 + phase(index)));
        const prevSeconds = seconds - 1 / REPLAY_FPS;
        const prevX =
          CANVAS_WIDTH *
          (0.5 + 0.48 * Math.sin(prevSeconds * rate + phase(index)));
        const prevY =
          CANVAS_HEIGHT *
          (0.5 + 0.4 * Math.cos(prevSeconds * rate * 0.83 + phase(index)));

        frames.push({
          trailIndex: index,
          x,
          y,
          prevX,
          prevY,
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

interface MorningRender {
  filename: string;
  label: string;
  soloistVoice: SoloistVoice;
  scene: () => Scene;
}

const FULL_SECONDS = 60;
const STRESS_SECONDS = 30;

const RENDERS: MorningRender[] = [
  {
    filename: "morning-full-presence.wav",
    label: "busiest fixture window, presence soloist",
    soloistVoice: "presence",
    scene: () => fixtureScene("morning-full", FULL_SECONDS),
  },
  {
    filename: "morning-full-bells.wav",
    label: "the same window, bells soloist",
    soloistVoice: "bells",
    scene: () => fixtureScene("morning-full", FULL_SECONDS),
  },
  {
    filename: "morning-full-arpeggio.wav",
    label: "the same window, arpeggio soloist",
    soloistVoice: "arpeggio",
    scene: () => fixtureScene("morning-full", FULL_SECONDS),
  },
  {
    filename: "morning-busy-stress.wav",
    label: "synthetic worst case the click scanner runs, presence soloist",
    soloistVoice: "presence",
    scene: () => sweepScene("morning-stress", STRESS_SECONDS),
  },
];

const renderScene = async (
  scene: Scene,
  soloistVoice: SoloistVoice,
): Promise<AudioBuffer> => {
  // Seeded on the scene alone, so the three full renders differ only by the
  // soloist voice rather than by the random stream underneath them.
  Math.random = seededRandom(hash(scene.id));
  const { audioContext, setClock } = createDrivenContext(scene.durationSeconds);
  const engine = new SoundEngine(audioContext as unknown as BaseAudioContext);
  await engine.init();
  engine.setCanvasWidth(CANVAS_WIDTH);
  engine.setVolume(ARRANGEMENT.volume);
  engine.setConfig({
    ...ARRANGEMENT.globals,
    ...ARRANGEMENT.layers,
    soloistVoice,
  });
  engine.setCantus(ARRANGEMENT.cantus);

  const stepMs = 1_000 / REPLAY_FPS;
  for (let frameIndex = 0; ; frameIndex++) {
    const sampleMs = frameIndex * stepMs;
    if (sampleMs > scene.durationSeconds * 1_000) break;
    setClock(sampleMs / 1_000);
    const frames = scene.advance(engine, sampleMs);
    engine.tick(sampleMs, frames);
  }

  return (await audioContext.startRendering()) as unknown as AudioBuffer;
};

interface MorningResult {
  filename: string;
  label: string;
  soloistVoice: SoloistVoice;
  durationSeconds: number;
  peak: number;
  peakDbfs: number;
  scan: ScanReport;
}

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

const results: MorningResult[] = [];
try {
  await mkdir(outputDirectory, { recursive: true });

  for (const render of RENDERS) {
    const buffer = await renderScene(render.scene(), render.soloistVoice);
    const peak = peakOf(buffer);
    const scan = scanForClicks(buffer, render.filename);

    await writeFile(
      resolve(outputDirectory, render.filename),
      encodeWave(buffer),
    );

    results.push({
      filename: render.filename,
      label: render.label,
      soloistVoice: render.soloistVoice,
      durationSeconds: buffer.length / buffer.sampleRate,
      peak,
      peakDbfs: toDbfs(peak),
      scan,
    });

    console.log(
      `${render.filename.padEnd(28)} ${results[results.length - 1].durationSeconds.toFixed(1)}s  ` +
        `peak ${peak.toFixed(4)} (${toDbfs(peak).toFixed(1)} dBFS)  ` +
        `clicks ${scan.hits.length}  max ratio ${scan.maxRatio.toFixed(4)}`,
    );
  }
} finally {
  for (const progression of Object.values(PROGRESSIONS)) {
    progression.dwellScale = originalDwellScales.get(progression.id) ?? 1;
  }
}

const totalClicks = results.reduce(
  (sum, result) => sum + result.scan.hits.length,
  0,
);

const readme = `# Morning listening kit

Four renders of the current sound engine under Spencer's saved arrangement.
The only thing that differs between the three \`morning-full-*\` files is
\`soloistVoice\`, so they can be A/B'd against each other directly; the scene,
the random seed and every other setting are identical.

## Arrangement

${CONFIG_SUMMARY}

## Files

| File | Soloist | Duration | Peak | Clicks | Max ratio |
| --- | --- | --- | --- | --- | --- |
${results
  .map(
    (result) =>
      `| \`${result.filename}\` | ${result.soloistVoice} | ${result.durationSeconds.toFixed(1)}s | ${result.peak.toFixed(4)} (${result.peakDbfs.toFixed(1)} dBFS) | ${result.scan.hits.length} | ${result.scan.maxRatio.toFixed(4)} |`,
  )
  .join("\n")}

${results.map((result) => `- \`${result.filename}\` — ${result.label}.`).join("\n")}

The three full renders replay the busiest 60s the event fixture contains, which
is where the voice count, the spotlight's promotion churn and the flourish note
budget are all under the most pressure a real archive day produces.

\`morning-busy-stress.wav\` is the synthetic worst case the click scanner runs:
ten trails with the fast sweep handed to a different one every 900ms and a click
every 120ms, so promotions and note evictions churn far harder than any recorded
scene. This is the stretch that used to crackle.

## Click scan

Every buffer above was scanned before being written, by the same detector
\`clickScan.ts\` runs — a normalised order-eight linear-prediction residual,
flagging anything above 0.5. Clean content reads in the thousandths; a hard cut
of a single note reads above 1.

**${totalClicks} clicks across ${results.length} renders.** Max ratio observed:
${Math.max(...results.map((result) => result.scan.maxRatio)).toFixed(4)}, against
a threshold of 0.5.

Two faults were found and fixed while producing this kit, both on paths the
scanner's configs did not previously cover:

- A trail retiring while it still held the presence soloist took its octave
  double down with it, stopped at full gain instead of faded. Only \`presence\`
  has a double, and the scanner ran presence only on the synthetic scene, which
  never retires a trail.
- The timpani hold's attack and release crossed on any stroke under about
  450ms, so the release's \`setValueAtTime\` landed inside the rising ramp and
  jumped the gain to full. The scanner only ever triggered the bell click voice,
  never the timpani hold this arrangement uses.

Both paths now have their own scanner configs (\`busy-fixture-presence\` and
\`busy-fixture-timpani\`), each confirmed to fail before the fix and pass after.

## Regenerating

\`\`\`sh
cd scripts/sound-samples && bun run renderMorning.ts
\`\`\`

Renders are deterministic: the random stream is seeded per scene, so re-running
reproduces these files byte for byte.
`;

await writeFile(resolve(outputDirectory, "README.md"), readme, "utf8");

console.log(`\ntotal clicks across ${results.length} renders: ${totalClicks}`);
console.log(`wrote ${results.length} files and README.md to ${outputDirectory}`);
if (totalClicks > 0) process.exitCode = 1;
