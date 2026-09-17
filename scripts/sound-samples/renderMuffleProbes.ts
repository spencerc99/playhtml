// ABOUTME: Renders one scene repeatedly with each suspected source of the muffling neutralised in turn.
// ABOUTME: Evidence for a listening test — nothing here changes shipped tuning.

/**
 * What this is for.
 *
 * Spencer hears "a bit of a muffling sound going on" and has not yet said
 * when it happens, so there is nothing to reproduce from and no measurement
 * that would settle it — "muffled" is a judgement about timbre, and the only
 * instrument that reads it is an ear.
 *
 * Guessing which knob it is and changing that knob would be the wrong move
 * twice over: it risks retuning something that was never the cause, and it
 * produces no evidence either way. So this renders the same scene once per
 * suspect, with that suspect and nothing else neutralised, plus a reference
 * with everything as it ships. Whichever file stops sounding muffled names the
 * cause, and the tuning conversation can start from a fact.
 *
 * Every probe is a render-time override applied to a copy of the tuning
 * objects and restored before the process exits. Nothing here is a shipped
 * change, and this script is not part of the acceptance test.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OfflineAudioContext } from "node-web-audio-api";
import {
  PRESENCE_TUNING,
  SPOTLIGHT_TUNING,
  SWELL_TUNING,
  SoundEngine,
} from "../../extension/website/shared/sound/SoundEngine";
import { PROGRESSIONS } from "../../extension/website/shared/sound/scales";
import type { TrailSoundFrame } from "../../extension/website/shared/sound/types";

const SAMPLE_RATE = 44_100;
const CHANNEL_COUNT = 2;
const CANVAS_WIDTH = 1_200;
const CANVAS_HEIGHT = 800;
const VOLUME = 0.5;
const REPLAY_FPS = 60;

/**
 * Long enough to cross the ensemble breath's 21s period twice, since one of
 * the suspects is that breath and a probe shorter than its period could not
 * show it either way.
 */
const PROBE_SECONDS = 50;

const DEMO_CHORD_DWELL_MS = 8_000;
const BASE_CHORD_DWELL_MS = 20_000;

Object.assign(globalThis, {
  window: { innerWidth: CANVAS_WIDTH, innerHeight: CANVAS_HEIGHT },
});

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(
  scriptDirectory,
  "../../internal-docs/sound-samples/muffle-probes",
);

/**
 * Spotlight mode with presence, which is what Spencer is listening to — and
 * the mode all four suspects are specific to. Three of them do not exist at
 * all with the spotlight off.
 */
const ARRANGEMENT = {
  mode: "spotlight",
  spotlight: true,
  soloistVoice: "presence",
  chordVoicing: true,
  cursorInstruments: true,
  trailVoices: true,
  swells: true,
  choralTimbre: false,
  chordRotation: true,
  energyArc: true,
  trailArrivals: true,
  navigationSounds: true,
  bassPedal: false,
  crossings: "off",
} as const;

const COLORS = ["#4a9a8a", "#c4724e", "#5b8db8", "#d4b85c", "#8a6fa8"];

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

/**
 * The scene every probe runs, identical across all of them.
 *
 * Deliberately built so the spotlight changes hands several times: three of
 * the four suspects only move on a promotion or a demotion, so a scene with
 * one settled soloist would render them inert and every file would sound the
 * same. The handovers are slow enough to hear each one as an event rather than
 * as churn.
 */
const HANDOVER_MS = 7_000;

