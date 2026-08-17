// ABOUTME: Renders the orchestral sound candidates as long solos and against the real event fixture.
// ABOUTME: Writes deterministic stereo WAV files and rejects silent or clipped output.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OfflineAudioContext } from "node-web-audio-api";
import { SoundEngine } from "../../extension/website/shared/sound/SoundEngine";
import { PROGRESSIONS } from "../../extension/website/shared/sound/scales";
import { SOUND_LAYERS } from "../../extension/website/shared/sound/types";
import type {
  CantusVariant,
  PizzicatoVariant,
  SoundLayer,
  TimpaniVariant,
  TrailSoundFrame,
} from "../../extension/website/shared/sound/types";
import {
  buildMoveTracks,
  interpolateTrackPosition,
  type MoveTrack,
  type SampleEvent,
} from "../../extension/website/sounds/SamplePlayback";
import fixtureEvents from "../../extension/website/sounds/sampleEvents.json";

const SAMPLE_RATE = 44_100;
const CHANNEL_COUNT = 2;
const SILENCE_THRESHOLD_DBFS = -40;
const CANVAS_WIDTH = 1_200;
const CANVAS_HEIGHT = 800;
const VOLUME = 0.5;

/** Simulated frame rate the fixture is replayed at, matching a live rAF loop. */
const REPLAY_FPS = 60;
/** How long a participant stays drawn after their last event, as in the pad. */
const TRAIL_IDLE_TIMEOUT_MS = 4_000;

/**
 * Chord dwell used while rendering, in ms. The shipped base is 20s, which a
 * demo shorter than a minute never gets past — every sample would sit on one
 * chord. This is applied by overriding each progression's `dwellScale` for the
 * duration of the render process only; the shipped constant is untouched and
 * the scales are restored before the script exits.
 */
const DEMO_CHORD_DWELL_MS = 8_000;
const BASE_CHORD_DWELL_MS = 20_000;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(
  scriptDirectory,
  "../../internal-docs/sound-samples",
);

Object.assign(globalThis, {
  window: {
    innerWidth: CANVAS_WIDTH,
    innerHeight: CANVAS_HEIGHT,
  },
});

/**
 * Spencer's default arrangement: the toggle set every in-context render is
 * judged against, so the only difference between those files is which
 * candidate instrument is driven on top of it.
 */
