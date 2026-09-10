// ABOUTME: Renders presence-flap churn scenes against a slow-change control and measures the difference.
// ABOUTME: Diagnostic probe for the live portrait's cut-off blips and 1-8Hz pumping; changes no tuning.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OfflineAudioContext } from "node-web-audio-api";
import {
  SoundEngine,
  type SoloistVoice,
} from "../../extension/website/shared/sound/SoundEngine";
import { PROGRESSIONS } from "../../extension/website/shared/sound/scales";
import type {
  CantusVariant,
  SoundNotice,
  TrailSoundFrame,
} from "../../extension/website/shared/sound/types";
import { SPENCER_ARRANGEMENT } from "./clickScan";
import { scanForClicks } from "./clickDetector";
import { measurePumping, verifyPumpingDetector } from "./pumpingDetector";

const SAMPLE_RATE = 44_100;
const CHANNEL_COUNT = 2;
const CANVAS_WIDTH = 1_200;
const CANVAS_HEIGHT = 800;
const VOLUME = 0.5;

/**
 * The chord dwell every probe runs at, matching the other renderers so a churn
 * number is comparable with the live-fix probe numbers already recorded.
 */
const DEMO_CHORD_DWELL_MS = 8_000;
const BASE_CHORD_DWELL_MS = 20_000;

/** How long each probe runs. Long enough for the pumping windows to average. */
const PROBE_SECONDS = 60;

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

const REPLAY_COLORS = [
  "#4a9a8a",
  "#c4724e",
  "#5b8db8",
  "#d4b85c",
  "#8a6fa8",
  "#6f8a4a",
];

/**
 * A trail's lifecycle in a churn scene.
 *
 * `stable` trails are present for the whole probe: they are the base the live
 * portrait always has, and the level the churn has to be audible over.
 * `flappy` trails cycle — appear on a fresh index, live for `lifetimeMs`,
 * retire, wait, and reappear somewhere else on a new index. That cycle is what
 * the existing scanner scenes never produce: `liveScene`'s trails are a fixed
 * roster whose indices are allocated once, so its arrivals all land in the
 * first tick and its retirements all land at the end.
 */
interface ChurnTrail {
  trailIndex: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  approach: number;
  /** When this trail was handed to the engine, or null while it is absent. */
  bornMs: number | null;
  /** When it retires (if present) or when it next appears (if absent). */
  nextTransitionMs: number;
  firstSeen: boolean;
  stable: boolean;
}

interface ChurnSceneOptions {
  /** Trails present for the whole probe. */
  stableCount: number;
  /** Trails that appear and retire on a cycle. */
  flappyCount: number;
  /** Range a flappy trail stays present, in ms. */
  lifetimeMs: [number, number];
  /** Range a flappy trail stays absent between appearances, in ms. */
  gapMs: [number, number];
}

/**
 * The tick cadence a live page produces: irregular, with a longer frame
 * whenever a stream batch lands and React re-derives the trail list. Copied
 * from the live scanner rather than imported so this probe stays independent of
 * whatever that module's cadence is tuned to next.
 */
const liveStepMs = (random: () => number): ((sampleMs: number) => number) => {
  let nextBatchMs = 0;
  return (sampleMs: number) => {
    if (sampleMs >= nextBatchMs) {
      nextBatchMs = sampleMs + 850 + random() * 400;
      return 45 + random() * 55;
    }
    return 8 + random() * 22;
  };
};

interface ChurnScene {
  id: string;
  durationSeconds: number;
  soloistVoice: SoloistVoice;
  nextStepMs: (sampleMs: number) => number;
  advance: (engine: SoundEngine, sampleMs: number) => TrailSoundFrame[];
  /** Distinct active-trail counts the scene actually presented. */
  observedCounts: () => number[];
}

/**
 * A scene where trails come and go on real engine boundaries.
 *
 * The distinction that matters for the hypothesis: a flappy trail's
 * disappearance is an actual `retireTrail` call and its reappearance is an
 * `isNewlyActive` frame on an index the engine has never voiced. That is the
 * pair of events the live portrait's presence stream produces when a peer's
 * WebSocket flaps, and neither `liveScene` nor `pumpingScan`'s frame filtering
 * reaches it: dropping a frame from the list leaves the engine's voice for that
 * index alive and untouched, so no arrival and no departure is ever decided.
 */