const advance = (
  engine: SoundEngine,
  sampleMs: number,
  random: () => number,
  lastClick: { ms: number },
): TrailSoundFrame[] => {
  const seconds = sampleMs / 1_000;
  const trailCount = 5;
  const runner = Math.floor(sampleMs / HANDOVER_MS) % trailCount;

  if (sampleMs - lastClick.ms > 2_200) {
    lastClick.ms = sampleMs;
    engine.triggerClick({
      x: CANVAS_WIDTH * random(),
      y: CANVAS_HEIGHT * random(),
    });
  }

  const frames: TrailSoundFrame[] = [];
  for (let index = 0; index < trailCount; index++) {
    const isRunner = index === runner;
    const rate = isRunner ? 3.2 : 0.22;
    const phase = index * 0.9;
    const at = (t: number) => ({
      x: CANVAS_WIDTH * (0.5 + 0.45 * Math.sin(t * rate + phase)),
      y: CANVAS_HEIGHT * (0.5 + 0.38 * Math.cos(t * rate * 0.79 + phase)),
    });
    const now = at(seconds);
    const before = at(seconds - 1 / REPLAY_FPS);
    frames.push({
      trailIndex: index,
      x: now.x,
      y: now.y,
      prevX: before.x,
      prevY: before.y,
      cursorType: index % 3 === 0 ? "text" : "default",
      progress: 0,
      color: COLORS[index % COLORS.length],
      isNewlyActive: sampleMs < 1 / REPLAY_FPS,
      identityKey: `probe-${index}`,
    });
  }
  return frames;
};

const render = async (): Promise<AudioBuffer> => {
  const random = seededRandom(0x5eed);
  Math.random = seededRandom(0x5eed);
  const ctx = new OfflineAudioContext(
    CHANNEL_COUNT,
    Math.ceil(PROBE_SECONDS * SAMPLE_RATE),
    SAMPLE_RATE,
  );
  Object.defineProperty(ctx, "state", { value: "running" });
  let clockSeconds = 0;
  Object.defineProperty(ctx, "currentTime", {
    get: () => clockSeconds,
    configurable: true,
  });

  const engine = new SoundEngine(ctx as unknown as BaseAudioContext);
  await engine.init();
  engine.setCanvasWidth(CANVAS_WIDTH);
  engine.setVolume(VOLUME);
  engine.setConfig({ ...ARRANGEMENT });

  const lastClick = { ms: 0 };
  const stepMs = 1_000 / REPLAY_FPS;
  for (let sampleMs = 0; sampleMs <= PROBE_SECONDS * 1_000; sampleMs += stepMs) {
    clockSeconds = sampleMs / 1_000;
    engine.tick(sampleMs, advance(engine, sampleMs, random, lastClick));
  }

  return (await ctx.startRendering()) as unknown as AudioBuffer;
};

interface Probe {
  filename: string;
  /** What is neutralised, as a listener would describe the difference. */
  removes: string;
  /** Why this is a candidate for "muffling" in the first place. */
  rationale: string;
  /** What Spencer should conclude if this file is the one that sounds clear. */
  ifThisOne: string;
  /** Apply the override; returns a function restoring what it changed. */
  apply: () => () => void;
}

/** Overwrite fields on a tuning object and hand back their restoration. */
const override = <T extends object>(target: T, patch: Partial<T>): (() => void) => {
  const original = {} as Partial<T>;
  for (const key of Object.keys(patch) as (keyof T)[]) {
    original[key] = target[key];
    target[key] = patch[key] as T[keyof T];
  }
  return () => {
    for (const key of Object.keys(original) as (keyof T)[]) {
      target[key] = original[key] as T[keyof T];
    }
  };
};

