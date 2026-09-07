// ABOUTME: Renders busy scenes offline and scans the float buffers for sample-to-sample discontinuities.
// ABOUTME: Mechanical acceptance test for crackle, run before and after every gain-path change.

import { OfflineAudioContext } from "node-web-audio-api";
import { SoundEngine } from "../../extension/website/shared/sound/SoundEngine";
import { PROGRESSIONS } from "../../extension/website/shared/sound/scales";
import type {
  SoloistVoice,
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
const CANVAS_WIDTH = 1_200;
const CANVAS_HEIGHT = 800;
const VOLUME = 0.5;
const REPLAY_FPS = 60;
const TRAIL_IDLE_TIMEOUT_MS = 4_000;

/**
 * The chord dwell the renders run at, so a scan under a minute still crosses
 * several rotations. Applied by overriding each progression's `dwellScale` for
 * the life of this process only, exactly as the sample renderer does.
 */
const DEMO_CHORD_DWELL_MS = 8_000;
const BASE_CHORD_DWELL_MS = 20_000;

Object.assign(globalThis, {
  window: { innerWidth: CANVAS_WIDTH, innerHeight: CANVAS_HEIGHT },
});

/**
 * What separates a click from a loud note, and why a raw jump threshold will
 * not do it.
 *
 * The obvious detector — flag any sample-to-sample step above some size — has
 * no setting that works. Set against full scale it is useless here: the whole
 * arrangement peaks around 0.3 and one flourish note peaks at 0.056, so every
 * note in the engine could be hard-cut without tripping a 0.25 threshold and
 * the scan would report zero on a thoroughly broken engine. Set low enough to
 * catch a cut of one note, it fires constantly on legitimate high-frequency
 * content, whose own per-sample slew is amplitude x omega / rate — a clean
 * 3.15kHz tone at 0.35 steps by 0.15 every sample, three times larger than the
 * cut we need to catch.
 *
 * So the measure is the second difference — how much the waveform's slope
 * changes in one sample — normalised by the local amplitude. A band-limited
 * waveform's slope turns gradually, giving a ratio of roughly (omega / rate)^2;
 * a discontinuity removes the whole local amplitude in one step, so its second
 * difference is as large as the amplitude itself and the ratio approaches 1.
 *
 * Measured across the frequencies the engine reaches: clean tones read 0.0014
 * at 200Hz, 0.0062 at 440Hz, 0.041 at 1.4kHz and 0.20 at 3.15kHz, while a hard
 * cut reads 1.00 to 1.20 at every one of those frequencies and at any
 * amplitude, the normalisation having removed the level from the measure.
 *
 * 0.5 sits between the two populations with more than a factor of two of
 * margin on each side. `verifyThreshold` re-proves both ends on every run.
 */
const CLICK_RATIO_THRESHOLD = 0.5;

/**
 * Window used for the local amplitude estimate, in samples — about 1.5ms,
 * short enough to track an envelope and long enough to span a cycle of
 * everything above roughly 700Hz.
 */
const AMPLITUDE_WINDOW = 64;

/**
 * Amplitude below which a discontinuity is not worth reporting. A step inside
 * a signal this quiet is inaudible under the arrangement, and normalising by a
 * near-zero amplitude turns numerical noise into a large ratio.
 */
const MIN_AUDIBLE_AMPLITUDE = 0.002;

/**
 * Peak amplitude of one flourish note alone, measured by rendering a single
 * click bell into a silent context. The calibration's injected fault is scaled
 * to this rather than to full scale, so the check proves the detector catches
 * a cut of the quietest thing worth catching.
 */
const SINGLE_NOTE_PEAK = 0.056;

interface ClickHit {
  channel: number;
  sampleIndex: number;
  seconds: number;
  /** Second difference over local amplitude — see CLICK_RATIO_THRESHOLD. */
  ratio: number;
  amplitude: number;
}

interface ScanReport {
  label: string;
  durationSeconds: number;
  peak: number;
  maxRatio: number;
  hits: ClickHit[];
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

/**
 * Every discontinuity above the threshold, with the worst first.
 *
 * Scanning the rendered floats rather than the scheduled automation is what
 * makes this an acceptance test: it catches a discontinuity whatever produced
 * it, including one from a node stopped mid-cycle that no AudioParam audit
 * would see.
 *
 * A single click spans a few samples once the rest of the graph's filtering is
 * accounted for, so consecutive flagged samples are collapsed into one hit at
 * their worst point — otherwise one audible click would be counted several
 * times and the count would say more about filter length than about faults.
 */
const CLICK_MERGE_SAMPLES = 32;

const scanForClicks = (buffer: AudioBuffer, label: string): ScanReport => {
  const hits: ClickHit[] = [];
  let maxRatio = 0;
  let peak = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (const sample of samples) {
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }

    let lastHitIndex = Number.NEGATIVE_INFINITY;
    for (let index = AMPLITUDE_WINDOW; index < samples.length; index++) {
      let amplitude = 0;
      for (let k = index - AMPLITUDE_WINDOW; k < index; k++) {
        const magnitude = Math.abs(samples[k]);
        if (magnitude > amplitude) amplitude = magnitude;
      }
      if (amplitude < MIN_AUDIBLE_AMPLITUDE) continue;

      const secondDifference = Math.abs(
        samples[index] - 2 * samples[index - 1] + samples[index - 2],
      );
      const ratio = secondDifference / amplitude;
      if (ratio > maxRatio) maxRatio = ratio;
      if (ratio <= CLICK_RATIO_THRESHOLD) continue;

      if (index - lastHitIndex <= CLICK_MERGE_SAMPLES) {
        const previous = hits[hits.length - 1];
        if (ratio > previous.ratio) {
          previous.ratio = ratio;
          previous.sampleIndex = index;
          previous.seconds = index / buffer.sampleRate;
          previous.amplitude = amplitude;
        }
      } else {
        hits.push({
          channel,
          sampleIndex: index,
          seconds: index / buffer.sampleRate,
          ratio,
          amplitude,
        });
      }
      lastHitIndex = index;
    }
  }

  hits.sort((a, b) => b.ratio - a.ratio);
  return {
    label,
    durationSeconds: buffer.length / buffer.sampleRate,
    peak,
    maxRatio,
    hits,
  };
};

/**
 * An offline context whose clock the caller drives, so a synchronous replay
 * renders as the timeline it represents rather than stacking onto instant
 * zero. Same construction the sample renderer uses.
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

/** The arrangement every scan runs against, matching the sample renderer's. */
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

const REPLAY_COLORS = [
  "#4a9a8a",
  "#c4724e",
  "#5b8db8",
  "#d4b85c",
  "#8a6fa8",
  "#6f8a4a",
];

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
 * The sample renderer deliberately picks a *calm* slice so one candidate
 * instrument stays audible. A crackle scan wants the opposite: the densest
 * stretch the archive actually contains, because that is where the voice
 * count, the promotion churn and the note budget are all under the most
 * pressure.
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

/**
 * A scene the engine is driven through, as a function from tick time to the
 * frames that tick sees. Fixture replay and the synthetic worst case are both
 * expressed this way so the scan loop below is shared.
 */
interface Scene {
  id: string;
  durationSeconds: number;
  soloistVoice: SoloistVoice;
  /** Frames for one tick, plus any events the driver should fire first. */
  advance: (engine: SoundEngine, sampleMs: number) => TrailSoundFrame[];
}

const fixtureScene = (
  id: string,
  soloistVoice: SoloistVoice,
  durationSeconds: number,
): Scene => {
  const events = busiestSlice(fixture, durationSeconds * 1_000);
  const tracks: Map<string, MoveTrack> = buildMoveTracks(events);
  const trails = new Map<string, ReplayTrail>();
  let nextTrailIndex = 0;
  let cursor = 0;

  return {
    id,
    durationSeconds,
    soloistVoice,
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

        if (event.event === "click" || event.event === "hold") {
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
          identityKey: `scan-${trail.pid}`,
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
 * The synthetic worst case: many trails, one of which sweeps fast enough to
 * take the spotlight, with the sweep handed to a different trail every
 * `SWEEP_HANDOVER_MS` so promotions and demotions churn far faster than any
 * recorded scene produces them, and a dense click stream so the flourish note
 * budget is under constant eviction pressure.
 *
 * This is deliberately harsher than the archive: a scan that passes here has
 * headroom, and a regression in the soloist or eviction paths shows up as
 * clicks long before a listener would catch it in the fixture.
 */
const sweepScene = (
  id: string,
  soloistVoice: SoloistVoice,
  durationSeconds: number,
): Scene => {
  let lastClickMs = 0;
  const phase = (index: number): number => index * 0.7;

  return {
    id,
    durationSeconds,
    soloistVoice,
    advance: (engine, sampleMs) => {
      const seconds = sampleMs / 1_000;
      const sweeper = Math.floor(sampleMs / SWEEP_HANDOVER_MS) %
        SWEEP_TRAIL_COUNT;

      if (sampleMs - lastClickMs >= SWEEP_CLICK_INTERVAL_MS) {
        lastClickMs = sampleMs;
        const step = Math.round(sampleMs / SWEEP_CLICK_INTERVAL_MS);
        engine.triggerClick({
          x: ((step * 137) % CANVAS_WIDTH),
          y: ((step * 61) % CANVAS_HEIGHT),
          // Every fourth click is a hold, so the held-click path and the
          // longer decays it schedules are exercised too.
          holdDuration: step % 4 === 0 ? 900 : undefined,
        });
      }

      const frames: TrailSoundFrame[] = [];
      for (let index = 0; index < SWEEP_TRAIL_COUNT; index++) {
        // The sweeper races across the full canvas several times a second;
        // everyone else drifts slowly, so the scene average stays low and the
        // sweeper clears the promotion ratio.
        const isSweeper = index === sweeper;
        const rate = isSweeper ? 6.5 : 0.25;
        const x =
          CANVAS_WIDTH *
          (0.5 + 0.48 * Math.sin(seconds * rate + phase(index)));
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

/** Drive one scene through the engine and return the rendered buffer. */
const renderScene = async (scene: Scene): Promise<AudioBuffer> => {
  Math.random = seededRandom(hash(scene.id));
  const { audioContext, setClock } = createDrivenContext(scene.durationSeconds);
  const engine = new SoundEngine(audioContext as unknown as BaseAudioContext);
  await engine.init();
  engine.setCanvasWidth(CANVAS_WIDTH);
  engine.setVolume(VOLUME);
  engine.setConfig({ ...ARRANGEMENT, soloistVoice: scene.soloistVoice });

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

/**
 * Prove the threshold discriminates before trusting any count it produces.
 *
 * A scanner whose threshold sits above anything the engine can produce would
 * report zero on a thoroughly broken engine, so neither end is assumed. Each
 * run renders a clean tone at the arrangement's own peak level with the
 * fastest envelope the engine uses and asserts zero hits, then hard-stops a
 * tone at one note's peak level and asserts the cut is caught.
 */
const verifyThreshold = async (): Promise<void> => {
  /**
   * The clean reference runs at the arrangement's peak and above the top of
   * the sustained voices' register, so its own waveform slew is at least as
   * steep as anything a real render contains.
   */
  const CLEAN_PEAK = 0.35;
  const CLEAN_HZ = 1_400;
  /** The engine's fastest envelope: the percussive pluck's 5ms attack. */
  const FASTEST_ATTACK_SECONDS = 0.005;

  const buildTone = async (hardCut: boolean): Promise<AudioBuffer> => {
    const ctx = new OfflineAudioContext(CHANNEL_COUNT, SAMPLE_RATE, SAMPLE_RATE);
    const osc = ctx.createOscillator();
    // A sine, because a sawtooth's own reset edge is a real discontinuity and
    // would be flagged correctly. The engine's sawtooth and square voices are
    // the band-limited built-ins, which contain no such edge.
    osc.type = "sine";
    osc.frequency.value = CLEAN_HZ;
    const peak = hardCut ? SINGLE_NOTE_PEAK : CLEAN_PEAK;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(peak, FASTEST_ATTACK_SECONDS);
    if (!hardCut) gain.gain.linearRampToValueAtTime(0, 0.99);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(0);
    // The injected fault: one note's worth of oscillator stopped at its peak,
    // which is what an eviction that disconnects without fading produces. The
    // stop time is a quarter cycle past a whole number of periods, so it lands
    // on the crest rather than on a zero crossing where a cut would leave no
    // step at all. The clean tone instead reaches silence before its own stop.
    osc.stop(hardCut ? 0.5 + 0.25 / CLEAN_HZ : 1);
    return (await ctx.startRendering()) as unknown as AudioBuffer;
  };

  const clean = scanForClicks(await buildTone(false), "calibration-clean");
  if (clean.hits.length !== 0) {
    throw new Error(
      `threshold calibration failed: a clean envelope flagged ${clean.hits.length} clicks (max ratio ${clean.maxRatio.toFixed(4)})`,
    );
  }

  const cut = scanForClicks(await buildTone(true), "calibration-hard-cut");
  if (cut.hits.length === 0) {
    throw new Error(
      `threshold calibration failed: a hard cut of one note's amplitude was not caught (max ratio ${cut.maxRatio.toFixed(4)})`,
    );
  }

  console.log(
    `calibration ok: clean ${CLEAN_HZ}Hz at peak ${CLEAN_PEAK} reads ${clean.maxRatio.toFixed(4)}, ` +
      `one-note hard cut reads ${cut.maxRatio.toFixed(4)}, threshold ${CLICK_RATIO_THRESHOLD}\n`,
  );
};

const SCAN_SECONDS = 40;

const SCENES: Scene[] = [];

const report = (scan: ScanReport): void => {
  const worst = scan.hits
    .slice(0, 5)
    .map(
      (hit) =>
        `${hit.seconds.toFixed(3)}s ch${hit.channel} ratio ${hit.ratio.toFixed(2)} amp ${hit.amplitude.toFixed(3)}`,
    )
    .join(", ");
  console.log(
    `${scan.label.padEnd(28)} clicks ${String(scan.hits.length).padStart(5)}  ` +
      `max ratio ${scan.maxRatio.toFixed(4)}  peak ${scan.peak.toFixed(4)}` +
      (worst ? `\n${" ".repeat(30)}worst: ${worst}` : ""),
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

let totalClicks = 0;
try {
  await verifyThreshold();

  SCENES.push(
    fixtureScene("busy-fixture-bells", "bells", SCAN_SECONDS),
    fixtureScene("busy-fixture-arpeggio", "arpeggio", SCAN_SECONDS),
    sweepScene("sweeps-bells", "bells", SCAN_SECONDS),
    sweepScene("sweeps-arpeggio", "arpeggio", SCAN_SECONDS),
    sweepScene("sweeps-descant", "descant", SCAN_SECONDS),
  );

  for (const scene of SCENES) {
    const scan = scanForClicks(await renderScene(scene), scene.id);
    report(scan);
    totalClicks += scan.hits.length;
  }
} finally {
  for (const progression of Object.values(PROGRESSIONS)) {
    progression.dwellScale = originalDwellScales.get(progression.id) ?? 1;
  }
}

console.log(`\ntotal clicks across ${SCENES.length} renders: ${totalClicks}`);
if (totalClicks > 0) process.exitCode = 1;
