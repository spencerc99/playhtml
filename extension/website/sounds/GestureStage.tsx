// ABOUTME: A small staged scene where one gesture is heard and seen at the same moment
// ABOUTME: Drives the engine's real arrival, departure and navigation paths, drawn by SoundVisuals

import React, { useCallback, useEffect, useRef, useState } from "react";
import { SoundEngine } from "../shared/sound/SoundEngine";
import {
  Gathering,
  GATHERING_TUNING,
  Knot,
  KNOT_TUNING,
  SoundVisuals,
  SURGE_TUNING,
  VisualConfig,
  flourishedColor,
} from "../shared/sound/soundVisuals";
import { TrailSoundFrame } from "../shared/sound/types";

const STAGE_WIDTH = 360;
const STAGE_HEIGHT = 200;

/**
 * Far above anything the replay hands the engine, so a stage gesture never
 * lands on a trail the replay is also sounding. The two share one engine.
 */
const STAGE_TRAIL_INDEX = 900001;

/** The trail's own colour on the stage — a warm mid hue, so it reads on linen. */
const STAGE_COLOR = "hsl(18, 55%, 52%)";

/**
 * How much travel the drawn ribbon keeps behind the cursor, in ms of stage
 * clock. Held by time rather than by a count of points so the ribbon is the
 * same length whatever frame rate the tab is running at — a backgrounded or
 * throttled tab delivers far fewer frames, and a fixed point count would
 * shrink the trail to a stub exactly when the motion is hardest to read.
 */
const TRAIL_SPAN_MS = 1500;

/**
 * How often the fallback pump steps the stage when the tab is hidden. Browsers
 * throttle `requestAnimationFrame` to a stop in a background tab, which would
 * park a gesture on its first frame with every beat still pending — the sound
 * would never arrive. `setTimeout` keeps running (clamped to about a second in
 * a hidden tab), so the stage steps coarsely but completes: the beats fire, the
 * engine sounds, and the run ends and releases the shared engine as it should.
 */
export const PUMP_INTERVAL_MS = 1000 / 30;

/**
 * How long each scripted gesture runs before the stage lets go of the engine.
 * Long enough for the gong's own settle (`SURGE_TUNING` swell plus settle) and
 * for a departure chime's last speck to finish its travel.
 */
const GESTURE_SECONDS: Record<GestureId, number> = {
  arrival: 3.2,
  departure: 3.2,
  navigationKnot: 4,
  navigationSurge: 4,
  navigationTilt: 4,
  together: 11,
};

export type GestureId =
  | "arrival"
  | "departure"
  | "navigationKnot"
  | "navigationSurge"
  | "navigationTilt"
  | "together";

/**
 * Which visual gestures a stage button leaves switched on. The stage overrides
 * whatever the playground's own visual toggles say, because the point of a
 * button here is to show one gesture by itself — a navigation with the surge,
 * the tilt and the knot all firing at once teaches nothing about any of them.
 */
const GESTURE_VISUALS: Record<GestureId, VisualConfig> = {
  arrival: { gathering: true, knot: false, lightnessSurge: false, hueTilt: false },
  departure: {
    gathering: true,
    knot: false,
    lightnessSurge: false,
    hueTilt: false,
  },
  navigationKnot: {
    gathering: false,
    knot: true,
    lightnessSurge: false,
    hueTilt: false,
  },
  navigationSurge: {
    gathering: false,
    knot: false,
    lightnessSurge: true,
    hueTilt: false,
  },
  navigationTilt: {
    gathering: false,
    knot: false,
    lightnessSurge: false,
    hueTilt: true,
  },
  together: { gathering: true, knot: true, lightnessSurge: true, hueTilt: false },
};

const STAGE_CARDS: Array<{
  id: GestureId;
  label: string;
  description: string;
}> = [
  {
    id: "arrival",
    label: "arrival + gathering",
    description:
      "A cursor appears and its specks converge onto it, one per note of the arrival chime.",
  },
  {
    id: "departure",
    label: "departure + gathering",
    description:
      "The same specks running outward as the trail leaves, paced by the falling chime.",
  },
  {
    id: "navigationKnot",
    label: "navigation + knot",
    description:
      "The cursor wanders, the gong sounds, and a bead forms where it was with a ring opening out of it.",
  },
  {
    id: "navigationSurge",
    label: "navigation + lightness surge",
    description:
      "The same pass, with the recent stretch of path brightening on the gong's envelope and settling back.",
  },
  {
    id: "navigationTilt",
    label: "navigation + hue tilt",
    description:
      "The same pass again, with the whole ribbon's hue leaning aside at the gong and returning.",
  },
  {
    id: "together",
    label: "all together",
    description:
      "Arrival, a wander, a navigation carrying its knot and surge, then a departure.",
  },
];