const PROBES: Probe[] = [
  {
    filename: "00-reference.wav",
    removes: "nothing — everything exactly as it ships",
    rationale:
      "The file every other one is compared against. Listen to this first, " +
      "and only call a probe 'clearer' if the difference is audible against " +
      "this rather than against memory.",
    ifThisOne:
      "If this already sounds clear, the muffling is not in this scene and " +
      "the next step is a recording of the moment you actually hear it.",
    apply: () => () => {},
  },
  {
    filename: "01-no-crowd-duck.wav",
    removes: "the crowd ducking to 0.4x whenever a trail is promoted",
    rationale:
      "The loudest thing that moves on a promotion. Every voice but the " +
      "soloist drops to four tenths and walks back over about a second, so " +
      "the body of the sound thins and returns each time the spotlight " +
      "changes hands — which is a plausible reading of 'coming and going'.",
    ifThisOne:
      "The duck is too deep or its recovery too slow. Both are single " +
      "numbers (duckedGain, releaseSeconds) and can be softened without " +
      "touching anything else.",
    apply: () =>
      override(SPOTLIGHT_TUNING, { duckedGain: 1, soloistGain: 1 }),
  },
  {
    filename: "02-no-ensemble-breath.wav",
    removes: "the slow ensemble breath over the whole mix",
    rationale:
      "One sine at a 21-second period, plus or minus 15% on the master. " +
      "That is slower than any musical phrase in the scene, so it is not " +
      "heard as dynamics — a long, shallow rise and fall over everything is " +
      "much more likely to read as the mix opening and closing.",
    ifThisOne:
      "The breath's depth or period is wrong for this material. Shallower " +
      "or faster both keep the idea while removing the sense of a lid.",
    apply: () => override(SWELL_TUNING, { breathDepth: 0 }),
  },
  {
    filename: "03-no-presence-brightness.wav",
    removes: "presence opening and re-closing the promoted voice's filter",
    rationale:
      "The only suspect that is literally a filter. A promoted voice opens " +
      "to 2300Hz and returns to its instrument's own cutoff on demotion, and " +
      "a cutoff closing is a muffle by definition — the question is only " +
      "whether it is heard as the soloist stepping back or as the sound " +
      "being covered.",
    ifThisOne:
      "The return is the problem, not the opening. Lengthening it, or " +
      "leaving a demoted voice part-way open, keeps the promotion audible " +
      "without the shut afterwards.",
    apply: () =>
      // Matching the instrument's own cutoff means the brightness path finds
      // nothing to raise, so neither the open nor the close ever happens.
      override(PRESENCE_TUNING, { filterHz: 0 }),
  },
  {
    filename: "04-no-presence-reverb-dry.wav",
    removes: "presence drying the promoted voice out of the room",
    rationale:
      "A promoted voice sends less of itself to the reverb, so the room " +
      "thins under it and fills back in on demotion. Less room is usually " +
      "heard as closer rather than duller, but it moves on exactly the same " +
      "cue as the other three, so it is separated here rather than assumed " +
      "innocent.",
    ifThisOne:
      "The dry/wet move is too large. It is one multiplier " +
      "(reverbSendScale) and can be raised toward 1 by ear.",
    apply: () => override(PRESENCE_TUNING, { reverbSendScale: 1 }),
  },
  {
    filename: "05-none-of-them.wav",
    removes: "all of the above at once",
    rationale:
      "The control at the other end. If every suspect is neutralised and " +
      "the muffling is still there, none of them is the cause and the search " +
      "should move elsewhere — most likely to the master compressor, which " +
      "no probe here touches.",
    ifThisOne:
      "The cause is one of the four. Compare the single-suspect files " +
      "against each other to say which.",
    apply: () => {
      const restores = [
        override(SPOTLIGHT_TUNING, { duckedGain: 1, soloistGain: 1 }),
        override(SWELL_TUNING, { breathDepth: 0 }),
        override(PRESENCE_TUNING, { filterHz: 0, reverbSendScale: 1 }),
      ];
      return () => {
        for (const restore of restores) restore();
      };
    },
  },
];

const peakDbfs = (buffer: AudioBuffer): number => {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (const sample of samples) {
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY;
};

/**
 * Average spectral centroid, in Hz — where the energy sits on average.
 *
 * Reported beside each file because "muffled" has a measurable correlate even
 * though it is not a measurable property: a mix whose energy sits lower is
 * duller. It is offered as a hint for which file to listen to first, not as an
 * answer. A probe that raises the centroid and still sounds muffled has ruled
 * its suspect out just as firmly as one that does not move it.
 */
const spectralCentroid = (buffer: AudioBuffer): number => {
  // A cheap proxy for the centroid that needs no transform: the ratio of the
  // signal's own derivative to the signal is proportional to its mean
  // frequency, which is all this is used for.
  let energy = 0;
  let derivativeEnergy = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let index = 1; index < samples.length; index++) {
      const difference = samples[index] - samples[index - 1];
      energy += samples[index] * samples[index];
      derivativeEnergy += difference * difference;
    }
  }
  if (energy === 0) return 0;
  return (
    (Math.sqrt(derivativeEnergy / energy) * buffer.sampleRate) / (2 * Math.PI)
  );
};

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