const churnScene = (
  id: string,
  soloistVoice: SoloistVoice,
  durationSeconds: number,
  options: ChurnSceneOptions,
): ChurnScene => {
  const random = seededRandom(hash(`churn-${id}`));
  const counts = new Set<number>();
  let nextTrailIndex = 0;

  const spanFrom = ([low, high]: [number, number]): number =>
    low + random() * (high - low);

  const place = (trail: ChurnTrail): void => {
    trail.x = CANVAS_WIDTH * random();
    trail.y = CANVAS_HEIGHT * random();
    trail.targetX = CANVAS_WIDTH * random();
    trail.targetY = CANVAS_HEIGHT * random();
    trail.approach = 0.02 + random() * 0.12;
  };

  const trails: ChurnTrail[] = [];
  for (let index = 0; index < options.stableCount; index++) {
    const trail: ChurnTrail = {
      trailIndex: nextTrailIndex++,
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      approach: 0.04,
      bornMs: 0,
      nextTransitionMs: Number.POSITIVE_INFINITY,
      firstSeen: true,
      stable: true,
    };
    place(trail);
    trails.push(trail);
  }
  for (let index = 0; index < options.flappyCount; index++) {
    const trail: ChurnTrail = {
      trailIndex: nextTrailIndex++,
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      approach: 0.04,
      bornMs: 0,
      // Staggered, so the flap is a continuous churn rather than a herd that
      // all leaves and all returns on the same frame.
      nextTransitionMs:
        (spanFrom(options.lifetimeMs) * (index + 1)) / options.flappyCount,
      firstSeen: true,
      stable: false,
    };
    place(trail);
    trails.push(trail);
  }

  let nextBatchMs = 0;

  return {
    id,
    durationSeconds,
    soloistVoice,
    nextStepMs: liveStepMs(random),
    observedCounts: () => [...counts].sort((a, b) => a - b),
    advance: (engine, sampleMs) => {
      // The stream batch: new geometry for whoever moved, plus the click burst
      // that arrives with it. Identical in shape to the live scanner's, so the
      // only difference between this probe and `live-presence` is the churn.
      if (sampleMs >= nextBatchMs) {
        nextBatchMs = sampleMs + 1_000;
        for (const trail of trails) {
          if (trail.bornMs === null) continue;
          if (random() > 0.55) continue;
          trail.targetX = CANVAS_WIDTH * random();
          trail.targetY = CANVAS_HEIGHT * random();
          trail.approach = 0.01 + random() * 0.2;
          trail.x += (trail.targetX - trail.x) * 0.12;
          trail.y += (trail.targetY - trail.y) * 0.12;
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

      // The churn itself. A retiring trail leaves through `retireTrail`, and
      // the one that replaces it takes a brand new index, so the engine sees a
      // departure and then an arrival rather than a roster edit.
      for (const trail of trails) {
        if (sampleMs < trail.nextTransitionMs) continue;
        if (trail.bornMs !== null) {
          engine.retireTrail(trail.trailIndex);
          trail.bornMs = null;
          trail.nextTransitionMs = sampleMs + spanFrom(options.gapMs);
        } else {
          trail.trailIndex = nextTrailIndex++;
          trail.bornMs = sampleMs;
          trail.firstSeen = true;
          place(trail);
          trail.nextTransitionMs = sampleMs + spanFrom(options.lifetimeMs);
        }
      }

      const frames: TrailSoundFrame[] = [];
      for (const trail of trails) {
        if (trail.bornMs === null) continue;
        trail.x += (trail.targetX - trail.x) * trail.approach;
        trail.y += (trail.targetY - trail.y) * trail.approach;
        frames.push({
          trailIndex: trail.trailIndex,
          x: trail.x,
          y: trail.y,
          prevX: trail.x,
          prevY: trail.y,
          cursorType: trail.trailIndex % 3 === 0 ? "text" : "default",
          progress: 0,
          color: REPLAY_COLORS[trail.trailIndex % REPLAY_COLORS.length],
          isNewlyActive: trail.firstSeen,
          identityKey: `churn-${trail.trailIndex}`,
        });
        trail.firstSeen = false;
      }
      counts.add(frames.length);
      return frames;
    },
  };
};

/**
 * What the engine committed to during a render, read through the notice
 * listener rather than inferred from the audio.
 *
 * The truncation question is exactly answerable here: an arrival chime is a
 * figure whose notes land at `noteOffsetsSeconds` after the trigger, and
 * `retireTrail` tears the trail's graph down. A retirement that lands before
 * the last of those offsets is an onset that was cut off — which is the "blip
 * cut off" the hypothesis names, measured at the source instead of guessed at
 * from an envelope.
 */
interface NoticeLog {
  arrivals: { trailIndex: number; ms: number; span: number; played: boolean }[];
  departures: { trailIndex: number; ms: number }[];
  retirements: { trailIndex: number; ms: number }[];
  /**
   * How far through its own envelope each evicted one-shot note was when the
   * budget took it, as a fraction. This is the second place an onset can be
   * cut: the arrival chime is 3-5 one-shot notes with decays over a second,
   * and the budget holds 16 notes total, so a volley of chimes evicts its own
   * earlier notes. A fraction well under 1 is a note the listener heard start
   * and not finish.
   */
  evictionProgress: number[];
}

/** How much of a one-shot's envelope must remain for its cut to be audible. */
const AUDIBLE_EVICTION_PROGRESS = 0.6;

interface ChurnResult {
  id: string;
  trailCounts: number[];
  clicks: number;
  peak: number;
  maxRatio: number;
  meanPumpDepth: number;
  peakPumpDepth: number;
  arrivalsPlayed: number;
  arrivalsSuppressed: number;
  departures: number;
  retirements: number;
  truncatedOnsets: number;
  truncationRate: number;
  evictions: number;
  /** Evictions that took a note with most of its envelope still to come. */
  audibleEvictions: number;
  evictionsPerSecond: number;
  /** Typical fraction of its envelope an evicted note had reached. */
  medianEvictionProgress: number;
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const renderChurn = async (
  scene: ChurnScene,
): Promise<{ buffer: AudioBuffer; log: NoticeLog }> => {
  Math.random = seededRandom(hash(scene.id));

  const audioContext = new OfflineAudioContext(
    CHANNEL_COUNT,
    Math.ceil(scene.durationSeconds * SAMPLE_RATE),
    SAMPLE_RATE,
  );
  Object.defineProperty(audioContext, "state", { value: "running" });
  let clockSeconds = 0;
  Object.defineProperty(audioContext, "currentTime", {
    get: () => clockSeconds,
    configurable: true,
  });

  const engine = new SoundEngine(audioContext as unknown as BaseAudioContext);
  await engine.init();
  engine.setCanvasWidth(CANVAS_WIDTH);
  engine.setVolume(VOLUME);
  engine.setConfig({ ...SPENCER_ARRANGEMENT, soloistVoice: scene.soloistVoice });
  engine.setCantus("tenor" as CantusVariant);

  const log: NoticeLog = {
    arrivals: [],
    departures: [],
    retirements: [],
    evictionProgress: [],
  };
  let sampleMs = 0;
  engine.setSoundNoticeListener((notice: SoundNotice) => {
    if (notice.kind !== "arrival") return;
    if (notice.rising) {
      log.arrivals.push({
        trailIndex: notice.trailIndex,
        ms: sampleMs,
        span: notice.noteOffsetsSeconds.length
          ? Math.max(...notice.noteOffsetsSeconds)
          : 0,
        played: notice.played,
      });
    } else {
      log.departures.push({ trailIndex: notice.trailIndex, ms: sampleMs });
    }
  });

  // The retirement times the truncation test compares against. Wrapping the
  // engine's own method is read-only: it forwards every call unchanged and only
  // records when it happened.
  const retire = engine.retireTrail.bind(engine);
  engine.retireTrail = (trailIndex: number) => {
    log.retirements.push({ trailIndex, ms: sampleMs });
    retire(trailIndex);
  };

  // The one-shot budget's victim selection, observed the same way. Diagnostic
  // access to a private the engine does not expose; it forwards unchanged, so
  // the render is the shipping behaviour with a counter beside it.
  const internals = engine as unknown as {
    stopFlourishNote: (note: {
      startedAtMs: number;
      durationMs: number;
    }) => void;
  };
  const stopFlourish = internals.stopFlourishNote.bind(engine);
  internals.stopFlourishNote = (note) => {
    const nowMs = clockSeconds * 1_000;
    log.evictionProgress.push(
      note.durationMs <= 0
        ? 1
        : (nowMs - note.startedAtMs) / note.durationMs,
    );
    stopFlourish(note);
  };

  const endMs = scene.durationSeconds * 1_000;
  while (sampleMs <= endMs) {
    clockSeconds = sampleMs / 1_000;
    const frames = scene.advance(engine, sampleMs);
    engine.tick(sampleMs, frames);
    sampleMs += scene.nextStepMs(sampleMs);
  }

  const buffer = (await audioContext.startRendering()) as unknown as AudioBuffer;
  return { buffer, log };
};

/**
 * Arrival chimes whose trail was torn down before the figure finished.
 *
 * The chime's own note offsets give the expected duration, so this needs no
 * envelope guesswork. An onset counts as truncated when its trail retires
 * before 30% of that span has elapsed, which is the point past which a listener
 * hears an interrupted note rather than a short one.
 */
const TRUNCATION_FRACTION = 0.3;
/** A chime with no reported offsets still occupies about this long. */
const DEFAULT_CHIME_SPAN_SECONDS = 0.9;

const countTruncatedOnsets = (log: NoticeLog): number => {
  const retirementsByTrail = new Map<number, number[]>();
  for (const retirement of log.retirements) {
    const list = retirementsByTrail.get(retirement.trailIndex) ?? [];
    list.push(retirement.ms);
    retirementsByTrail.set(retirement.trailIndex, list);
  }

  let truncated = 0;
  for (const arrival of log.arrivals) {
    if (!arrival.played) continue;
    const spanSeconds = arrival.span || DEFAULT_CHIME_SPAN_SECONDS;
    const cutoffMs = arrival.ms + spanSeconds * TRUNCATION_FRACTION * 1_000;
    const retirements = retirementsByTrail.get(arrival.trailIndex) ?? [];
    if (retirements.some((ms) => ms >= arrival.ms && ms < cutoffMs)) {
      truncated++;
    }
  }
  return truncated;
};

const writeWave = (buffer: AudioBuffer, file: string): void => {
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
  const samples = Array.from({ length: channels }, (_, channel) =>
    buffer.getChannelData(channel),
  );
  for (let index = 0; index < buffer.length; index++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, samples[channel][index]));
      wave.writeInt16LE(
        Math.round(sample * 32_767),
        44 + (index * channels + channel) * 2,
      );
    }
  }
  writeFileSync(file, wave);
};