const ARRANGEMENT = {
  mode: "spotlight",
  spotlight: true,
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

/** How the render matrix describes one arrangement toggle set in the README. */
const ARRANGEMENT_SUMMARY =
  "spotlight, chordRotation, energyArc, trailArrivals, navigationSounds, trailVoices, swells, chordVoicing, cursorInstruments, volume 0.5";

/** The same, for a solo: no trails, so no energy arc, and one layer soloed. */
const SOLO_CONFIG_SUMMARY = (layer: SoundLayer): string =>
  `${ARRANGEMENT_SUMMARY.replace("energyArc, ", "")}, energyArc off; ${layer} soloed; chord dwell ${DEMO_CHORD_DWELL_MS / 1000}s`;

interface RenderResult {
  filename: string;
  label: string;
  demonstrates: string;
  durationSeconds: number;
  config: string;
  peakDbfs: number;
  /**
   * For an A/B render: how much louder the candidate's frequency band is
   * during the ON windows than during the OFF windows, in dB. Absent for
   * solos and stems, which have no toggle.
   */
  toggleDeltaDb?: number;
}

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

const peakLevel = (buffer: AudioBuffer): number => {
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

/**
 * The frequency band a candidate occupies, used to prove its toggles changed
 * the audio rather than just measuring the bed moving underneath it.
 *
 * Measuring broadband RMS would mostly report the arrangement's own swells,
 * which drift far more across eight seconds than one added instrument does.
 * Restricting the measurement to where the candidate actually lives makes the
 * ON/OFF difference attributable to the candidate.
 */
interface FrequencyBand {
  lowHz: number;
  highHz: number;
}

/**
 * A one-pole bandpass, run forward over one channel.
 *
 * A biquad would be sharper, but this is a measurement filter rather than a
 * rendering one: it only has to attenuate the bed far enough that the
 * candidate dominates the residual, and a cascade of one-poles is enough for
 * that while staying trivially deterministic.
 */
const bandRms = (
  buffer: AudioBuffer,
  band: FrequencyBand,
  fromSeconds: number,
  toSeconds: number,
): number => {
  const rate = buffer.sampleRate;
  const start = Math.max(0, Math.floor(fromSeconds * rate));
  const end = Math.min(buffer.length, Math.ceil(toSeconds * rate));
  if (end <= start) return 0;

  // Per-sample smoothing coefficients for the two one-pole stages.
  const highpassAlpha = Math.exp((-2 * Math.PI * band.lowHz) / rate);
  const lowpassAlpha = Math.exp((-2 * Math.PI * band.highHz) / rate);

  let sumSquares = 0;
  let count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    // Prime the filter state ahead of the measured window so the first
    // samples are not reading the filter's own startup transient.
    const primeFrom = Math.max(0, start - Math.floor(rate * 0.25));
    let lowState = 0;
    let bandState = 0;
    for (let index = primeFrom; index < end; index++) {
      const sample = samples[index];
      // Low shelf tracking everything below the band, subtracted to highpass.
      lowState = lowState * highpassAlpha + sample * (1 - highpassAlpha);
      const highpassed = sample - lowState;
      // Lowpass the result to close the top of the band.
      bandState = bandState * lowpassAlpha + highpassed * (1 - lowpassAlpha);
      if (index >= start) {
        sumSquares += bandState * bandState;
        count++;
      }
    }
  }

  return count === 0 ? 0 : Math.sqrt(sumSquares / count);
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
 * An offline context whose clock the caller drives.
 *
 * The engine schedules every note relative to `ctx.currentTime`, and an
 * offline context's clock does not advance while a synchronous loop feeds it —
 * so a driven render would stack a whole minute of events onto instant zero.
 * Replacing `currentTime` with the simulated clock is what makes tick-driven
 * playback render as the timeline it represents: notes land where they were
 * fired, and the velocity the engine derives from per-frame clock deltas is
 * the velocity a live page would have produced.
 */
interface DrivenContext {
  audioContext: OfflineAudioContext;
  /** Move the simulated clock to this many seconds from the render start. */
  setClock: (seconds: number) => void;
}

const createDrivenContext = (durationSeconds: number): DrivenContext => {
  const frameCount = Math.ceil(durationSeconds * SAMPLE_RATE);
  const audioContext = new OfflineAudioContext(
    CHANNEL_COUNT,
    frameCount,
    SAMPLE_RATE,
  );

  // node-web-audio-api reports an offline context as suspended until rendering
  // starts. Exposing its render-ready state prevents live-context resume logic
  // from waiting for a render that has not started yet.
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

/** Verify a rendered buffer, write it, and log its peak. */
const finish = async (
  filename: string,
  buffer: AudioBuffer,
  meta: Omit<RenderResult, "filename" | "peakDbfs">,
): Promise<RenderResult> => {
  const peak = peakLevel(buffer);
  const peakDbfs = toDbfs(peak);

  if (peakDbfs <= SILENCE_THRESHOLD_DBFS) {
    throw new Error(
      `${filename} is silent: ${peakDbfs.toFixed(2)} dBFS is not above ${SILENCE_THRESHOLD_DBFS} dBFS`,
    );
  }
  if (peak > 1) {
    throw new Error(
      `${filename} clips: peak ${peak.toFixed(6)} (${peakDbfs.toFixed(2)} dBFS)`,
    );
  }

  await writeFile(resolve(outputDirectory, filename), encodeWave(buffer));
  console.log(
    `${filename.padEnd(30)} ${String(meta.durationSeconds).padStart(3)}s  ${peakDbfs.toFixed(2)} dBFS`,
  );

  return { filename, peakDbfs, ...meta };
};

// ---------------------------------------------------------------------------
// Solo demos
// ---------------------------------------------------------------------------

/**
 * One instrument alone, over enough time and enough chord changes to hear how
 * it sits on a moving harmony rather than on one static chord.
 *
 * The layer is soloed so nothing else reaches the master bus, but the engine
 * still runs its full arrangement underneath: the progression rotates, so each
 * strike or held note is drawn from whatever chord is in force at that moment.
 */
const renderSolo = async (
  id: string,
  layer: SoundLayer,
  durationSeconds: number,
  demonstrates: string,
  config: string,
  drive: (engine: SoundEngine, tick: (seconds: number) => void) => void,
): Promise<RenderResult> => {
  Math.random = seededRandom(hash(id));
  const { audioContext, setClock } = createDrivenContext(durationSeconds);
  const engine = new SoundEngine(audioContext as unknown as BaseAudioContext);
  await engine.init();
  engine.setCanvasWidth(CANVAS_WIDTH);
  engine.setVolume(VOLUME);
  // The arrangement, minus the energy arc. A solo draws no trails, so the
  // engine correctly reads the canvas as a permanent lull and decays the
  // master to the arc's lull floor (0.12x) — which renders the whole demo
  // twelve decibels down for a reason that has nothing to do with the
  // instrument being auditioned. Everything else, chord rotation included,
  // runs exactly as it does in context.
  engine.setConfig({ ...ARRANGEMENT, energyArc: false });
  engine.setLayerSoloed(layer, true);

  // The progression only advances inside tick(), so a solo has to keep ticking
  // even with no trails on the canvas — otherwise the chord never turns over
  // and the whole point of the longer render is lost.
  const tick = (seconds: number): void => {
    setClock(seconds);
    engine.tick(seconds * 1000, []);
  };

  drive(engine, tick);

  const rendered = (await audioContext.startRendering()) as unknown as AudioBuffer;
  return finish(`${id}.wav`, rendered, {
    label: id,
    demonstrates,
    durationSeconds,
    config,
  });
};

/** Tick the solo clock up to `untilSeconds` at the replay frame rate. */
const advanceTo = (
  tick: (seconds: number) => void,
  fromSeconds: number,
  untilSeconds: number,
): number => {
  const step = 1 / REPLAY_FPS;
  let at = fromSeconds;
  while (at < untilSeconds) {
    at = Math.min(untilSeconds, at + step);
    tick(at);
  }
  return at;
};

const PIZZICATO_SOLO_SECONDS = 20;
const TIMPANI_SOLO_SECONDS = 20;
const CANTUS_SOLO_SECONDS = 45;

/**
 * Fifteen plucks across twenty seconds at varied heights and spacings, so the
 * pitch the height picks is heard against a moving harmony rather than one chord.
 */
const PIZZICATO_STRIKES: Array<{ at: number; y: number }> = [
  { at: 0.6, y: 0.15 },
  { at: 1.4, y: 0.55 },
  { at: 2.1, y: 0.3 },
  { at: 3.6, y: 0.85 },
  { at: 4.4, y: 0.45 },
  { at: 6.2, y: 0.2 },
  { at: 6.9, y: 0.7 },
  { at: 8.4, y: 0.4 },
  { at: 9.8, y: 0.95 },
  { at: 11.5, y: 0.25 },
  { at: 12.3, y: 0.6 },
  { at: 13.1, y: 0.35 },
  { at: 15.0, y: 0.8 },
  { at: 16.7, y: 0.5 },
  { at: 18.2, y: 0.1 },
];

/** Four holds of rising length, spaced so each roll finishes before the next. */
const TIMPANI_HOLDS: Array<{ at: number; seconds: number }> = [
  { at: 1.0, seconds: 0.5 },
  { at: 5.5, seconds: 1.2 },
  { at: 10.5, seconds: 2.5 },
  { at: 15.5, seconds: 1.8 },
];

const renderPizzicatoSolo = (variant: PizzicatoVariant): Promise<RenderResult> =>
  renderSolo(
    `pizzicato-${variant}-solo`,
    "clickBell",
    PIZZICATO_SOLO_SECONDS,
    `${variant} pluck alone, 15 strikes at varied heights across two chord changes`,
    SOLO_CONFIG_SUMMARY("clickBell"),
    (engine, tick) => {
      let at = 0;
      for (const strike of PIZZICATO_STRIKES) {
        at = advanceTo(tick, at, strike.at);
        engine.triggerClickPizzicato(
          CANVAS_WIDTH * (0.2 + strike.y * 0.6),
          CANVAS_HEIGHT * strike.y,
          variant,
        );
      }
      advanceTo(tick, at, PIZZICATO_SOLO_SECONDS);
    },
  );

const renderTimpaniSolo = (variant: TimpaniVariant): Promise<RenderResult> =>
  renderSolo(
    `timpani-${variant}-solo`,
    "clickBell",
    TIMPANI_SOLO_SECONDS,
    `${variant} roll alone, four holds of 0.5s to 2.5s across two chord changes`,
    SOLO_CONFIG_SUMMARY("clickBell"),
    (engine, tick) => {
      let at = 0;
      for (const hold of TIMPANI_HOLDS) {
        at = advanceTo(tick, at, hold.at);
        engine.triggerHold(CANVAS_WIDTH * 0.5, variant, hold.seconds);
      }
      advanceTo(tick, at, TIMPANI_SOLO_SECONDS);
    },
  );

const renderCantusSolo = (variant: CantusVariant): Promise<RenderResult> =>
  renderSolo(
    `cantus-${variant}-solo`,
    "cantus",
    CANTUS_SOLO_SECONDS,
    `${variant} line alone across five chord changes, so the voice-leading between chords is audible`,
    SOLO_CONFIG_SUMMARY("cantus"),
    (engine, tick) => {
      engine.setCantus(variant);
      advanceTo(tick, 0, CANTUS_SOLO_SECONDS);
    },
  );

// ---------------------------------------------------------------------------
// In-context renders, driven from the bundled fixture
// ---------------------------------------------------------------------------

/** Length of every fixture-driven render. Six toggle windows of eight seconds. */
const CONTEXT_SECONDS = 48;
/** How long the candidate stays on, then off, then on again. */
const TOGGLE_WINDOW_SECONDS = 8;
/** Windows the candidate is audible in: 8-16s, 24-32s, 40-48s. */
const TOGGLE_WINDOW_COUNT = CONTEXT_SECONDS / TOGGLE_WINDOW_SECONDS;

/** Whether the candidate is on during the window containing `seconds`. */
const isCandidateOnAt = (seconds: number): boolean => {
  const window = Math.min(
    TOGGLE_WINDOW_COUNT - 1,
    Math.floor(seconds / TOGGLE_WINDOW_SECONDS),
  );
  // Odd windows are on, so the file opens on the arrangement alone and the
  // listener hears the candidate arrive rather than disappear.
  return window % 2 === 1;
};

/** Boundaries a marker tick is sounded at: every toggle except time zero. */
const TOGGLE_BOUNDARY_SECONDS = Array.from(
  { length: TOGGLE_WINDOW_COUNT - 1 },
  (_, index) => (index + 1) * TOGGLE_WINDOW_SECONDS,
);

/** How a fixture render voices clicks and holds on top of the arrangement. */
interface ContextInstruments {
  pizzicato?: PizzicatoVariant;
  timpani?: TimpaniVariant;
  cantus?: CantusVariant;
}

/** A live participant during fixture playback, mirroring the pad's trail. */
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

/** Colours cycled across participants, matching the playground's palette. */
const REPLAY_COLORS = [
  "#4a9a8a",
  "#c4724e",
  "#5b8db8",
  "#d4b85c",
  "#8a6fa8",
  "#6f8a4a",
];

const fixture = fixtureEvents as SampleEvent[];

/**
 * Bounds on what counts as a moderately busy slice. Wide enough that the
 * fixture has real choices inside them, narrow enough to exclude both the
 * near-empty stretches and the frantic ones.
 */
const MIN_SLICE_PARTICIPANTS = 4;
const MAX_SLICE_PARTICIPANTS = 6;
const MIN_SLICE_CLICKS = 14;
const MAX_SLICE_CLICKS = 32;
const MIN_SLICE_HOLDS = 4;
const MIN_CLICKS_PER_TOGGLE_WINDOW = 2;
const MIN_TOGGLE_WINDOWS_WITH_HOLD = 4;
/** Of the three ON windows, how many must contain a hold for the timpani to voice. */
const MIN_ON_WINDOWS_WITH_HOLD = 2;
/**
 * How far before a window's end a hold has to start to count as belonging to
 * it. The timpani's roll runs up to three seconds, so a hold in the last
 * moments of an ON window sounds mostly after the candidate has switched off.
 */
const HOLD_SETTLE_MARGIN_MS = 2_000;
/**
 * The longest a single hold is treated as ringing for. Both voicings cap out:
 * the timpani roll at three seconds, the shipped bell at three times its
 * release. A multi-second archival hold does not sound for its whole recorded
 * duration, so the raw figure would over-reject.
 */
const MAX_HOLD_RING_MS = 4_000;

/**
 * A moderately busy `windowMs` slice of the fixture, rebased to start at zero.
 *
 * The densest window buries the candidate: ten participants clicking through a
 * full arrangement mask a single added instrument, which is exactly why the
 * previous in-context renders were hard to tell apart. What an A/B render
 * needs instead is a stretch busy enough to be real and sparse enough that one
 * more instrument is audible against it, with candidate-driving events spread
 * evenly enough that every toggle window has something to voice.
 *
 * Selection therefore filters on participant count and click rate, then ranks
 * the survivors by how evenly their clicks fall across the toggle windows.
 */
const calmSlice = (
  events: SampleEvent[],
  windowMs: number,
  segmentMs: number,
): SampleEvent[] => {
  const segmentCount = Math.round(windowMs / segmentMs);
  let best: {
    start: number;
    count: number;
    variance: number;
    onClicks: number;
  } | null = null;
  let end = 0;

  for (let start = 0; start < events.length; start++) {
    if (end < start) end = start;
    while (end < events.length && events[end].t < events[start].t + windowMs) {
      end++;
    }
    const slice = events.slice(start, end);
    const cursorEvents = slice.filter((event) => event.type === "cursor");
    const participants = new Set(cursorEvents.map((event) => event.pid)).size;
    if (participants < MIN_SLICE_PARTICIPANTS) continue;
    if (participants > MAX_SLICE_PARTICIPANTS) continue;

    const clicks = cursorEvents.filter((event) => event.event === "click");
    if (clicks.length < MIN_SLICE_CLICKS) continue;
    if (clicks.length > MAX_SLICE_CLICKS) continue;

    const holds = cursorEvents.filter((event) => event.event === "hold");
    if (holds.length < MIN_SLICE_HOLDS) continue;

    const origin = events[start].t;
    const perSegment = new Array<number>(segmentCount).fill(0);
    for (const click of clicks) {
      const segment = Math.min(
        segmentCount - 1,
        Math.floor((click.t - origin) / segmentMs),
      );
      perSegment[segment]++;
    }
    // Every toggle window has to voice at least a couple of clicks, or an
    // eight-second stretch passes with nothing for the candidate to play.
    if (Math.min(...perSegment) < MIN_CLICKS_PER_TOGGLE_WINDOW) continue;

    // The ON windows must carry at least as many clicks as the OFF ones. A
    // window set where the candidate plays over three clicks and the bell it
    // is compared against plays over eight does not measure the instruments
    // against each other, it measures the event density.
    const onClicks = perSegment.reduce(
      (total, count, index) =>
        isCandidateOnAt(index * (segmentMs / 1_000)) ? total + count : total,
      0,
    );
    if (onClicks * 2 < clicks.length) continue;

    // A hold sounds for far longer than its own instant, and the shipped bell
    // stretches its release by up to 3x on a long one. A hold late in a
    // window therefore rings well past the next toggle, putting an OFF
    // window's bell on top of an ON window's candidate and blurring exactly
    // the comparison the file exists to make. Such a slice is rejected
    // outright rather than merely discounted.
    const straddles = holds.some((hold) => {
      const offset = (hold.t - origin) % segmentMs;
      const ringMs = Math.min(
        MAX_HOLD_RING_MS,
        (hold.duration ?? 0) + HOLD_SETTLE_MARGIN_MS,
      );
      return offset + ringMs > segmentMs;
    });
    if (straddles) continue;

    const holdSegments = new Set(
      holds.map((hold) =>
        Math.min(segmentCount - 1, Math.floor((hold.t - origin) / segmentMs)),
      ),
    );
    // Most ON windows have to contain a hold, or the timpani has nothing to
    // voice for a whole eight seconds and that window compares the candidate
    // against nothing.
    //
    // Two of three rather than three of three, because no window in this
    // fixture manages three without also putting a hold across a toggle
    // boundary — holds are rare and clumped. Given the choice, a clean
    // boundary is worth more than a third rolled window: a hold ringing
    // across a toggle contaminates two windows at once, while a missing one
    // only leaves a window quiet. The A/B files for the timpani therefore
    // have one ON window with no roll in it.
    const onWindowsCovered = [...holdSegments].filter((segment) =>
      isCandidateOnAt(segment * (segmentMs / 1_000)),
    ).length;
    if (onWindowsCovered < MIN_ON_WINDOWS_WITH_HOLD) continue;
    if (holdSegments.size < MIN_TOGGLE_WINDOWS_WITH_HOLD) continue;

    const mean = clicks.length / segmentCount;
    const variance =
      perSegment.reduce((total, count) => total + (count - mean) ** 2, 0) /
      segmentCount;

    // Ranked on how much the candidate gets to play, then on evenness, then on
    // size. A slice where every ON window is well fed is worth more than a
    // marginally flatter one, because that is what makes the A/B audible.
    if (
      best === null ||
      onClicks > best.onClicks ||
      (onClicks === best.onClicks &&
        (variance < best.variance ||
          (variance === best.variance && slice.length > best.count)))
    ) {
      best = { start, count: slice.length, variance, onClicks };
    }
  }

  if (!best) {
    throw new Error(
      `no fixture window of ${windowMs}ms matches the calm-slice criteria`,
    );
  }

  const slice = events.slice(best.start, best.start + best.count);
  const origin = slice[0].t;
  return slice.map((event) => ({ ...event, t: event.t - origin }));
};

const CONTEXT_EVENTS = calmSlice(
  fixture,
  CONTEXT_SECONDS * 1_000,
  TOGGLE_WINDOW_SECONDS * 1_000,
);
const CONTEXT_TRACKS: Map<string, MoveTrack> = buildMoveTracks(CONTEXT_EVENTS);

/** How long a toggle takes to reach its new level, short enough to read as a switch. */
const TOGGLE_RAMP_SECONDS = 0.1;

/**
 * Where each candidate is measured, chosen to sit where that instrument
 * differs from what an OFF window leaves behind rather than merely where it
 * has energy.
 *
 * The pizzicato draws its pitch from the same bell palette the shipped click
 * does, so measuring the palette's own range would compare a pluck against a
 * bell on the same notes and find little. What separates them is the attack:
 * the filter sweeps from 2.6-5 kHz down across the decay, so the band sits
 * above the palette. The timpani is the opposite case — it voices the chord
 * root an octave down, below anything the bell reaches. The cantus is a
 * sustained line in the tenor's C3-C4, and its OFF windows contain no cantus
 * at all, so its own register is the right place to look.
 */
const PIZZICATO_BAND: FrequencyBand = { lowHz: 1_800, highHz: 2_800 };
const TIMPANI_BAND: FrequencyBand = { lowHz: 60, highHz: 170 };
const CANTUS_BAND: FrequencyBand = { lowHz: 120, highHz: 560 };

/**
 * Per-candidate bus trims for these renders only, in dB. All zero: every
 * candidate was left at its shipped level.
 *
 * Measured rather than assumed. The pizzicato and timpani do sit well under
 * the arrangement in the full mix — the isolated pluck is around 28 dB below
 * the bed in its own band — but a trim on their bus cannot fix that, because
 * they share `clickBell` with the shipped bell they are being compared
 * against. Lifting the bus lifts the OFF windows by the same amount; measured
 * directly, a +6 dB trim moved the pizzicato's ON/OFF difference the wrong
 * way. The cantus has a bus of its own and so could be trimmed, but does not
 * need it: isolated, it reads more than 40 dB above its OFF windows.
 *
 * Boosting these renders would also misrepresent what is being judged. The
 * question is whether a candidate earns its place in the arrangement as
 * balanced, and the stems already answer the separate question of what each
 * layer contributes on its own.
 */
const PIZZICATO_BOOST_DB = 0;
const TIMPANI_BOOST_DB = 0;
const CANTUS_BOOST_DB = 0;

/** The most a candidate's layer may be lifted for an audition render. */
const MAX_BOOST_DB = 6;

const gainFromDb = (db: number): number => 10 ** (db / 20);

/**
 * The engine's own layer bus, reached for the two things the mixer API does
 * not cover: a per-render gain trim, and a ramp longer than the mixer's
 * built-in 20ms.
 *
 * `setLayerMuted` would work for the toggle, but it ramps in 20ms and resets
 * to unity, so it cannot hold a boost across a toggle. Reading the bus keeps
 * both in one place.
 */
const layerBusOf = (
  engine: SoundEngine,
  layer: SoundLayer,
): GainNode | undefined => {
  const buses = (
    engine as unknown as { layerBuses: Map<SoundLayer, GainNode> }
  ).layerBuses;
  return buses.get(layer);
};

const rampLayerBus = (
  audioContext: OfflineAudioContext,
  engine: SoundEngine,
  layer: SoundLayer,
  target: number,
  seconds: number,
): void => {
  const bus = layerBusOf(engine, layer);
  if (!bus) {
    throw new Error(`layer bus for ${layer} is missing`);
  }
  const now = audioContext.currentTime;
  bus.gain.cancelScheduledValues(now);
  bus.gain.setValueAtTime(bus.gain.value, now);
  bus.gain.linearRampToValueAtTime(target, now + seconds);
};

/** Trim a candidate's bus for this render only, so it clears the bed. */
const applyLayerBoost = (
  engine: SoundEngine,
  audioContext: OfflineAudioContext,
  layer: SoundLayer,
  boostDb: number,
): void => {
  if (boostDb === 0) return;
  if (boostDb > MAX_BOOST_DB) {
    throw new Error(
      `boost for ${layer} is ${boostDb} dB, above the ${MAX_BOOST_DB} dB cap`,
    );
  }
  const bus = layerBusOf(engine, layer);
  if (!bus) {
    throw new Error(`layer bus for ${layer} is missing`);
  }
  bus.gain.setValueAtTime(gainFromDb(boostDb), audioContext.currentTime);
};

/**
 * The marker tick's own path to the destination, bypassing the engine.
 *
 * It has to survive a stem render, where every engine layer except the
 * candidate is muted, and it must not be counted as part of any layer's band
 * energy — so it never touches the engine's graph at all.
 */
const createMarkerBus = (audioContext: OfflineAudioContext): GainNode => {
  const bus = audioContext.createGain();
  bus.gain.value = MARKER_GAIN;
  bus.connect(audioContext.destination);
  return bus;
};

/** Quiet enough to sit under the arrangement, present enough to locate. */
const MARKER_GAIN = 0.045;
/** Well above the candidates' bands, so it never pollutes a band measurement. */
const MARKER_FREQUENCY_HZ = 3_150;

/**
 * A single short woodblock-ish click at a toggle boundary.
 *
 * A filtered sine burst with an near-instant attack and a 40ms decay: enough
 * transient to mark a position in time, too short and too high to be mistaken
 * for one of the instruments being auditioned.
 */
const soundMarkerTick = (
  audioContext: OfflineAudioContext,
  bus: GainNode,
  atSeconds: number,
): void => {
  const osc = audioContext.createOscillator();
  osc.type = "sine";
  osc.frequency.value = MARKER_FREQUENCY_HZ;

  const envelope = audioContext.createGain();
  envelope.gain.setValueAtTime(0, atSeconds);
  envelope.gain.linearRampToValueAtTime(1, atSeconds + 0.002);
  envelope.gain.exponentialRampToValueAtTime(0.0001, atSeconds + 0.04);

  osc.connect(envelope);
  envelope.connect(bus);
  osc.start(atSeconds);
  osc.stop(atSeconds + 0.06);
};

/**
 * What a fixture render does with the layer mixer as the replay runs.
 *
 * `"toggle"` is the A/B format: the same playback throughout, with the
 * candidate switching on and off every eight seconds so the listener compares
 * two versions of one passage instead of two separate files.
 *
 * `"stem"` mutes everything except the candidate, leaving the event-driven
 * timing intact — what the layer contributes rhythmically, with nothing to
 * hear it against.
 *
 * `"full"` leaves the mix alone, which is what the marker tick's own render
 * check uses.
 */
type ContextMode = "toggle" | "stem" | "full";

/** Everything one fixture-driven render needs beyond the shared replay. */
interface ContextRenderOptions {
  id: string;
  demonstrates: string;
  instruments: ContextInstruments;
  mode: ContextMode;
  /**
   * The layer the candidate lives on. Toggling and stemming both act on this,
   * and the fidelity check measures the band it occupies.
   */
  layer: SoundLayer;
  band: FrequencyBand;
  /**
   * Extra gain on the candidate's layer bus for this render only, in dB.
   * Used when the bed still buries the candidate at unity; logged in the
   * README so no one mistakes a boosted render for the shipped balance.
   *
   * Only meaningful for a candidate that has its own bus. The pizzicato and
   * timpani share `clickBell` with the bell they replace, so a trim there
   * lifts both sides of the comparison equally and changes nothing.
   */
  boostDb?: number;
  /**
   * How much of each window to skip before measuring, in seconds.
   *
   * A percussive candidate has decayed within a moment, so a short skip is
   * enough to clear the toggle ramp. The cantus has a three-second attack, so
   * measuring from the top of its ON window would average in the seconds
   * before the note has arrived.
   */
  settleSeconds?: number;
}

/**
 * Replay the fixture slice through the engine at a simulated 60fps.
 *
 * This is the same driver the playground's pad runs, minus the canvas: events
 * fire as their moment arrives, positions come from interpolating each
 * participant's move track rather than from the sparse samples themselves, and
 * the interpolated frames go to `tick` so the engine derives real velocity.
 *
 * The candidate is gated rather than re-triggered: pizzicato, timpani and the
 * shipped bell all share the `clickBell` bus, so a toggle that muted the bus
 * would remove clicks altogether instead of returning them to the arrangement
 * they are being compared against. Driving the trigger choice per window keeps
 * the OFF stretches sounding like the shipped arrangement, which is the thing
 * the candidate has to beat.
 */
const renderContext = async ({
  id,
  demonstrates,
  instruments,
  mode,
  layer,
  band,
  boostDb = 0,
  settleSeconds = 0.5,
}: ContextRenderOptions): Promise<RenderResult> => {
  const rendered = await replayFixture({
    id,
    instruments,
    mode,
    layer,
    boostDb,
    candidateEnabled: true,
  });

  // The same replay with the candidate held off throughout, for the fidelity
  // check to subtract. Seeded identically, so everything except the candidate
  // cancels.
  const toggleDeltaDb =
    mode === "toggle"
      ? assertTogglesAudible(
          id,
          rendered,
          await replayFixture({
            id,
            instruments,
            mode,
            layer,
            boostDb,
            candidateEnabled: false,
          }),
          band,
          settleSeconds,
        )
      : undefined;

  const added = [
    instruments.pizzicato ? `pizzicato ${instruments.pizzicato} on clicks` : "",
    instruments.timpani ? `timpani ${instruments.timpani} on holds` : "",
    instruments.cantus ? `cantus ${instruments.cantus}` : "",
  ].filter(Boolean);

  const modeSummary =
    mode === "toggle"
      ? `A/B toggle every ${TOGGLE_WINDOW_SECONDS}s (on 8-16s, 24-32s, 40-48s)`
      : mode === "stem"
        ? `${layer} stem, every other layer muted`
        : "full mix";
  const boostSummary =
    boostDb === 0 ? "" : `; ${layer} bus +${boostDb} dB for this render`;

  return finish(`${id}.wav`, rendered, {
    label: id,
    demonstrates,
    durationSeconds: CONTEXT_SECONDS,
    toggleDeltaDb,
    config: `${ARRANGEMENT_SUMMARY}; ${
      added.length === 0 ? "no added instruments" : added.join(", ")
    }; ${modeSummary}${boostSummary}; chord dwell ${DEMO_CHORD_DWELL_MS / 1000}s`,
  });
};

/** One pass of the fixture replay, returning the rendered buffer. */
interface ReplayOptions {
  id: string;
  instruments: ContextInstruments;
  mode: ContextMode;
  layer: SoundLayer;
  boostDb: number;
  /**
   * False renders the reference pass: the candidate never sounds, whatever the
   * toggle schedule says. Everything else — seed, events, marker ticks, the
   * arrangement — is identical, which is what lets the two be subtracted.
   */
  candidateEnabled: boolean;
}

const replayFixture = async ({
  id,
  instruments,
  mode,
  layer,
  boostDb,
  candidateEnabled,
}: ReplayOptions): Promise<AudioBuffer> => {
  Math.random = seededRandom(hash(id));
  const { audioContext, setClock } = createDrivenContext(CONTEXT_SECONDS);
  const engine = new SoundEngine(audioContext as unknown as BaseAudioContext);
  await engine.init();
  engine.setCanvasWidth(CANVAS_WIDTH);
  engine.setVolume(VOLUME);
  engine.setConfig({ ...ARRANGEMENT });

  // A stem silences every other family through the mixer, so the candidate is
  // heard against the same event timing with nothing underneath it.
  if (mode === "stem") {
    for (const other of SOUND_LAYERS) {
      if (other !== layer) engine.setLayerMuted(other, true);
    }
  }

  applyLayerBoost(engine, audioContext, layer, boostDb);

  // The cantus is autonomous, so a toggle render starts it silent and lets the
  // gate below switch it in; the others voice per event and need it running.
  if (instruments.cantus && mode !== "toggle" && candidateEnabled) {
    engine.setCantus(instruments.cantus);
  }

  const markerBus = createMarkerBus(audioContext);

  const trails = new Map<string, ReplayTrail>();
  let nextTrailIndex = 0;
  let cursor = 0;
  const stepMs = 1_000 / REPLAY_FPS;

  // Toggle state, tracked so the ramp and the marker fire once per boundary
  // rather than on every frame inside a window.
  let candidateOn =
    candidateEnabled && (mode === "toggle" ? isCandidateOnAt(0) : true);
  let nextBoundaryIndex = 0;

  for (let frameIndex = 0; ; frameIndex++) {
    const sampleMs = frameIndex * stepMs;
    if (sampleMs > CONTEXT_SECONDS * 1_000) break;
    const sampleSeconds = sampleMs / 1_000;
    setClock(sampleSeconds);

    if (mode === "toggle") {
      const boundary = TOGGLE_BOUNDARY_SECONDS[nextBoundaryIndex];
      if (boundary !== undefined && sampleSeconds >= boundary) {
        nextBoundaryIndex++;
        candidateOn = candidateEnabled && isCandidateOnAt(sampleSeconds);
        // The cantus sustains, so it is switched through its layer bus with a
        // ramp; a hard stop mid-note would click.
        if (instruments.cantus && candidateEnabled) {
          if (candidateOn) engine.setCantus(instruments.cantus);
          rampLayerBus(
            audioContext,
            engine,
            layer,
            candidateOn ? gainFromDb(boostDb) : 0,
            TOGGLE_RAMP_SECONDS,
          );
        }
        soundMarkerTick(audioContext, markerBus, sampleSeconds);
      }
    }

    while (
      cursor < CONTEXT_EVENTS.length &&
      CONTEXT_EVENTS[cursor].t <= sampleMs
    ) {
      const event = CONTEXT_EVENTS[cursor++];
      const x = (event.x ?? 0.5) * CANVAS_WIDTH;
      const y = (event.y ?? 0.5) * CANVAS_HEIGHT;

      if (event.type === "navigation") {
        // Only real page arrivals sound; blur and beforeunload are departures.
        if (event.event === "focus" || event.event === "popstate") {
          engine.triggerNavigation({ x });
        }
        continue;
      }
      // Keyboard and viewport events belong to the percussion candidates,
      // which are not what these renders are auditioning.
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

      const isHold = event.event === "hold" || event.duration !== undefined;
      // A stem has no bed to fall back to, so its OFF-window equivalent is
      // simply nothing: only the candidate's own events are voiced.
      const voiceCandidate = candidateOn;
      const rolled = Boolean(instruments.timpani) && isHold && voiceCandidate;

      if (rolled && instruments.timpani) {
        engine.triggerHold(
          x,
          instruments.timpani,
          event.duration === undefined ? undefined : event.duration / 1_000,
        );
      }

      if (instruments.pizzicato && voiceCandidate) {
        engine.triggerClickPizzicato(x, y, instruments.pizzicato);
      } else if (!rolled && mode !== "stem") {
        // The shipped bell: what an OFF window reverts to, and what a
        // percussion candidate replaces rather than layers onto. A stem skips
        // it, since the bell is the bed the stem exists to remove.
        engine.triggerClick({ x, y, holdDuration: event.duration });
      }
    }

    for (const trail of trails.values()) {
      const track = CONTEXT_TRACKS.get(trail.pid);
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
        identityKey: `sample-${trail.pid}`,
      });
      trail.firstSeen = false;
    }

    engine.tick(sampleMs, frames);
  }

  return (await audioContext.startRendering()) as unknown as AudioBuffer;
};

/**
 * Prove the toggles changed the audio, and return by how much.
 *
 * A file where the gating silently failed would still pass the peak and clip
 * checks — it would just be a candidate playing (or not playing) for the whole
 * forty-eight seconds, which is precisely the "they all sound the same"
 * problem these renders exist to fix.
 *
 * Comparing the A/B file's own ON windows against its own OFF windows does not
 * work, and the reason is worth recording: the arrangement is far louder than
 * any one candidate, and it moves on its own. Measured that way the bed's
 * drift between two stretches of the timeline is several times larger than the
 * candidate's whole contribution, so the number says more about which eight
 * seconds of music happened to be louder than about the instrument. The cantus
 * makes it worse still — its three-second attack and four-second release are
 * comparable to the window itself, so a note switched on in one window is
 * still sounding through the next.
 *
 * So the candidate is isolated instead: the same render runs a second time
 * with the candidate never enabled, and the reference is subtracted from the
 * A/B pass sample by sample. Every seed is identical, so the bed cancels
 * exactly and the residual *is* the candidate. Its band RMS during the ON
 * windows then has to clearly exceed the OFF windows, where the residual
 * should be near silence.
 */
const assertTogglesAudible = (
  id: string,
  buffer: AudioBuffer,
  reference: AudioBuffer,
  band: FrequencyBand,
  settleSeconds: number,
): number => {
  const residual = differenceBuffer(buffer, reference);
  const onWindows: number[] = [];
  const offWindows: number[] = [];

  for (let window = 0; window < TOGGLE_WINDOW_COUNT; window++) {
    const from = window * TOGGLE_WINDOW_SECONDS + settleSeconds;
    const to = (window + 1) * TOGGLE_WINDOW_SECONDS;
    const rms = bandRms(residual, band, from, to);
    (isCandidateOnAt(window * TOGGLE_WINDOW_SECONDS) ? onWindows : offWindows)
      .push(rms);
  }

  const mean = (values: number[]): number =>
    values.reduce((total, value) => total + value, 0) / values.length;
  const onDb = toDbfs(mean(onWindows));
  // A candidate that never sounds outside its ON windows leaves a residual of
  // literal zeroes, which reads as an absurd delta and drowns the number that
  // matters. Floored at the 16-bit noise level the WAV is written at, so the
  // figure means "below anything the file can represent" rather than "-600 dB".
  const offDb = Math.max(toDbfs(mean(offWindows)), SIXTEEN_BIT_FLOOR_DBFS);
  const deltaDb = onDb - offDb;

  console.log(
    `  ${id}: candidate-only ${band.lowHz}-${band.highHz} Hz RMS on ${onDb.toFixed(2)} dBFS, ` +
      `off ${offDb.toFixed(2)} dBFS, delta +${deltaDb.toFixed(2)} dB`,
  );

  if (!(deltaDb > MIN_TOGGLE_DELTA_DB)) {
    throw new Error(
      `${id}: isolated candidate is only ${deltaDb.toFixed(2)} dB louder during ON windows ` +
        `(${onDb.toFixed(2)} dBFS) than OFF windows (${offDb.toFixed(2)} dBFS), under the ` +
        `${MIN_TOGGLE_DELTA_DB} dB floor — the toggles are not changing the audio`,
    );
  }

  return deltaDb;
};

/**
 * The A/B pass minus its candidate-free reference: what the candidate alone
 * contributed, including how it changed everything downstream of it.
 */
const differenceBuffer = (
  buffer: AudioBuffer,
  reference: AudioBuffer,
): AudioBuffer => {
  if (
    buffer.length !== reference.length ||
    buffer.numberOfChannels !== reference.numberOfChannels
  ) {
    throw new Error("A/B render and its reference render do not match in shape");
  }
  const residual = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  ).createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const mixed = buffer.getChannelData(channel);
    const bed = reference.getChannelData(channel);
    const out = residual.getChannelData(channel);
    for (let index = 0; index < mixed.length; index++) {
      out[index] = mixed[index] - bed[index];
    }
  }
  return residual as unknown as AudioBuffer;
};