/** One scripted moment on the stage timeline, in seconds from the button press. */
interface Beat {
  atSeconds: number;
  kind: "arrive" | "navigate" | "depart";
}

/**
 * What each button plays, and when.
 *
 * Every gesture starts by putting the trail on stage, because the engine's own
 * paths need one: a departure only sounds for a trail that announced itself,
 * and a gong is only worth drawing where a trail actually is. That opening
 * arrival always chimes — the stage does not reach into the page's shared
 * arrangement to mute it — so a navigation beat sits far enough after it that
 * the chime has finished and the gong is heard on its own. The navigation
 * buttons draw no gathering, so only the gong leaves a mark.
 */
const GESTURE_BEATS: Record<GestureId, Beat[]> = {
  arrival: [{ atSeconds: 0.3, kind: "arrive" }],
  // The trail has to have arrived before it can leave: `retireTrail` only
  // sounds a departure for a trail the engine counted arriving.
  departure: [
    { atSeconds: 0, kind: "arrive" },
    { atSeconds: 0.6, kind: "depart" },
  ],
  navigationKnot: [
    { atSeconds: 0, kind: "arrive" },
    { atSeconds: 1.4, kind: "navigate" },
  ],
  navigationSurge: [
    { atSeconds: 0, kind: "arrive" },
    { atSeconds: 1.4, kind: "navigate" },
  ],
  navigationTilt: [
    { atSeconds: 0, kind: "arrive" },
    { atSeconds: 1.4, kind: "navigate" },
  ],
  together: [
    { atSeconds: 0.3, kind: "arrive" },
    { atSeconds: 3.4, kind: "navigate" },
    { atSeconds: 6.4, kind: "navigate" },
    { atSeconds: 8.8, kind: "depart" },
  ],
};

/**
 * The scripted wander: a cubic bezier across the stage, gentle enough that the
 * cursor reads as drifting rather than being flung. The stage advances along it
 * at a fixed rate, so the path is the same every press and a gesture always
 * fires at the same place on it.
 */
const WANDER = {
  from: { x: 44, y: 138 },
  controlA: { x: 118, y: 40 },
  controlB: { x: 232, y: 176 },
  to: { x: 314, y: 62 },
};

/**
 * How much of the wander one second covers, so the whole path takes about
 * three seconds. Slower than this and the cursor reads as parked: a gesture
 * only lasts a few seconds, and a trail that has not visibly travelled leaves
 * the gong nothing to mark and the surge no recent stretch to brighten.
 */
const WANDER_RATE_PER_SECOND = 0.33;

/**
 * Where the cursor is after travelling `t` lengths of the path. The parameter
 * is not clamped but folded: the cursor runs the bezier out, then back along
 * it, so a gesture longer than one pass keeps drifting instead of parking at
 * the end with a frozen ribbon behind it.
 */
function wanderAt(t: number): { x: number; y: number } {
  const cycle = Math.max(0, t) % 2;
  const clamped = cycle > 1 ? 2 - cycle : cycle;
  const inverse = 1 - clamped;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * clamped;
  const c = 3 * inverse * clamped * clamped;
  const d = clamped * clamped * clamped;
  return {
    x:
      a * WANDER.from.x +
      b * WANDER.controlA.x +
      c * WANDER.controlB.x +
      d * WANDER.to.x,
    y:
      a * WANDER.from.y +
      b * WANDER.controlA.y +
      c * WANDER.controlB.y +
      d * WANDER.to.y,
  };
}

/**
 * The stage's beads, drawn the way the replay draws them: a filled dot on the
 * path, plus a one-time ring for the bead that has only just formed.
 */