/**
 * The three probes.
 *
 * `live-churn-flap` is the hypothesis as stated: a stable base of five plus
 * four trails flapping on roughly half-second to two-second lifetimes.
 * `live-churn-storm` pushes the same shape until the active count bounces
 * across the whole 3-12 range on sub-second lifetimes. `live-churn-control`
 * changes by exactly as much but slowly — the same trail-count trajectory
 * walked over 5-9s lifetimes — so anything the first two show that this one
 * does not is attributable to the rate of change and not to the counts.
 */
const PROBES: { id: string; options: ChurnSceneOptions }[] = [
  {
    id: "live-churn-flap",
    options: {
      stableCount: 5,
      flappyCount: 4,
      lifetimeMs: [500, 2_000],
      gapMs: [400, 1_400],
    },
  },
  {
    id: "live-churn-storm",
    options: {
      stableCount: 3,
      flappyCount: 9,
      lifetimeMs: [300, 800],
      gapMs: [200, 700],
    },
  },
  {
    id: "live-churn-control",
    options: {
      stableCount: 5,
      flappyCount: 4,
      lifetimeMs: [5_000, 9_000],
      gapMs: [4_000, 8_000],
    },
  },
];

const OUTPUT_DIRECTORY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../internal-docs/sound-samples/churn-probe",
);