/**
 * How much louder the isolated candidate must be in its ON windows. The
 * residual in an OFF window is not perfectly zero — a candidate that replaces
 * the shipped bell leaves that bell in the difference — so the floor sits well
 * clear of zero rather than at it.
 */
const MIN_TOGGLE_DELTA_DB = 3;

/**
 * Quantisation floor of a 16-bit WAV, used to clamp a residual of exact zeroes
 * so the reported delta stays a number a reader can interpret.
 */
const SIXTEEN_BIT_FLOOR_DBFS = -96;

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------

const readme = (results: RenderResult[], slice: SampleEvent[]): string => {
  const participants = new Set(slice.map((event) => event.pid)).size;
  const clicks = slice.filter(
    (event) => event.type === "cursor" && event.event === "click",
  ).length;
  const holds = slice.filter(
    (event) => event.type === "cursor" && event.event === "hold",
  ).length;
  const navigations = slice.filter(
    (event) =>
      event.type === "navigation" &&
      (event.event === "focus" || event.event === "popstate"),
  ).length;

  const rows = results
    .map(
      ({
        filename,
        demonstrates,
        durationSeconds,
        peakDbfs,
        toggleDeltaDb,
        config,
      }) =>
        `| [${filename}](./${filename}) | ${demonstrates} | ${durationSeconds}s | ${peakDbfs.toFixed(2)} dBFS | ${
          toggleDeltaDb === undefined
            ? "—"
            : `+${toggleDeltaDb.toFixed(2)} dB`
        } | ${config} |`,
    )
    .join("\n");

  const boosts = [
    ["pizzicato", PIZZICATO_BOOST_DB],
    ["timpani", TIMPANI_BOOST_DB],
    ["cantus", CANTUS_BOOST_DB],
  ].filter(([, db]) => db !== 0) as Array<[string, number]>;

  const boostNote =
    boosts.length === 0
      ? `**No gain boosts were applied.** Every candidate plays at its shipped level.

The pizzicato and timpani genuinely do sit well under the arrangement — isolated,
the pluck measures around 28 dB below the bed in its own band — but a boost cannot
fix that here, because both share a bus with the click bell they replace. Lifting
that bus lifts the thing they are being compared against by the same amount; tried
directly, +6 dB moved the pizzicato's ON/OFF difference the wrong way. The cantus
has its own bus and could be lifted, but does not need it. If the plucks turn out
to be too quiet to judge in the full mix, the honest fix is a change to the
instrument's own level in the engine, not a trim in the renderer — and the stems
are there to hear each candidate with nothing over it.`
      : `Gain boosts applied to these renders only, so a candidate that the bed
would otherwise bury can be judged: ${boosts
          .map(([name, db]) => `${name} +${db} dB`)
          .join(", ")}. The cap is ${MAX_BOOST_DB} dB, and the shipped balance is
unchanged.`;

  return `# Sound candidate samples

Three kinds of render, all from the production \`SoundEngine\`.

**Solos** put one candidate alone on the master bus by soloing its layer, while
the full arrangement keeps running underneath — so the plucks, rolls and cantus
notes are drawn from a chord progression that turns over several times during
the render, not from one static chord.

**A/B toggle** renders (\`ab-*.wav\`) are the ones to listen to first. Each is
the same ${CONTEXT_SECONDS} seconds of real playback throughout, with only the candidate
switching on and off every ${TOGGLE_WINDOW_SECONDS} seconds:

| 0-8s | 8-16s | 16-24s | 24-32s | 32-40s | 40-48s |
| --- | --- | --- | --- | --- | --- |
| off | **on** | off | **on** | off | **on** |

A short high tick marks each boundary. Comparing two adjacent windows of one
file is the comparison that matters — the previous round's format put each
candidate in its own file over the busiest stretch of the fixture, and they
were near-impossible to tell apart.

An OFF window is not silence: for the pizzicato and timpani it is the shipped
click bell, since those candidates *replace* the bell rather than layer onto
it. So the toggle is candidate versus the arrangement as it ships, which is
what the candidate has to beat. The cantus belongs to no event, so its OFF
windows simply have no cantus in them.

**Stems** (\`stem-*.wav\`) are the same slice with everything except the
candidate muted, event timing intact — one per family, so what the layer
contributes rhythmically can be heard with nothing over it.

## The slice

Every fixture-driven render replays the same window of the bundled event
fixture (\`extension/website/sounds/sampleEvents.json\`) through the engine at a
simulated 60fps, using the replay helpers the sound playground's pad uses:
cursor moves are interpolated between sparse archival samples so the engine
derives real velocity, clicks and holds drive the candidate, and page arrivals
sound the navigation note.

The window is chosen for moderate activity rather than maximum: **${slice.length} events,
${participants} participants, ${clicks} clicks, ${holds} holds, ${navigations} arrivals** across ${CONTEXT_SECONDS}s. The busiest
${CONTEXT_SECONDS}s of the same fixture carries about half again as many events and ten
participants, and it masked the single-layer difference these files exist to
show. Selection also requires clicks in every toggle window and holds in most
of them, so no eight-second stretch passes with nothing for the candidate to
voice.

${boostNote}

Chord dwell is shortened to ${DEMO_CHORD_DWELL_MS / 1000}s for these renders (the shipped base is
${BASE_CHORD_DWELL_MS / 1000}s) so a sample shorter than a minute still hears the harmony move. The
override lives in the render script and applies to the render process only.

## Render matrix

\`ON−OFF\` is the A/B fidelity check: how much louder the *isolated* candidate is
during the ON windows than the OFF ones, in its own frequency band. Each A/B file
is rendered twice — once as published, once with the candidate never enabled —
and the second subtracted from the first, which cancels the arrangement exactly
and leaves the candidate alone. Comparing the published file's own windows
against each other does not work: the bed is far louder than any one candidate
and drifts on its own, so that number describes the music rather than the
instrument.

| File | What it demonstrates | Duration | Peak | ON−OFF | Config |
| --- | --- | --- | --- | --- | --- |
${rows}

Each render is checked directly from its floating-point audio buffer. A passing
file has a peak above ${SILENCE_THRESHOLD_DBFS} dBFS and no sample above 0 dBFS. Every A/B file is
checked once more, by the isolation described above: the candidate has to be at
least ${MIN_TOGGLE_DELTA_DB} dB louder during its ON windows than its OFF ones, or the render fails.
Without that check a file whose gating silently broke would still pass — it
would just be a candidate playing, or not playing, for all ${CONTEXT_SECONDS} seconds. The
measurement ignores the first half-second of each window so a toggle ramp or a
note decaying from the previous window is not credited to the wrong one.

One known gap: no window in this fixture puts a hold in all three ON windows
without also putting one across a toggle boundary. A clean boundary was worth
more, so the timpani A/B file has one ON window (8-16s) with no roll in it.

The renderer seeds procedural noise, so regenerating from the same code
produces the same files.

## Regenerate

From \`scripts/sound-samples/\`:

\`\`\`sh
bun install --frozen-lockfile
bun run render
\`\`\`

The command replaces the WAV files and this README in
\`internal-docs/sound-samples/\`, and logs every file's peak level.
`;
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

await mkdir(outputDirectory, { recursive: true });

// Shorten the dwell for the duration of this process only. Every progression
// is scaled by the same ratio, so a rotation that deliberately holds longer
// (breath) keeps its relative pacing.
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

const results: RenderResult[] = [];
try {
  for (const variant of ["soft", "crisp", "double"] as PizzicatoVariant[]) {
    results.push(await renderPizzicatoSolo(variant));
  }
  for (const variant of ["root", "rootFifth", "swell"] as TimpaniVariant[]) {
    results.push(await renderTimpaniSolo(variant));
  }
  for (const variant of ["tenor", "soprano", "duet"] as CantusVariant[]) {
    results.push(await renderCantusSolo(variant));
  }

  for (const variant of ["soft", "crisp", "double"] as PizzicatoVariant[]) {
    results.push(
      await renderContext({
        id: `ab-pizzicato-${variant}`,
        demonstrates: `${variant} pluck against the shipped bell: same passage, candidate toggling every ${TOGGLE_WINDOW_SECONDS}s`,
        instruments: { pizzicato: variant },
        mode: "toggle",
        layer: "clickBell",
        band: PIZZICATO_BAND,
        boostDb: PIZZICATO_BOOST_DB,
      }),
    );
  }
  results.push(
    await renderContext({
      id: "ab-timpani-root",
      demonstrates: `root roll against the shipped bell on held clicks, toggling every ${TOGGLE_WINDOW_SECONDS}s`,
      instruments: { timpani: "root" },
      mode: "toggle",
      layer: "clickBell",
      band: TIMPANI_BAND,
      boostDb: TIMPANI_BOOST_DB,
    }),
  );
  for (const variant of ["tenor", "soprano", "duet"] as CantusVariant[]) {
    results.push(
      await renderContext({
        id: `ab-cantus-${variant}`,
        demonstrates: `${variant} cantus line switching in and out of the arrangement every ${TOGGLE_WINDOW_SECONDS}s`,
        instruments: { cantus: variant },
        mode: "toggle",
        layer: "cantus",
        band: CANTUS_BAND,
        boostDb: CANTUS_BOOST_DB,
      }),
    );
  }

  // One stem per family — the representative variant only, since a stem
  // answers a rhythmic question that the variants share.
  results.push(
    await renderContext({
      id: "stem-pizzicato-soft",
      demonstrates:
        "only the soft pluck, on the real click timing, with the arrangement muted",
      instruments: { pizzicato: "soft" },
      mode: "stem",
      layer: "clickBell",
      band: PIZZICATO_BAND,
    }),
  );
  results.push(
    await renderContext({
      id: "stem-timpani-root",
      demonstrates:
        "only the root roll, on the real hold timing, with the arrangement muted",
      instruments: { timpani: "root" },
      mode: "stem",
      layer: "clickBell",
      band: TIMPANI_BAND,
    }),
  );
  results.push(
    await renderContext({
      id: "stem-cantus-tenor",
      demonstrates:
        "only the tenor cantus line, with the arrangement muted, so its pacing is heard alone",
      instruments: { cantus: "tenor" },
      mode: "stem",
      layer: "cantus",
      band: CANTUS_BAND,
    }),
  );
} finally {
  for (const progression of Object.values(PROGRESSIONS)) {
    progression.dwellScale = originalDwellScales.get(progression.id) ?? 1;
  }
}

await writeFile(
  resolve(outputDirectory, "README.md"),
  readme(results, CONTEXT_EVENTS),
);
console.log(`\nRendered ${results.length} files to ${outputDirectory}`);
