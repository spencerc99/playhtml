// ABOUTME: Renders busy scenes offline and scans the float buffers for sample-to-sample discontinuities.
// ABOUTME: Mechanical acceptance test for crackle, run before and after every gain-path change.

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { OfflineAudioContext } from "node-web-audio-api";
import { SoundEngine, type SoloistVoice } from "../../extension/website/shared/sound/SoundEngine";
import { PROGRESSIONS } from "../../extension/website/shared/sound/scales";
import type {
  CantusVariant,
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
import {
  FLUTTER_DEPTH_THRESHOLD,
  scanForFlutter,
  type FlutterReport,
} from "./flutterDetector";

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
 * The context's own `currentTime` getter, taken off the prototype chain before
 * any instance shadows it.
 *
 * A driven context replaces `currentTime` with the clock the replay sets, which
 * is what lets a whole scene be scheduled ahead of a render that has not
 * started. The render head underneath is then unreachable through the property
 * - and a scene that suspends mid-render has to know where the render actually
 * stands, because an un-timed call lands there and nowhere else.
 */
const nativeCurrentTime = ((): ((context: OfflineAudioContext) => number) => {
  let proto: object | null = Object.getPrototypeOf(
    new OfflineAudioContext(1, 128, SAMPLE_RATE),
  );
  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, "currentTime");
    if (descriptor?.get) {
      const getter = descriptor.get;
      return (context) => getter.call(context) as number;
    }
    proto = Object.getPrototypeOf(proto);
  }
  throw new Error("no currentTime getter on the OfflineAudioContext prototype");
})();


/**
 * Make a tick driven ahead of the render behave as though the render had got
 * there.
 *
 * Most of what the engine does is timestamped, which is why a whole scene can
 * be scheduled before rendering starts and come out right. The rest is not:
 * `disconnect` carries no time, a node joins the graph the moment it is
 * connected, and `AudioParam.value` takes hold wherever the render currently
 * stands. On a live page none of that matters, because the engine's clock *is*
 * the render head and the two moments are the same one. In a scene suspended at
 * an action they are up to a whole scene apart: a voice retiring thirty seconds
 * in has its nodes cut at the action's head, and a formant bank attached there
 * arrives at full level on top of a voice already sounding.
 *
 * Every one of those is a step the engine never asked for, and the no-op
 * control scene is what reports them. So while a tick is driven ahead of the
 * head, each un-timed effect is redirected to the clock the tick is running on:
 *
 *  - a `disconnect` is queued and applied at the next suspension, by which time
 *    the head has passed the moment it meant. Late costs nothing — the engine
 *    only ever disconnects what it has already silenced — and early is the
 *    click.
 *  - a node's params are pinned to zero between the head and the moment the
 *    node was built, so a node that does not exist yet contributes nothing.
 *  - a `value` write is scheduled at the driven clock rather than landing at
 *    the head.
 *
 * The action's own calls are not redirected. An un-timed call at the moment of
 * the action is exactly what these scenes exist to hear, and there the head is
 * already the right place.
 */