function drawKnots(
  ctx: CanvasRenderingContext2D,
  knots: readonly Knot[],
  color: string,
  nowMs: number,
): void {
  const radius = KNOT_TUNING.strokeWidthPx * KNOT_TUNING.radiusStrokeMultiple;
  for (const knot of knots) {
    ctx.globalAlpha = KNOT_TUNING.alpha;
    ctx.beginPath();
    ctx.arc(knot.x, knot.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    const ringProgress =
      (nowMs - knot.formedMs) / (KNOT_TUNING.ringSeconds * 1000);
    if (ringProgress >= 0 && ringProgress < 1) {
      ctx.globalAlpha = KNOT_TUNING.ringPeakAlpha * (1 - ringProgress);
      ctx.beginPath();
      ctx.arc(
        knot.x,
        knot.y,
        radius * (1 + ringProgress * (KNOT_TUNING.ringRadiusMultiple - 1)),
        0,
        Math.PI * 2,
      );
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** The stage's specks, on the same in-or-out travel the replay gives them. */
function drawGatherings(
  ctx: CanvasRenderingContext2D,
  gatherings: readonly Gathering[],
  nowMs: number,
): void {
  const travelMs = GATHERING_TUNING.travelSeconds * 1000;
  for (const gathering of gatherings) {
    ctx.fillStyle = gathering.color;
    for (const speck of gathering.specks) {
      const progress = (nowMs - speck.startMs) / travelMs;
      if (progress < 0 || progress >= 1) continue;
      const distance = gathering.rising ? 1 - progress : progress;
      ctx.globalAlpha =
        GATHERING_TUNING.peakAlpha * Math.sin(progress * Math.PI);
      ctx.beginPath();
      ctx.arc(
        gathering.x + speck.offsetX * distance,
        gathering.y + speck.offsetY * distance,
        GATHERING_TUNING.speckRadiusPx,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

const labelStyle: React.CSSProperties = {
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  color: "#8a8279",
};

const buttonStyle: React.CSSProperties = {
  padding: "8px 14px",
  border: "1px solid #e0dbd4",
  background: "#f5f0e8",
  cursor: "pointer",
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  color: "#3d3833",
};

/** Everything one scripted run needs while it is playing. */
interface Run {
  id: GestureId;
  /** `performance.now()` the button was pressed at. */
  startedAt: number;
  /** Beats not yet fired, in order. */
  pending: Beat[];
  /** Whether the trail is currently on stage, so a depart beat is meaningful. */
  present: boolean;
  /** How many lengths of the wander path the cursor has travelled. */
  wanderT: number;
  /** The drawn ribbon behind the cursor. */
  points: Array<{ x: number; y: number; t: number }>;
}

interface GestureStageProps {
  /** The shared engine, so a gesture sounds at whatever chord is in force. */
  getEngine: () => Promise<SoundEngine>;
}

/**
 * One gesture at a time, heard and seen together. Each button drives the
 * engine's own trigger path — `tick` with a newly-active frame for an arrival,
 * `retireTrail` for a departure, `triggerNavigation` for a gong — so the sound
 * is the production sound and the gesture is drawn from the notice that sound
 * emits, paced by the chime's actual note offsets rather than by a guess.
 */
export const GestureStage = ({ getEngine }: GestureStageProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SoundEngine | null>(null);
  const visualsRef = useRef(new SoundVisuals());
  const runRef = useRef<Run | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The live `frame` callback, so the visibility listener and the pump can
   * reach the current one without either being rebuilt when it changes.
   */
  const frameRef = useRef<() => void>(() => {});
  const [playing, setPlaying] = useState<GestureId | null>(null);

  /**
   * Where the stage's trail is and what colour it is drawn in. A notice names
   * a trail index and nothing else, so this is how a gesture finds its place —
   * including a departure, whose chime sounds after the trail has left.
   */
  const locateTrail = useCallback((trailIndex: number) => {
    const run = runRef.current;
    if (!run || trailIndex !== STAGE_TRAIL_INDEX) return null;
    const at = wanderAt(run.wanderT);
    return { x: at.x, y: at.y, color: STAGE_COLOR };
  }, []);

  /** Paint the empty stage, so it is not a blank rectangle before a press. */
  const paintIdle = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(STAGE_WIDTH * dpr);
    canvas.height = Math.round(STAGE_HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    ctx.fillStyle = "#f5f0e8";
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  }, []);

  useEffect(() => {
    paintIdle();
  }, [paintIdle]);

  /** Drop whichever of the two step sources is currently outstanding. */
  const unschedule = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * Ask for the next step from whichever source the tab will actually deliver:
   * `requestAnimationFrame` while the page is visible, a timer while it is
   * hidden. Only ever one is outstanding, so a tab that changes state mid-run
   * does not end up stepping twice per beat.
   */
  const schedule = useCallback(() => {
    unschedule();
    const step = () => frameRef.current();
    if (document.hidden) {
      timerRef.current = setTimeout(step, PUMP_INTERVAL_MS);
      return;
    }
    rafRef.current = requestAnimationFrame(step);
  }, [unschedule]);

  /**
   * Move a run in flight onto the other step source the moment the tab's
   * visibility changes, rather than waiting for a step that a hidden tab may
   * never deliver.
   */
  useEffect(() => {
    const onVisibilityChange = () => {
      if (runRef.current) schedule();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [schedule]);

  /**
   * Hand the engine back. The stage borrows the shared engine's notice
   * listener for the length of one gesture, and the replay below binds its own
   * on start, so whichever ran last owns it — releasing here keeps a finished
   * stage run from drawing into a replay that starts afterwards.
   */
  const release = useCallback(() => {
    const engine = engineRef.current;
    const run = runRef.current;
    if (engine && run?.present) {
      engine.retireTrail(STAGE_TRAIL_INDEX);
    }
    engine?.setSoundNoticeListener(null);
    visualsRef.current.clear();
    runRef.current = null;
    unschedule();
    setPlaying(null);
    paintIdle();
  }, [paintIdle, unschedule]);

  useEffect(() => release, [release]);

  const frame = useCallback(() => {
    const run = runRef.current;
    const engine = engineRef.current;
    if (!run || !engine) return;
    // The drawing context is looked up but never gates the run: the sound is
    // the point of a press, and a stage that cannot paint should still be
    // audible rather than silently doing nothing.
    const ctx = canvasRef.current?.getContext("2d") ?? null;

    const elapsedMs = performance.now() - run.startedAt;
    const elapsedSeconds = elapsedMs / 1000;
    const visuals = visualsRef.current;
    const visualConfig = GESTURE_VISUALS[run.id];

    // The engine's own clock. Seeded from performance.now() so it is always
    // far past any arrival suppression a reset elsewhere on the page left
    // behind, and so it only ever moves forward across separate presses.
    const engineMs = run.startedAt + elapsedMs;
    visuals.setNow(engineMs);

    // Read off the same clock the beats and the sounds use, rather than
    // counted per frame: a throttled or backgrounded tab delivers far fewer
    // callbacks than 60 a second, and a per-frame step would drift the cursor
    // out from under the gesture its sound is marking.
    const previous = wanderAt(run.wanderT);
    run.wanderT = elapsedSeconds * WANDER_RATE_PER_SECOND;
    const at = wanderAt(run.wanderT);

    // Beats first, so a gesture fires at the position it was scripted for
    // rather than one frame behind it.
    while (run.pending.length > 0 && run.pending[0].atSeconds <= elapsedSeconds) {
      const beat = run.pending.shift()!;
      if (beat.kind === "arrive") {
        run.present = true;
      } else if (beat.kind === "navigate") {
        engine.triggerNavigation({ trailIndex: STAGE_TRAIL_INDEX, x: at.x });
      } else {
        engine.retireTrail(STAGE_TRAIL_INDEX);
        run.present = false;
      }
    }

    // The real per-frame path an arrival travels: a newly-active frame is what
    // makes the engine count an arrival and chime for it.
    if (run.present) {
      const frames: TrailSoundFrame[] = [
        {
          trailIndex: STAGE_TRAIL_INDEX,
          x: at.x,
          y: at.y,
          prevX: previous.x,
          prevY: previous.y,
          cursorType: "default",
          progress: run.wanderT % 1,
          color: STAGE_COLOR,
          isNewlyActive: run.points.length === 0,
          identityKey: "gesture-stage",
        },
      ];
      engine.tick(engineMs, frames);
      run.points.push({ x: at.x, y: at.y, t: engineMs });
      while (
        run.points.length > 1 &&
        engineMs - run.points[0].t > TRAIL_SPAN_MS
      ) {
        run.points.shift();
      }
    }

    if (ctx) {
      ctx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
      ctx.fillStyle = "#f5f0e8";
      ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // The gong's transient colours. The stored colour is never touched — the
      // tilt leans the whole ribbon, the surge lifts only the stretch travelled
      // in the last span, exactly as the replay draws them.
      const flourish = visuals.getFlourish(STAGE_TRAIL_INDEX);
      const flourishElapsed =
        flourish === undefined ? 0 : engineMs - flourish.startMs;
      const tilted =
        flourish !== undefined && visualConfig.hueTilt
          ? flourishedColor(STAGE_COLOR, flourishElapsed, false, true)
          : STAGE_COLOR;
      const surgedFromMs = engineMs - SURGE_TUNING.spanMs;
      const surged =
        flourish !== undefined && visualConfig.lightnessSurge
          ? flourishedColor(tilted, flourishElapsed, true, false)
          : tilted;

      const points = run.points;
      for (let i = 1; i < points.length; i++) {
        const t = i / points.length;
        ctx.beginPath();
        ctx.moveTo(points[i - 1].x, points[i - 1].y);
        ctx.lineTo(points[i].x, points[i].y);
        ctx.globalAlpha = t * 0.6;
        ctx.lineWidth = 1 + t * 2;
        ctx.strokeStyle = points[i].t >= surgedFromMs ? surged : tilted;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (run.present) {
        ctx.beginPath();
        ctx.arc(at.x, at.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = surged;
        ctx.fill();
      }

      drawKnots(ctx, visuals.getKnots(STAGE_TRAIL_INDEX), STAGE_COLOR, engineMs);
      drawGatherings(ctx, visuals.getGatherings(), engineMs);
    }

    visuals.prune(engineMs);

    if (elapsedSeconds >= GESTURE_SECONDS[run.id]) {
      release();
      return;
    }
    schedule();
  }, [release, schedule]);

  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  const handlePlay = useCallback(
    async (id: GestureId) => {
      // A press while something is running restarts from a clean stage rather
      // than layering two scripts on one canvas.
      release();
      // Pressing a stage button is often the first thing done on a cold page,
      // so the engine may not exist yet and its context may still be suspended.
      const engine = await getEngine();
      engineRef.current = engine;

      const visuals = visualsRef.current;
      visuals.clear();
      visuals.setConfig(GESTURE_VISUALS[id]);
      engine.setSoundNoticeListener((notice) =>
        visuals.handleNotice(notice, locateTrail),
      );
      engine.setCanvasWidth(STAGE_WIDTH);

      runRef.current = {
        id,
        startedAt: performance.now(),
        pending: [...GESTURE_BEATS[id]],
        present: false,
        wanderT: 0,
        points: [],
      };
      setPlaying(id);
      schedule();
    },
    [getEngine, locateTrail, release, schedule],
  );

  return (
    <div style={{ marginTop: "20px" }}>
      <div style={{ ...labelStyle, marginBottom: "4px", color: "#3d3833" }}>
        Gesture stage — sound and sight together
      </div>
      <div style={{ ...labelStyle, marginBottom: "10px", lineHeight: 1.4 }}>
        One gesture at a time on a small scene, so a sound can be judged against
        the mark it leaves. Each button plays the sound the live page would play
        and draws the gesture that sound asks for, from the same moment.
      </div>
      <div
        style={{
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: `${STAGE_WIDTH}px`,
            height: `${STAGE_HEIGHT}px`,
            border: "1px solid #e0dbd4",
            background: "#f5f0e8",
            flex: "0 0 auto",
          }}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
            gap: "8px",
            flex: "1 1 260px",
          }}
        >
          {STAGE_CARDS.map((card) => (
            <div
              key={card.id}
              style={{
                border: "1px solid #e0dbd4",
                background: "#faf7f2",
                padding: "10px",
              }}
            >
              <button
                onClick={() => handlePlay(card.id)}
                style={{
                  ...buttonStyle,
                  width: "100%",
                  background: playing === card.id ? "#e8e0d4" : "#f5f0e8",
                }}
              >
                {card.label}
              </button>
              <div style={{ ...labelStyle, marginTop: "8px", lineHeight: 1.4 }}>
                {card.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