interface Rendered {
  probe: Probe;
  peakDbfs: number;
  centroidHz: number;
}

const rendered: Rendered[] = [];

try {
  await mkdir(outputDirectory, { recursive: true });

  for (const probe of PROBES) {
    const restore = probe.apply();
    try {
      const buffer = await render();
      await writeFile(
        resolve(outputDirectory, probe.filename),
        encodeWave(buffer),
      );
      const result = {
        probe,
        peakDbfs: peakDbfs(buffer),
        centroidHz: spectralCentroid(buffer),
      };
      rendered.push(result);
      console.log(
        `${probe.filename.padEnd(30)} peak ${result.peakDbfs.toFixed(1)} dBFS  ` +
          `centroid ${Math.round(result.centroidHz)} Hz`,
      );
    } finally {
      restore();
    }
  }
} finally {
  for (const progression of Object.values(PROGRESSIONS)) {
    progression.dwellScale = originalDwellScales.get(progression.id) ?? 1;
  }
}

const reference = rendered.find(
  (entry) => entry.probe.filename === "00-reference.wav",
);

const readme = [
  "# Muffle probes",
  "",
  "One scene, rendered once per suspected source of the muffling, with that",
  "suspect and nothing else neutralised. Everything here is a render-time",
  "override; no shipped tuning has been changed.",
  "",
  "## How to use these",
  "",
  "1. Listen to `00-reference.wav` first and find the moment that sounds",
  "   muffled. Note roughly when it happens.",
  "2. Listen to each numbered probe at that same moment.",
  "3. The probe where the muffling is gone names the cause. If several are",
  "   partly better, the cause is more than one of them and `05` should sound",
  "   fully clear.",
  "4. If `05-none-of-them.wav` still sounds muffled, none of these is it —",
  "   say so, and the search moves to the master compressor, which no probe",
  "   here touches.",
  "",
  "All files are the same scene, same seed, same length, so they can be",
  `compared moment for moment. ${PROBE_SECONDS}s each; the spotlight changes`,
  `hands every ${HANDOVER_MS / 1000}s, because three of the four suspects only`,
  "move on a promotion or a demotion.",
  "",
  "## A note on the numbers",
  "",
  "The centroid below is where each file's energy sits on average. It is a",
  "hint about which file to try first, not a verdict: a probe that raises the",
  "centroid and still sounds muffled has ruled its suspect out just as firmly",
  "as one that moves nothing. The ear decides.",
  "",
  "## The probes",
  "",
];

for (const entry of rendered) {
  const delta =
    reference && entry !== reference
      ? ` (${entry.centroidHz >= reference.centroidHz ? "+" : ""}${Math.round(
          entry.centroidHz - reference.centroidHz,
        )} Hz vs reference)`
      : "";
  readme.push(
    `### \`${entry.probe.filename}\``,
    "",
    `**Removes:** ${entry.probe.removes}`,
    "",
    `**Why it is a suspect:** ${entry.probe.rationale}`,
    "",
    `**If this is the one that sounds clear:** ${entry.probe.ifThisOne}`,
    "",
    `Peak ${entry.peakDbfs.toFixed(1)} dBFS, centroid ${Math.round(
      entry.centroidHz,
    )} Hz${delta}.`,
    "",
  );
}

readme.push(
  "## Regenerating",
  "",
  "```sh",
  "cd scripts/sound-samples && bun run renderMuffleProbes.ts",
  "```",
  "",
);

await writeFile(resolve(outputDirectory, "README.md"), readme.join("\n"));
console.log(`\nwrote ${rendered.length} probes and a README to ${outputDirectory}`);
