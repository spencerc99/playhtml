// ABOUTME: Renders busy scenes offline and scans the float buffers for sample-to-sample discontinuities.
// ABOUTME: Mechanical acceptance test for crackle, run before and after every gain-path change.

import { OfflineAudioContext } from "node-web-audio-api";
import { SoundEngine } from "../../extension/website/shared/sound/SoundEngine";
import { PROGRESSIONS } from "../../extension/website/shared/sound/scales";
import type {
  CantusVariant,
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
import {
  CLICK_RATIO_THRESHOLD,
  SINGLE_NOTE_PEAK,
  scanForClicks,
  type ScanReport,
} from "./clickDetector";

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
  /**
   * How long until the next tick, given the one just rendered. Absent, the
   * scene runs on the smooth 60fps clock a replay page produces.
   *
   * A live page does not tick on that clock. Its rAF is subject to whatever
   * else the main thread is doing, and the positions it hands the engine are
   * driven by events arriving in WebSocket batches rather than by a timeline
   * already in memory. Expressing the cadence per scene is what lets the same
   * driver render both.
   */
  nextStepMs?: (sampleMs: number) => number;
  /**
   * Arrangement overrides layered onto `ARRANGEMENT` for this scene.
   *
   * The default arrangement turns everything on, which sounds like the safest
   * thing to scan against and is not: several layers mask each other. The
   * spotlight ducks the crowd and the soloist's own notes sit on top of it, so
   * a fault in the sustained bed's gain path is buried under content that is
   * louder than it. Turning layers OFF is therefore its own coverage, not a
   * weaker version of the same scan.
   */
  config?: Partial<Record<string, unknown>>;
  /**
   * The cantus variant to run, if any. Not part of `SoundConfig` — it has its
   * own setter — so it is carried separately here for the same reason.
   */
  cantus?: CantusVariant | null;
}

/**
 * `timpaniHolds` routes held events to the timpani roll rather than to the
 * bell, which is the voicing Spencer's saved arrangement actually uses. It is
 * a separate path with its own envelope, and the bell path alone never reaches
 * it: the roll's attack and release cross on any hold under about 450ms, and
 * the fixture is full of those.
 */