/** Probes whose rendered audio is written out for listening. */
const LISTENABLE: Record<string, string> = {
  "live-churn-flap": "churn-flap.wav",
  "live-churn-control": "control.wav",
};

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
verifyPumpingDetector();

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

const selectors = process.argv.slice(2);
const results: ChurnResult[] = [];

try {
  for (const probe of PROBES) {
    if (selectors.length && !selectors.some((s) => probe.id.includes(s))) {
      continue;
    }
    const scene = churnScene(probe.id, "presence", PROBE_SECONDS, probe.options);
    const { buffer, log } = await renderChurn(scene);
    const clicks = scanForClicks(buffer, probe.id);
    const pumping = measurePumping(buffer);
    const played = log.arrivals.filter((arrival) => arrival.played).length;
    const truncated = countTruncatedOnsets(log);

    const result: ChurnResult = {
      id: probe.id,
      trailCounts: scene.observedCounts(),
      clicks: clicks.hits.length,
      peak: Number(clicks.peak.toFixed(4)),
      maxRatio: Number(clicks.maxRatio.toFixed(4)),
      meanPumpDepth: Number(pumping.meanDepth.toFixed(4)),
      peakPumpDepth: Number(pumping.peakDepth.toFixed(4)),
      arrivalsPlayed: played,
      arrivalsSuppressed: log.arrivals.length - played,
      departures: log.departures.length,
      retirements: log.retirements.length,
      truncatedOnsets: truncated,
      truncationRate: played ? Number((truncated / played).toFixed(4)) : 0,
      evictions: log.evictionProgress.length,
      audibleEvictions: log.evictionProgress.filter(
        (progress) => progress < AUDIBLE_EVICTION_PROGRESS,
      ).length,
      evictionsPerSecond: Number(
        (log.evictionProgress.length / PROBE_SECONDS).toFixed(2),
      ),
      medianEvictionProgress: Number(median(log.evictionProgress).toFixed(4)),
    };
    results.push(result);
    console.log(JSON.stringify(result));

    const file = LISTENABLE[probe.id];
    if (file) writeWave(buffer, resolve(OUTPUT_DIRECTORY, file));
  }
} finally {
  for (const progression of Object.values(PROGRESSIONS)) {
    progression.dwellScale = originalDwellScales.get(progression.id) ?? 1;
  }
}

writeFileSync(
  resolve(OUTPUT_DIRECTORY, "churn-results.json"),
  JSON.stringify(results, null, 2) + "\n",
);