const aheadOfHead = ((): {
  drive: <T>(headSeconds: number, run: () => T) => T;
  release: () => void;
} => {
  /** Queued disconnects, keyed by the node they were called on. */
  const queue = new Map<object, Array<() => void>>();
  let deferring = false;
  let headSeconds = 0;

  const probe = new OfflineAudioContext(1, 128, SAMPLE_RATE);

  const prototypesOf = (value: object): object[] => {
    const chain: object[] = [];
    let proto: object | null = Object.getPrototypeOf(value);
    while (proto && proto !== Object.prototype) {
      chain.push(proto);
      proto = Object.getPrototypeOf(proto);
    }
    return chain;
  };

  // `disconnect`, queued rather than applied.
  const nodePrototypes = new Set<object>();
  for (const node of [
    probe.createGain(),
    probe.createOscillator(),
    probe.createBiquadFilter(),
    probe.createStereoPanner(),
    probe.createBufferSource(),
    probe.createConvolver(),
    probe.createDelay(),
  ] as object[]) {
    for (const proto of prototypesOf(node)) nodePrototypes.add(proto);
  }
  for (const proto of nodePrototypes) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, "disconnect");
    if (!descriptor || typeof descriptor.value !== "function") continue;
    const original = descriptor.value as (...args: unknown[]) => unknown;
    Object.defineProperty(proto, "disconnect", {
      ...descriptor,
      value: function (this: object, ...args: unknown[]) {
        if (!deferring) return original.apply(this, args);
        const pending = queue.get(this) ?? [];
        pending.push(() => {
          try {
            original.apply(this, args);
          } catch {
            /* already disconnected, or its graph is gone */
          }
        });
        queue.set(this, pending);
        return undefined;
      },
    });
  }

  // `AudioParam.value`, scheduled at the driven clock rather than at the head.
  const paramProto = Object.getPrototypeOf(probe.createGain().gain) as object;
  const setValueAtTime = Object.getOwnPropertyDescriptor(
    paramProto,
    "setValueAtTime",
  )!.value as (this: AudioParam, value: number, time: number) => AudioParam;
  const valueDescriptor = Object.getOwnPropertyDescriptor(paramProto, "value")!;
  Object.defineProperty(paramProto, "value", {
    configurable: true,
    get: valueDescriptor.get,
    set(this: AudioParam, value: number) {
      if (deferring) {
        setValueAtTime.call(this, value, drivenSeconds());
        return;
      }
      valueDescriptor.set!.call(this, value);
    },
  });

  // A node built ahead of the head contributes nothing until the moment it was
  // built. Only the params that carry signal are pinned: a frequency or a pan
  // held at its default for a node that is silent anyway changes nothing, and
  // pinning them would fight the engine's own first value.
  const contextProto = prototypesOf(probe).find((proto) =>
    Object.getOwnPropertyDescriptor(proto, "createGain"),
  )!;
  let drivenSecondsRef: () => number = () => 0;
  const drivenSeconds = (): number => drivenSecondsRef();
  const createGain = Object.getOwnPropertyDescriptor(
    contextProto,
    "createGain",
  )!.value as (this: BaseAudioContext) => GainNode;
  Object.defineProperty(contextProto, "createGain", {
    configurable: true,
    writable: true,
    value: function (this: BaseAudioContext) {
      const gain = createGain.call(this);
      if (deferring) {
        const builtAt = drivenSeconds();
        if (builtAt > headSeconds) {
          setValueAtTime.call(gain.gain, 0, headSeconds);
          setValueAtTime.call(gain.gain, 1, builtAt);
        }
      }
      return gain;
    },
  });

  // A node that is reconnected after a deferred disconnect has to be
  // disconnected first, or the old edge and the new one both stand and the node
  // is summed into its destination twice. The vibrato does exactly this — it is
  // parked by disconnecting its depth and resumed by connecting it again — and
  // a doubled modulation depth is a jump in pitch, which is a click.
  for (const proto of nodePrototypes) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, "connect");
    if (!descriptor || typeof descriptor.value !== "function") continue;
    const original = descriptor.value as (...args: unknown[]) => unknown;
    Object.defineProperty(proto, "connect", {
      ...descriptor,
      value: function (this: object, ...args: unknown[]) {
        if (deferring) {
          for (const apply of queue.get(this) ?? []) apply();
          queue.delete(this);
        }
        return original.apply(this, args);
      },
    });
  }

  return {
    drive: (head, run) => {
      const wasDeferring = deferring;
      const previousHead = headSeconds;
      deferring = true;
      headSeconds = head;
      try {
        return run();
      } finally {
        deferring = wasDeferring;
        headSeconds = previousHead;
      }
    },
    release: () => {
      for (const pending of [...queue.values()]) {
        for (const apply of pending) apply();
      }
      queue.clear();
    },
    /** Told where the drive's own clock stands, which only the driver knows. */
    setDrivenSeconds: (read: () => number) => {
      drivenSecondsRef = read;
    },
  } as {
    drive: <T>(headSeconds: number, run: () => T) => T;
    release: () => void;
    setDrivenSeconds: (read: () => number) => void;
  };
})();