const fixtureScene = (
  id: string,
  soloistVoice: SoloistVoice,
  durationSeconds: number,
  { timpaniHolds = false } = {},
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
          const isHold = event.event === "hold" || event.duration !== undefined;
          if (timpaniHolds && isHold) {
            engine.triggerHold(
              x,
              "rootFifth",
              event.duration === undefined ? undefined : event.duration / 1_000,
            );
          } else {
            engine.triggerClick({ x, y, holdDuration: event.duration });
          }
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
 *
 * `allText` makes every trail a text cursor, and `trailCount` shrinks the
 * scene. Both exist for one case the many-trail sweep cannot reach: the
 * percussive pluck retriggers a single gain node in place while the spotlight's
 * brightened filter sweeps across it, and that combination needs a text cursor
 * that is both moving fast and *staying* promoted. A ten-trail scene hands the
 * sweep on every 900ms, so no trail holds the spotlight long enough, and two
 * trails in three are ordinary cursors anyway — the fault hides completely.
 * One text trail sweeping alone is promoted at once and stays promoted, which
 * is what a page with a single busy reader actually looks like.
 */
const sweepScene = (
  id: string,
  soloistVoice: SoloistVoice,
  durationSeconds: number,
  { allText = false, trailCount = SWEEP_TRAIL_COUNT } = {},
): Scene => {
  let lastClickMs = 0;
  const phase = (index: number): number => index * 0.7;

  return {
    id,
    durationSeconds,
    soloistVoice,
    advance: (engine, sampleMs) => {
      const seconds = sampleMs / 1_000;
      const sweeper = Math.floor(sampleMs / SWEEP_HANDOVER_MS) % trailCount;

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
      for (let index = 0; index < trailCount; index++) {
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
          cursorType: allText || index % 3 === 0 ? "text" : "default",
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
 * The cadence the live portrait actually ticks the engine on.
 *
 * `LiveTrails` runs one rAF loop, so its nominal step is a frame — but a live
 * page is not a replay. Every ~1s a WebSocket batch lands, React re-derives
 * the trail states and the frame that follows does markedly more work, and the
 * browser periodically hands back a much longer frame than 16ms. The engine
 * divides by this interval in three separate places (velocity normalization,
 * the spotlight EMA, and every gain smoother), so the cadence is itself an
 * input, not scheduling noise.
 */
const liveStepMs = (random: () => number) => {
  let nextBatchMs = 0;
  let nextStallMs = 3_000;
  return (sampleMs: number): number => {
    if (sampleMs >= nextStallMs) {
      // The long frame: a stalled main thread, a hidden tab coming back, or a
      // GC pause. Deliberately spans MAX_TICK_INTERVAL_MS so the clamp is
      // exercised from both sides.
      nextStallMs = sampleMs + 2_400 + random() * 2_600;
      return 200 + random() * 300;
    }
    if (sampleMs >= nextBatchMs) {
      // The frame a batch lands on: React work plus a full re-derivation.
      nextBatchMs = sampleMs + 850 + random() * 400;
      return 45 + random() * 55;
    }
    return 8 + random() * 22;
  };
};

/** How often the live scene's stream hands each trail new geometry, in ms. */
const LIVE_BATCH_INTERVAL_MS = 1_000;

/**
 * The live portrait, as the engine experiences it.
 *
 * The difference from `sweepScene` is not the shape of the motion but where
 * the motion comes from. A replay interpolates a timeline it already holds, so
 * a trail's head advances smoothly and the tick that samples it is regular. A
 * live trail's head is a draw interpolation across points that keep arriving:
 * when a batch lands, `advanceDrawState` rebases the draw clock so the newly
 * extended path still reads as continuous, and the head steps to a new place
 * in one frame. Between batches it coasts, and after ~8s without a batch the
 * trail settles and stops feeding frames at all — then a later batch revives
 * it, which is a trail arriving on an index the engine has already voiced.
 *
 * `soloistChurn` makes the batches favour a different trail each time, so the
 * spotlight is re-decided on noisy velocities rather than on a clean sweep.
 */
const liveScene = (
  id: string,
  soloistVoice: SoloistVoice,
  durationSeconds: number,
  {
    trailCount = 6,
    allText = false,
    soloistChurn = false,
    reviveTrails = false,
  } = {},
): Scene => {
  const random = seededRandom(hash(`live-${id}`));

  interface LiveTrail {
    trailIndex: number;
    x: number;
    y: number;
    prevX: number;
    prevY: number;
    /** Where the draw head is heading, replaced whenever a batch lands. */
    targetX: number;
    targetY: number;
    /** Per-frame fraction of the remaining distance the head covers. */
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
      prevX: 0,
      prevY: 0,
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
        // A batch does not touch every trail: the stream carries whoever
        // happened to move, so most trails coast through most batches.
        for (const trail of trails) {
          const inBatch = random() < 0.55;
          if (!inBatch) continue;
          trail.lastBatchMs = sampleMs;
          trail.settled = false;
          trail.targetX = CANVAS_WIDTH * random();
          trail.targetY = CANVAS_HEIGHT * random();
          // The soloist candidate gets a long fast run; everyone else drifts.
          // Rotating which trail that is on every batch is what makes the
          // promotion decision land on noisy, freshly-rebased velocities.
          const isRunner = soloistChurn
            ? trail.trailIndex === batchIndex % trails.length
            : trail.trailIndex === 0;
          trail.approach = isRunner ? 0.22 + random() * 0.2 : 0.01 + random() * 0.03;
          // The rebase step: the head does not ease to the new geometry, it
          // moves to where the extended path says it now is.
          trail.x += (trail.targetX - trail.x) * (isRunner ? 0.35 : 0.08);
          trail.y += (trail.targetY - trail.y) * (isRunner ? 0.35 : 0.08);
        }

        // Clicks arrive with their batch, several at once, rather than spread
        // evenly the way a replay schedules them off a timeline.
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

      // A stray click between batches, so the flourish budget still sees
      // pressure that is not aligned to the batch boundary.
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
        // 8s without new points is `SETTLE_MS`: the trail stops tracing and
        // LiveTrails stops putting it in the frame list at all.
        if (sampleMs - trail.lastBatchMs > 8_000) {
          if (!trail.settled) {
            trail.settled = true;
            if (!reviveTrails) engine.retireTrail(trail.trailIndex);
          }
          if (!reviveTrails) continue;
          continue;
        }

        trail.prevX = trail.x;
        trail.prevY = trail.y;
        trail.x += (trail.targetX - trail.x) * trail.approach;
        trail.y += (trail.targetY - trail.y) * trail.approach;

        frames.push({
          trailIndex: trail.trailIndex,
          x: trail.x,
          y: trail.y,
          // The live producer sends the head twice, exactly as
          // `createLiveSoundFrame` does; the engine tracks its own previous
          // position and this field is not read for velocity.
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

/** Drive one scene through the engine and return the rendered buffer. */
const renderScene = async (scene: Scene): Promise<AudioBuffer> => {
  Math.random = seededRandom(hash(scene.id));
  const { audioContext, setClock } = createDrivenContext(scene.durationSeconds);
  const engine = new SoundEngine(audioContext as unknown as BaseAudioContext);
  await engine.init();
  engine.setCanvasWidth(CANVAS_WIDTH);
  engine.setVolume(VOLUME);
  engine.setConfig({
    ...ARRANGEMENT,
    soloistVoice: scene.soloistVoice,
    ...scene.config,
  });
  if (scene.cantus) engine.setCantus(scene.cantus);

  const stepMs = 1_000 / REPLAY_FPS;
  const endMs = scene.durationSeconds * 1_000;
  for (let sampleMs = 0; sampleMs <= endMs; ) {
    setClock(sampleMs / 1_000);
    const frames = scene.advance(engine, sampleMs);
    engine.tick(sampleMs, frames);
    sampleMs += scene.nextStepMs ? scene.nextStepMs(sampleMs) : stepMs;
  }

  return (await audioContext.startRendering()) as unknown as AudioBuffer;
};

/**
 * Prove the threshold discriminates before trusting any count it produces.
 *
 * A scanner whose threshold sits above anything the engine can produce would
 * report zero on a thoroughly broken engine, so neither end is assumed. Both
 * are re-proved across the whole frequency range the engine reaches, because a
 * detector that only discriminated in the middle of that range would be
 * trustworthy on the sustained bed and blind on the brightened soloist.
 */
const verifyThreshold = async (): Promise<void> => {
  /** The arrangement's own peak, for the clean reference. */
  const CLEAN_PEAK = 0.35;
  /**
   * The span the engine covers: the bass pedal's register at the bottom, the
   * spotlight's brightened filter ceiling at the top.
   */
  const CALIBRATION_FREQUENCIES = [200, 440, 1_400, 3_150, 6_000];
  /** The engine's fastest envelope: the percussive pluck's 5ms attack. */
  const FASTEST_ATTACK_SECONDS = 0.005;

  const buildTone = async (
    hz: number,
    hardCut: boolean,
  ): Promise<AudioBuffer> => {
    const ctx = new OfflineAudioContext(CHANNEL_COUNT, SAMPLE_RATE, SAMPLE_RATE);
    const osc = ctx.createOscillator();
    // A sine, because a sawtooth's own reset edge is a real discontinuity and
    // would be flagged correctly. The engine's sawtooth and square voices are
    // the band-limited built-ins, which contain no such edge.
    osc.type = "sine";
    osc.frequency.value = hz;
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
    osc.stop(hardCut ? 0.5 + 0.25 / hz : 1);
    return (await ctx.startRendering()) as unknown as AudioBuffer;
  };

  let worstClean = 0;
  let weakestCut = Number.POSITIVE_INFINITY;

  for (const hz of CALIBRATION_FREQUENCIES) {
    const clean = scanForClicks(await buildTone(hz, false), `clean-${hz}`);
    if (clean.hits.length !== 0) {
      throw new Error(
        `threshold calibration failed: a clean ${hz}Hz envelope at peak ${CLEAN_PEAK} flagged ${clean.hits.length} clicks (ratio ${clean.maxRatio.toFixed(4)})`,
      );
    }
    worstClean = Math.max(worstClean, clean.maxRatio);

    const cut = scanForClicks(await buildTone(hz, true), `cut-${hz}`);
    if (cut.hits.length === 0) {
      throw new Error(
        `threshold calibration failed: a hard cut of one note at ${hz}Hz was not caught (ratio ${cut.maxRatio.toFixed(4)})`,
      );
    }
    weakestCut = Math.min(weakestCut, cut.maxRatio);
  }

  console.log(
    `calibration ok across ${CALIBRATION_FREQUENCIES[0]}-${CALIBRATION_FREQUENCIES[CALIBRATION_FREQUENCIES.length - 1]}Hz: ` +
      `worst clean reads ${worstClean.toFixed(4)}, weakest one-note cut reads ${weakestCut.toFixed(4)}, ` +
      `threshold ${CLICK_RATIO_THRESHOLD}\n`,
  );
};

const SCAN_SECONDS = 40;

/**
 * The arrangement Spencer is actually listening to, which is not the one
 * every scene above scans.
 *
 * Two of its differences are the whole point of scanning it separately. With
 * the spotlight off there is no ducking and no soloist, so the sustained bed
 * carries the mix alone and every voice sits at its own full gain — the crowd
 * is the loudest thing present rather than the quietest. With cursor
 * instruments off, no trail takes the percussive pluck path, so every trail
 * holds one continuously-updated sustained voice for the length of the scene.
 *
 * That combination is what puts the throttled control path under the whole
 * mix instead of under a soloist, which is where a periodic fault at the
 * throttle's own rate becomes audible as ticking rather than as texture.
 */
const SPENCER_ARRANGEMENT = {
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
} as const;

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
    // Presence on real fixture data, not only on the synthetic sweep. The
    // sweep never retires a trail, so it cannot reach the one path where
    // presence and departure meet — a trail leaving while it still holds the
    // spotlight, taking its octave double with it. That combination clicked
    // while every scene here scanned clean.
    fixtureScene("busy-fixture-presence", "presence", SCAN_SECONDS),
    // The timpani hold voicing, which the bell path above never reaches.
    fixtureScene("busy-fixture-timpani", "presence", SCAN_SECONDS, {
      timpaniHolds: true,
    }),
    sweepScene("sweeps-bells", "bells", SCAN_SECONDS),
    sweepScene("sweeps-arpeggio", "arpeggio", SCAN_SECONDS),
    sweepScene("sweeps-presence", "presence", SCAN_SECONDS),
    sweepScene("sweeps-text-bells", "bells", SCAN_SECONDS, { allText: true }),
    sweepScene("lone-text-bells", "bells", SCAN_SECONDS, {
      allText: true,
      trailCount: 1,
    }),
    sweepScene("lone-text-arpeggio", "arpeggio", SCAN_SECONDS, {
      allText: true,
      trailCount: 1,
    }),
    // The live portrait's own cadence. Every scene above ticks on a smooth
    // 60fps clock, which is the one thing the live page never does — so none
    // of them reach the paths that divide by the tick interval under a tick
    // interval that actually varies.
    liveScene("live-bells", "bells", SCAN_SECONDS),
    liveScene("live-arpeggio", "arpeggio", SCAN_SECONDS),
    liveScene("live-presence", "presence", SCAN_SECONDS),
    // The spotlight re-decided on every batch, on velocities that were just
    // rebased — the case the hysteresis is supposed to absorb.
    liveScene("live-churn-bells", "bells", SCAN_SECONDS, {
      soloistChurn: true,
    }),
    liveScene("live-churn-presence", "presence", SCAN_SECONDS, {
      soloistChurn: true,
    }),
    // Percussive plucks retriggering under an irregular tick, where the pluck
    // interval and the tick interval no longer keep step.
    liveScene("live-text-bells", "bells", SCAN_SECONDS, {
      allText: true,
      soloistChurn: true,
    }),
    // A trail that settles and is then revived by a later batch, reusing a
    // trail index the engine still holds a voice for.
    liveScene("live-revive-presence", "presence", SCAN_SECONDS, {
      reviveTrails: true,
      soloistChurn: true,
    }),
    // Spencer's own arrangement, on both surfaces. The ticking he hears is
    // present with the spotlight and the cursor instruments off, so it has to
    // be scanned with them off: no scene above does that, and the layers they
    // add are loud enough to bury a fault in the sustained bed underneath.
    ...([
      ["sweeps", sweepScene],
      ["live", liveScene],
    ] as const).flatMap(([surface, makeScene]) => [
      {
        ...makeScene(`${surface}-spencer`, "presence", SCAN_SECONDS),
        config: SPENCER_ARRANGEMENT,
        cantus: "tenor" as CantusVariant,
      },
      // Denser, because the ticking gets worse as the scene fills. If the
      // fault is per-voice and periodic, more voices means more of it.
      {
        ...makeScene(`${surface}-spencer-dense`, "presence", SCAN_SECONDS, {
          trailCount: 12,
        }),
        config: SPENCER_ARRANGEMENT,
        cantus: "duet" as CantusVariant,
      },
    ]),
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