/**
 * An offline context whose clock the caller drives, so a synchronous replay
 * renders as the timeline it represents rather than stacking onto instant
 * zero. Same construction the sample renderer uses.
 */
interface DrivenContext {
  audioContext: OfflineAudioContext;
  setClock: (seconds: number) => void;
  /** Where the render itself stands, which the driven clock hides. */
  renderHeadSeconds: () => number;
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
    renderHeadSeconds: () => nativeCurrentTime(audioContext),
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
  /**
   * Engine calls fired mid-scene, each once, when the scene clock passes its
   * time. This is how a scan reaches the transitions a page makes while sound
   * is playing — a settings toggle, a data reload calling `reset()` — which no
   * amount of trail motion produces. Those transitions run against whatever
   * voices happen to be sounding, which is exactly why they click when a
   * teardown path cuts instead of fading.
   */
  actions?: Array<{ atMs: number; run: (engine: SoundEngine) => void }>;
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
/**
 * A handover slow enough for a whole promotion to happen between one and the
 * next: the audition, the entrance, the reign's own minimum, the release and
 * the cooldown, with room left over.
 *
 * The default handover is deliberately faster than any of that — it churns the
 * decision so the paths around it stay under pressure — but a churn that fast
 * means no promotion ever completes, so the entrance and the release are never
 * rendered at all. A scene on this cadence is the only one in the matrix that
 * hears them.
 */
const SWEEP_PROMOTION_HANDOVER_MS = 10_000;
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
  {
    allText = false,
    trailCount = SWEEP_TRAIL_COUNT,
    handoverMs = SWEEP_HANDOVER_MS,
  } = {},
): Scene => {
  let lastClickMs = 0;
  const phase = (index: number): number => index * 0.7;

  return {
    id,
    durationSeconds,
    soloistVoice,
    advance: (engine, sampleMs) => {
      const seconds = sampleMs / 1_000;
      const sweeper = Math.floor(sampleMs / handoverMs) % trailCount;

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
export const liveScene = (
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

/** How often a typing hand nudges the caret, in ms — roughly 90wpm. */
const TYPING_KEYSTROKE_MS = 130;
/** Pixels the caret advances per character in a normal text column. */
const TYPING_CHARACTER_WIDTH = 8;
/** Pixels the caret drops when a line wraps. */
const TYPING_LINE_HEIGHT = 22;
/** How often the typist stops to think, in ms. */
const TYPING_PAUSE_INTERVAL_MS = 2_600;
/** How long a thinking pause lasts, in ms. */
const TYPING_PAUSE_MS = 700;

/**
 * Someone typing, which is the one thing no other scene here reproduces.
 *
 * Every scene above moves its trails: the sweeper races, the drifters drift,
 * and even a "still" trail is still crossing the canvas slowly. A typist's
 * pointer does neither. It sits where it was left and is nudged a character's
 * width at a time as the caret advances, with the hand's own tremor under
 * that — which is motion that spends most of its ticks *below*
 * `SILENCE_VELOCITY_THRESHOLD` and crosses it only on the keystroke frames.
 *
 * That is the shape the crackle lives in. Below the threshold the voice's
 * breath is faded closed; above it, reopened. A pointer jittering across the
 * threshold therefore drives `fadeVoice` and `openVoiceFade` in alternation at
 * something close to the keystroke rate, and the text cursor's plucks are
 * multiplied by that flapping breath on their way out. Neither ramp is
 * illegal, so nothing here is a discontinuity — which is exactly why this
 * scene is scanned for flutter as well as for clicks.
 *
 * `withPointer` adds an ordinary cursor moving normally alongside the typist,
 * because a real page rarely has only one person on it and the crowd's own
 * level is what the flutter has to be audible over.
 */
const typingScene = (
  id: string,
  soloistVoice: SoloistVoice,
  durationSeconds: number,
  { withPointer = false } = {},
): Scene => {
  const random = seededRandom(hash(`typing-${id}`));
  // Where the caret sits: a text column starting near the left margin.
  let caretX = CANVAS_WIDTH * 0.2;
  let caretY = CANVAS_HEIGHT * 0.4;
  let prevCaretX = caretX;
  let prevCaretY = caretY;
  let lastKeystrokeMs = 0;
  let lastClickMs = 0;
  let firstSeen = true;
  let pointerFirstSeen = true;

  return {
    id,
    durationSeconds,
    soloistVoice,
    // The typist's own cadence, not the replay clock: a page being typed on is
    // a live page, and the engine divides by this interval in three places.
    nextStepMs: liveStepMs(random),
    advance: (engine, sampleMs) => {
      const inPause =
        sampleMs % TYPING_PAUSE_INTERVAL_MS < TYPING_PAUSE_MS;

      prevCaretX = caretX;
      prevCaretY = caretY;

      if (!inPause && sampleMs - lastKeystrokeMs >= TYPING_KEYSTROKE_MS) {
        lastKeystrokeMs = sampleMs;
        caretX += TYPING_CHARACTER_WIDTH;
        // The line wraps: the caret returns to the margin and drops a line.
        // Stepped rather than teleported, because a jump of most of the canvas
        // in one tick is a velocity no pointer produces and would swamp the
        // scene average the promotion test reads.
        if (caretX > CANVAS_WIDTH * 0.5) {
          caretX = CANVAS_WIDTH * 0.2;
          caretY += TYPING_LINE_HEIGHT;
          if (caretY > CANVAS_HEIGHT * 0.7) caretY = CANVAS_HEIGHT * 0.3;
        }
      } else {
        // Between keystrokes the pointer is not perfectly still: a resting
        // hand and a sub-pixel compositor offset both move it a little. This
        // is the sub-threshold jitter the fade decision has to absorb.
        caretX += (random() - 0.5) * 0.09;
        caretY = caretY + (random() - 0.5) * 0.09;
      }

      // A typist clicks occasionally — into a field, onto a link.
      if (sampleMs - lastClickMs > 4_000 && random() < 0.08) {
        lastClickMs = sampleMs;
        engine.triggerClick({ x: caretX, y: caretY, holdDuration: undefined });
      }

      const frames: TrailSoundFrame[] = [
        {
          trailIndex: 0,
          x: caretX,
          y: caretY,
          prevX: prevCaretX,
          prevY: prevCaretY,
          cursorType: "text",
          progress: 0,
          color: REPLAY_COLORS[0],
          isNewlyActive: firstSeen,
          identityKey: "typing-caret",
        },
      ];
      firstSeen = false;

      if (withPointer) {
        const seconds = sampleMs / 1_000;
        const x = CANVAS_WIDTH * (0.5 + 0.35 * Math.sin(seconds * 0.9));
        const y = CANVAS_HEIGHT * (0.5 + 0.3 * Math.cos(seconds * 0.7));
        frames.push({
          trailIndex: 1,
          x,
          y,
          prevX: x,
          prevY: y,
          cursorType: "default",
          progress: 0,
          color: REPLAY_COLORS[1],
          isNewlyActive: pointerFirstSeen,
          identityKey: "typing-pointer",
        });
        pointerFirstSeen = false;
      }

      return frames;
    },
  };
};

/** Drive one scene through the engine and return the rendered buffer. */
export const renderScene = async (
  scene: Scene,
  configure?: (engine: SoundEngine) => void,
): Promise<AudioBuffer> => {
  Math.random = seededRandom(hash(scene.id));
  const { audioContext, setClock, renderHeadSeconds } = createDrivenContext(
    scene.durationSeconds,
  );
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
  configure?.(engine);

  const stepMs = 1_000 / REPLAY_FPS;
  const endMs = scene.durationSeconds * 1_000;
  let sampleMs = 0;
  /**
   * Where the render stands. Zero until the first suspension, which covers the
   * whole of a scene without actions: it is driven before rendering begins, so
   * everything it schedules lies ahead of a render that has not started.
   */
  let headSeconds = 0;
  const driveTo = (untilMs: number): void => {
    while (sampleMs <= endMs && sampleMs < untilMs) {
      // Never behind the render head. A tick whose nominal time has already
      // been rendered would anchor its ramps in the past, where they read a
      // start value the output has moved on from, and that is a step. Ahead of
      // the head is the ordinary case and the only one a plain scene has.
      setClock(Math.max(sampleMs / 1_000, headSeconds));
      const frames = scene.advance(engine, sampleMs);
      engine.tick(sampleMs, frames);
      sampleMs += scene.nextStepMs ? scene.nextStepMs(sampleMs) : stepMs;
    }
  };

  const actions = [...(scene.actions ?? [])].sort((a, b) => a.atMs - b.atMs);
  if (actions.length === 0) {
    driveTo(Number.POSITIVE_INFINITY);
    return (await audioContext.startRendering()) as unknown as AudioBuffer;
  }

  // A scene with mid-scene actions cannot be driven entirely before rendering
  // the way the plain scenes are: automation is timestamped, but a `disconnect`
  // or an un-timed `stop()` takes effect where the render currently stands, so
  // a teardown "mid-scene" would actually land at time zero and its click could
  // never appear. The render is suspended at each action instead, and the
  // stretch of scene after it is driven from inside that suspension, ahead of
  // the head, the same way a plain scene drives all of it.
  //
  // `sweeps-noop-actions` is the control for this path - the same scene, the
  // same suspensions, actions that do nothing. It must scan 0, and anything the
  // harness does to the timeline rather than to the engine lands there first.
  // What that control certifies is the stretch between one action and the next:
  // an un-timed call a tick in that stretch makes lands on the head its
  // suspension stopped at rather than at the tick's own time, so an action
  // scene keeps its actions no further apart than the control's are.
  const QUANTUM_SECONDS = 128 / SAMPLE_RATE;
  /**
   * The render head a suspension asked for at `atMs` is granted at. Suspension
   * lands on a render quantum boundary, rounding up, so this is the first
   * quantum not yet rendered when the action comes due.
   *
   * Rounding down is what the harness did first, and it left the engine's clock
   * a quantum behind the render: every ramp anchored there began from a value
   * the output had already passed, which is a step, and the no-op control is
   * what reported it.
   */
  const quantumFor = (atMs: number): number =>
    Math.ceil(atMs / 1_000 / QUANTUM_SECONDS);

  interface Stop {
    quantum: number;
    atMs: number;
    runs: Array<(engine: SoundEngine) => void>;
  }
  // Actions sharing a quantum share its suspension: a suspension time has to be
  // unique, and two calls one render quantum apart are simultaneous as far as
  // the graph is concerned anyway.
  const stops: Stop[] = [];
  const byQuantum = new Map<number, Stop>();
  for (const action of actions) {
    const quantum = quantumFor(action.atMs);
    const existing = byQuantum.get(quantum);
    if (existing) {
      existing.runs.push(action.run);
      continue;
    }
    const stop: Stop = { quantum, atMs: action.atMs, runs: [action.run] };
    byQuantum.set(quantum, stop);
    stops.push(stop);
  }

  // A suspension has to land strictly inside the render. Quantum zero is before
  // it has begun and anything past the buffer is after it has ended; either way
  // there is no head to run against but the one the drive already stands at.
  const suspended: Stop[] = [];
  for (const stop of stops) {
    if (
      stop.quantum > 0 &&
      stop.quantum * QUANTUM_SECONDS < scene.durationSeconds
    ) {
      suspended.push(stop);
      continue;
    }
    driveTo(stop.atMs);
    setClock(Math.max(stop.atMs / 1_000, headSeconds));
    for (const run of stop.runs) run(engine);
  }

  aheadOfHead.setDrivenSeconds(() => sampleMs / 1_000);
  aheadOfHead.drive(headSeconds, () =>
    driveTo(suspended.length ? suspended[0].atMs : Number.POSITIVE_INFINITY),
  );

  const suspendable = audioContext as unknown as {
    suspend: (seconds: number) => Promise<void>;
    resume: () => Promise<void>;
  };
  suspended.forEach((stop, index) => {
    void suspendable.suspend(stop.quantum * QUANTUM_SECONDS).then(() => {
      // The clock is the render head itself, read from the context rather than
      // computed from the suspension request. An action is an un-timed call
      // that takes effect exactly where the render stands, and telling the
      // engine anything else anchors its ramps at a value the output has not
      // reached yet.
      headSeconds = renderHeadSeconds();
      setClock(headSeconds);
      // The head has now passed every deferred disconnect's own moment, so
      // they are safe to apply, and applying them keeps the graph from growing
      // for the length of the scene.
      aheadOfHead.release();
      // The action itself is not deferred: an un-timed call is exactly what it
      // is being tested for, and here it lands where the render stands, which
      // is where the action is.
      for (const run of stop.runs) run(engine);
      const next = suspended[index + 1];
      aheadOfHead.drive(headSeconds, () =>
        driveTo(next ? next.atMs : Number.POSITIVE_INFINITY),
      );
      void suspendable.resume();
    });
  });

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

/**
 * Prove the flutter threshold discriminates, the same way the click threshold
 * is proved, and for the same reason: a detector that fired on everything or
 * on nothing would be worse than none, because its zero would be believed.
 *
 * The clean end is a tone with the slow movement the engine actually applies
 * — a swell over seconds and a vibrato at the top of the musical range — which
 * must read as nothing. The faulty end is that same tone with its level
 * alternating between full and near-silent on a tick-rate cycle, each move a
 * legal linear ramp, which is precisely the shape a breath flapping across the
 * silence threshold produces and precisely what a click scan cannot see.
 */
const verifyFlutterThreshold = async (): Promise<void> => {
  const TONE_HZ = 440;
  const TONE_PEAK = 0.35;
  /** The rate a flapping fade modulates at: one flap per ~33ms tick pair. */
  const FLUTTER_RATE_HZ = 30;
  /** How near silence each flap closes the level to. */
  const FLUTTER_FLOOR = 0.05;
  /** A musical tremolo, well under the corner, which must read as clean. */
  const VIBRATO_RATE_HZ = 6;

  const buildTone = async (flapping: boolean): Promise<AudioBuffer> => {
    const ctx = new OfflineAudioContext(CHANNEL_COUNT, SAMPLE_RATE, SAMPLE_RATE);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = TONE_HZ;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, 0);
    // The slow movement every clean render carries: a swell in, then out.
    gain.gain.linearRampToValueAtTime(TONE_PEAK, 0.3);

    // A musical tremolo under the corner, present in both cases so the clean
    // reference is not a flat line the detector was never going to flag.
    const tremolo = ctx.createOscillator();
    tremolo.type = "sine";
    tremolo.frequency.value = VIBRATO_RATE_HZ;
    const tremoloDepth = ctx.createGain();
    tremoloDepth.gain.value = TONE_PEAK * 0.15;
    tremolo.connect(tremoloDepth);
    tremoloDepth.connect(gain.gain);
    tremolo.start(0);

    const flap = ctx.createGain();
    flap.gain.setValueAtTime(1, 0);
    if (flapping) {
      // The fault: the level driven to near-silence and back once per period,
      // each leg a linear ramp the engine itself would consider well-formed.
      // Every ramp ends strictly after the one before it — a schedule whose
      // endpoints overlap is a different fault, and not the one being proved.
      const period = 1 / FLUTTER_RATE_HZ;
      for (let time = 0.3; time < 0.95; time += period) {
        flap.gain.linearRampToValueAtTime(FLUTTER_FLOOR, time + period / 2);
        flap.gain.linearRampToValueAtTime(1, time + period);
      }
    }

    gain.gain.linearRampToValueAtTime(0, 0.99);
    osc.connect(gain);
    gain.connect(flap);
    flap.connect(ctx.destination);
    osc.start(0);
    osc.stop(1);
    tremolo.stop(1);
    return (await ctx.startRendering()) as unknown as AudioBuffer;
  };

  const clean = scanForFlutter(await buildTone(false), "flutter-clean");
  if (clean.hits.length !== 0) {
    throw new Error(
      `flutter calibration failed: a swelling tone with a ${VIBRATO_RATE_HZ}Hz tremolo flagged ` +
        `${clean.hits.length} windows (depth ${clean.maxDepth.toFixed(4)})`,
    );
  }

  const flapping = scanForFlutter(await buildTone(true), "flutter-flapping");
  if (flapping.hits.length === 0) {
    throw new Error(
      `flutter calibration failed: a ${FLUTTER_RATE_HZ}Hz flapping gain was not caught ` +
        `(depth ${flapping.maxDepth.toFixed(4)})`,
    );
  }

  console.log(
    `flutter calibration ok: clean reads ${clean.maxDepth.toFixed(4)}, ` +
      `a ${FLUTTER_RATE_HZ}Hz flap reads ${flapping.maxDepth.toFixed(4)}, ` +
      `threshold ${FLUTTER_DEPTH_THRESHOLD}\n`,
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
export const SPENCER_ARRANGEMENT = {
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

const report = (scan: ScanReport, flutter: FlutterReport): void => {
  const worst = scan.hits
    .slice(0, 5)
    .map(
      (hit) =>
        `${hit.seconds.toFixed(3)}s ch${hit.channel} ratio ${hit.ratio.toFixed(2)} amp ${hit.amplitude.toFixed(3)}`,
    )
    .join(", ");
  const worstFlutter = flutter.hits
    .slice(0, 5)
    .map(
      (hit) =>
        `${hit.seconds.toFixed(3)}s ch${hit.channel} depth ${hit.depth.toFixed(2)} level ${hit.level.toFixed(3)}`,
    )
    .join(", ");
  console.log(
    `${scan.label.padEnd(28)} clicks ${String(scan.hits.length).padStart(5)}  ` +
      `max ratio ${scan.maxRatio.toFixed(4)}  peak ${scan.peak.toFixed(4)}  ` +
      `flutter ${String(flutter.hits.length).padStart(4)} max depth ${flutter.maxDepth.toFixed(3)}` +
      (worst ? `\n${" ".repeat(30)}worst: ${worst}` : "") +
      (worstFlutter ? `\n${" ".repeat(30)}flutter: ${worstFlutter}` : ""),
  );
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
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
  let totalFlutter = 0;
  let scannedCount = 0;
  try {
    await verifyThreshold();
    await verifyFlutterThreshold();

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
      // Whole promotions, start to finish, several times over. Every other sweep
      // here hands the fast trail on faster than a promotion takes, so the
      // entrance and the release — the two moments where a voice's gain,
      // brightness, drying and vibrato all move at once — are never rendered.
      // This scene is where they are, on the default tuning, which is the tuning
      // anybody actually hears.
      sweepScene("sweeps-promotion-churn", "presence", SCAN_SECONDS, {
        handoverMs: SWEEP_PROMOTION_HANDOVER_MS,
      }),
      // The same, in Spencer's arrangement: with the spotlight ducking off and
      // the choral banks up, a promotion moves a voice that is carrying much more
      // of the mix, and it moves it against a bed rather than under a flourish.
      {
        ...sweepScene("sweeps-promotion-churn-spencer", "presence", SCAN_SECONDS, {
          handoverMs: SWEEP_PROMOTION_HANDOVER_MS,
        }),
        config: { ...SPENCER_ARRANGEMENT, spotlight: true },
        cantus: "tenor" as CantusVariant,
      },
      // Someone typing. The one motion no scene above produces: a pointer that
      // spends most of its ticks under the silence threshold and crosses it on
      // the keystrokes, which is what flaps the voice's breath open and closed
      // under the plucks. Scanned in both soloist voices and with the full
      // default arrangement, plus a variant with an ordinary cursor alongside.
      typingScene("typing-bells", "bells", SCAN_SECONDS),
      typingScene("typing-presence", "presence", SCAN_SECONDS),
      typingScene("typing-crowd-presence", "presence", SCAN_SECONDS, {
        withPointer: true,
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

    // The action scenes and their controls all run on one shape: a stretch long
    // enough for the bed to fill, an action every `ACTION_SPACING_MS` after that,
    // and the same again as a tail. The spacing is what the control certifies -
    // it is the stretch of scene driven inside one suspension - so the scenes
    // here keep to it rather than each choosing its own.
    const ACTION_SPACING_MS = 8_000;
    const actionTimes = (count: number): number[] =>
      Array.from(
        { length: count },
        (_, index) => ACTION_SPACING_MS * (index + 1),
      );
    const actionSceneSeconds = (count: number): number =>
      (ACTION_SPACING_MS * (count + 1)) / 1_000;

    const TOGGLE_TIMES = actionTimes(3);
    const TOGGLE_SECONDS = actionSceneSeconds(3);
    const RESET_TIMES = actionTimes(2);
    const RESET_SECONDS = actionSceneSeconds(2);

    SCENES.push(
      // The choral timbre toggled off while the bed is sounding, then back on,
      // then off again. Spencer's arrangement, because that is the one with the
      // formant banks actually audible: no spotlight duck, no percussive layer
      // over them, and every voice carrying its vowel at full level when the
      // toggle lands.
      {
        ...sweepScene("sweeps-choral-toggle", "presence", TOGGLE_SECONDS),
        config: SPENCER_ARRANGEMENT,
        cantus: "tenor" as CantusVariant,
        actions: [
          {
            atMs: TOGGLE_TIMES[0],
            run: (engine) => engine.setConfig({ choralTimbre: false }),
          },
          {
            atMs: TOGGLE_TIMES[1],
            run: (engine) => engine.setConfig({ choralTimbre: true }),
          },
          {
            atMs: TOGGLE_TIMES[2],
            run: (engine) => engine.setConfig({ choralTimbre: false }),
          },
        ],
      },
      // The control. The same scene, the same suspensions, actions that do
      // nothing, so anything it reports is the harness rather than the engine.
      {
        ...sweepScene("sweeps-noop-actions", "presence", TOGGLE_SECONDS),
        config: SPENCER_ARRANGEMENT,
        cantus: "tenor" as CantusVariant,
        actions: TOGGLE_TIMES.map((atMs) => ({ atMs, run: () => {} })),
      },
      // `reset()` fired while sustained voices - including a promoted presence
      // soloist with its halo up - are sounding, which is what a day swap on the
      // archive page does. The second reset lands while the scene rebuilt from
      // the first is back at full level.
      {
        ...sweepScene("sweeps-reset-presence", "presence", RESET_SECONDS),
        actions: RESET_TIMES.map((atMs) => ({
          atMs,
          run: (engine: SoundEngine) => engine.reset(),
        })),
      },
      // The control again on the reset scene's own arrangement and shape: the
      // default arrangement reaches voices Spencer's does not, and a control that
      // only ever ran one of them would certify only that one.
      {
        ...sweepScene("sweeps-noop-reset-shape", "presence", RESET_SECONDS),
        actions: RESET_TIMES.map((atMs) => ({ atMs, run: () => {} })),
      },
    );

    // Scene-id substrings on the command line narrow the run to the scenes that
    // match, so a single arrangement can be re-scanned in seconds while a gain
    // path is being changed. With no arguments the whole matrix runs, which is
    // the only form the acceptance test is read from.
    const selectors = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
    const selected = selectors.length
      ? SCENES.filter((scene) =>
          selectors.some((selector) => scene.id.includes(selector)),
        )
      : SCENES;
    if (!selected.length) {
      throw new Error(
        `no scene matched ${selectors.join(", ")}; known scenes: ${SCENES.map((scene) => scene.id).join(", ")}`,
      );
    }
    scannedCount = selected.length;

    for (const scene of selected) {
      const buffer = await renderScene(scene);
      const scan = scanForClicks(buffer, scene.id);
      const flutter = scanForFlutter(buffer, scene.id);
      report(scan, flutter);
      totalClicks += scan.hits.length;
      totalFlutter += flutter.hits.length;
    }
  } finally {
    for (const progression of Object.values(PROGRESSIONS)) {
      progression.dwellScale = originalDwellScales.get(progression.id) ?? 1;
    }
  }

  console.log(
    `\ntotal clicks across ${scannedCount} renders: ${totalClicks}` +
      `\ntotal flutter windows across ${scannedCount} renders: ${totalFlutter}` +
      ` (reported, not gated — see FLUTTER_DEPTH_THRESHOLD)`,
  );
  // Only the click count fails the run. The flutter measure is reported for
  // comparison across changes; its populations overlap, so a count from it is
  // not something a build should be failed on.
  if (totalClicks > 0) process.exitCode = 1;
}
