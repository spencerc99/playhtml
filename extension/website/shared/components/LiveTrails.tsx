// ABOUTME: Animates id-keyed live cursor trails and their click ripples.
// ABOUTME: React owns trail lifetimes while one frame loop draws current progress.

import React, { useEffect, useRef, useState, memo } from "react";
import type { TrailState } from "../types";
import type { SoundEngine } from "../sound/SoundEngine";
import type { TrailSoundFrame } from "../sound/types";
import { getTrailRenderer } from "../styles/trailRenderers";
import { RippleEffect, type RippleSettings } from "./ClickRipple";
import {
  collectDueClickEffects,
  retainClickEffectsForActiveTrails,
  type LiveClickEffect,
} from "./clickEffects";
import { CinematicCamera, type CinematicConfig, type CameraFrame } from "../utils/cinematicCamera";
import { pathLength } from "../utils/trailSequence";
import {
  TrailPath,
  TrailCursor,
  COMPLETED_OPACITY,
  type ImperativeTrailHandle,
  type ImperativeTrailCursorHandle,
} from "./trailPrimitives";
import {
  getTrailVisibility,
  startTrailVisibilityTransition,
  type TrailVisibilityTransition,
} from "./trailVisibility";
import type { TrailOutline } from "../styles/trailRenderers";
import {
  approachDepth,
  assignSedimentDepths,
  DEFAULT_SEDIMENT_SETTINGS,
  estimateInkArea,
  PAPER_COLOR,
  sedimentOpacity,
  sedimentUsesMultiply,
  sedimentWashColor,
  type SedimentCandidate,
  type SedimentSettings,
} from "../utils/liveTrailSediment";

// A trail that hasn't gained a point in this long (and has drawn up to its tip)
// has finished tracing and settles from the live full opacity to the completed
// dim (cursor hidden). Kept comfortably longer than the stream's ~1s batch gaps
// so a still-active person's trail stays solid instead of flickering dim/bright
// between batches; it only settles after they truly stop moving.
const SETTLE_MS = 8000;

// When a trail settles, it eases from full opacity to the completed dim over
// this long instead of snapping, so the dim isn't jarring.
const DIM_FADE_MS = 1200;

// A live trail draws over its real duration (endTime - startTime) like the
// archive — so it traces at the natural pace the activity actually took. Clamp
// so a flick still reads and a very long idle span doesn't take minutes to draw.
const MIN_DRAW_MS = 600;
const MAX_DRAW_MS = 30000;
const MAX_DRAW_SPEED_PX_PER_SECOND = 600;
const MIN_DRAW_MS_PER_SEGMENT = 32;

// Settled trails are not removed on a timer. They stay as sediment until
// enough newer trails have settled on top of them to push them out of the
// window (by count or by ink coverage, see liveTrailSediment). A settled
// trail's depth in that window glides toward its target with this time
// constant so the field re-layers smoothly as new ink arrives.
const DEPTH_TAU_MS = 1200;

// The paper gutter drawn under actively tracing ink: its total stroke width
// as a multiple of the trail width (half of it shows on each side), and how
// opaque the paper is so the cut reads as a gap without looking pasted on.
const HALO_WIDTH_FACTOR = 1.3;
const HALO_MIN_WIDTH = 4;
const HALO_OPACITY = 0.85;

export interface LiveTrailDrawState {
  seenAt: number;
  total: number;
  variedTotal: number;
  drawProgress: number;
  grewAt: number;
  caughtUpAt: number | null;
  settled: boolean;
  settledAt: number | null;
  dimmedAt: number | null;
  activeFromVariedPoint: number | null;
  activeDimmedAt: number | null;
  /** Smoothed position in the sediment window, 0 fresh .. 1 about to leave. */
  depth: number;
  /** Set by the window assignment once newer ink has pushed this trail out. */
  departs: boolean;
  /** Ink footprint measured when the trail settled, for coverage windows. */
  inkArea: number;
}

export function createLiveTrailDrawState(
  clockMs: number,
  pointCount: number,
  variedPointCount: number,
): LiveTrailDrawState {
  return {
    seenAt: clockMs,
    total: pointCount,
    variedTotal: variedPointCount,
    drawProgress: 0,
    grewAt: clockMs,
    caughtUpAt: null,
    settled: false,
    settledAt: null,
    dimmedAt: null,
    activeFromVariedPoint: null,
    activeDimmedAt: null,
    depth: 0,
    departs: false,
    inkArea: 0,
  };
}

/** A settled trail departs only once the sediment window has pushed it out;
 * a trail that resumed drawing is never departed. */
export function shouldDepartTrail(
  draw: LiveTrailDrawState | undefined,
  resumed = false,
): boolean {
  return Boolean(!resumed && draw?.settled && draw.departs);
}

/** Opacity factor of a trail's settled base ink. While it is dimming it eases
 * from the live opacity toward `settledOpacity`; once dimmed it follows that
 * value, which the caller derives from the trail's sediment depth. */
export function getLiveTrailOpacity(
  draw: LiveTrailDrawState,
  clockMs: number,
  settledOpacity = COMPLETED_OPACITY,
): number {
  if (draw.dimmedAt === null) return 1;

  const dimProgress = Math.min(1, (clockMs - draw.dimmedAt) / DIM_FADE_MS);
  return 1 - (1 - settledOpacity) * dimProgress;
}

/** Opacity of the paper halo under a trail's base ink: full while it traces,
 * gone once it has dimmed into sediment. */
export function getBaseHaloOpacity(
  draw: LiveTrailDrawState,
  clockMs: number,
): number {
  if (draw.dimmedAt === null) return 1;
  return Math.max(0, 1 - (clockMs - draw.dimmedAt) / DIM_FADE_MS);
}

/** Assign every settled, present trail its window depth and departure flag. */
export function applySedimentWindow(
  draws: ReadonlyMap<string, LiveTrailDrawState>,
  presentIds: ReadonlySet<string>,
  settings: SedimentSettings,
  screenArea: number,
): Map<string, number> {
  const candidates: SedimentCandidate[] = [];
  for (const [id, draw] of draws) {
    if (!presentIds.has(id) || !draw.settled || draw.settledAt === null) {
      continue;
    }
    candidates.push({ id, settledAt: draw.settledAt, inkArea: draw.inkArea });
  }
  const assignments = assignSedimentDepths(candidates, settings, screenArea);
  const targets = new Map<string, number>();
  for (const [id, draw] of draws) {
    const assignment = assignments.get(id);
    if (assignment) {
      draw.departs = assignment.departs;
      targets.set(id, assignment.depth);
    } else {
      draw.departs = false;
      targets.set(id, 0);
    }
  }
  return targets;
}

export function getActiveTrailOpacity(
  draw: LiveTrailDrawState,
  clockMs: number,
): number {
  if (draw.activeFromVariedPoint === null) return 0;
  if (draw.activeDimmedAt === null) return 1;

  return Math.max(0, 1 - (clockMs - draw.activeDimmedAt) / DIM_FADE_MS);
}

export function advanceDrawState(
  draw: LiveTrailDrawState,
  pointCount: number,
  variedPointCount: number,
  clockMs: number,
  drawDuration: number,
): void {
  if (pointCount <= draw.total) return;

  const priorLastIndex = Math.max(1, draw.variedTotal - 1);
  const nextLastIndex = Math.max(1, variedPointCount - 1);
  const preservedProgress =
    (draw.drawProgress * priorLastIndex) / nextLastIndex;
  draw.seenAt = clockMs - preservedProgress * drawDuration;
  draw.drawProgress = preservedProgress;

  if (draw.settled) {
    draw.activeFromVariedPoint = priorLastIndex;
    draw.activeDimmedAt = null;
    draw.settled = false;
    draw.settledAt = null;
    draw.departs = false;
  }

  draw.total = pointCount;
  draw.variedTotal = variedPointCount;
  draw.grewAt = clockMs;
  draw.caughtUpAt = null;
}

export function getLiveDrawDuration(trailState: TrailState): number {
  const spatialDuration =
    (pathLength(trailState.variedPoints) / MAX_DRAW_SPEED_PX_PER_SECOND) * 1000;
  const segmentDuration =
    Math.max(0, trailState.variedPoints.length - 1) *
    MIN_DRAW_MS_PER_SEGMENT;
  return Math.max(
    MIN_DRAW_MS,
    Math.min(MAX_DRAW_MS, trailState.durationMs),
    spatialDuration,
    segmentDuration,
  );
}

export function advanceSettlingState(
  draw: LiveTrailDrawState,
  caughtUp: boolean,
  clockMs: number,
): void {
  if (!caughtUp) {
    draw.caughtUpAt = null;
    return;
  }

  draw.caughtUpAt ??= clockMs;
  if (draw.settled || clockMs - draw.caughtUpAt < SETTLE_MS) return;

  draw.settled = true;
  draw.settledAt = clockMs;
  if (draw.activeFromVariedPoint === null) {
    draw.dimmedAt ??= clockMs;
  } else {
    draw.activeDimmedAt = clockMs;
  }
}

export function getDrawClockTime(
  performanceNow: number,
  pausedAccumMs: number,
  pauseStartedAt: number | null,
): number {
  return (pauseStartedAt ?? performanceNow) - pausedAccumMs;
}

export function createLiveSoundFrame(
  trailIndex: number,
  trailState: TrailState,
  cursorPosition: { x: number; y: number },
  trailProgress: number,
): TrailSoundFrame {
  const points = trailState.trail.points;
  const cursorPointIndex = Math.min(
    Math.floor((points.length - 1) * trailProgress),
    points.length - 1,
  );
  return {
    trailIndex,
    x: cursorPosition.x,
    y: cursorPosition.y,
    prevX: cursorPosition.x,
    prevY: cursorPosition.y,
    cursorType: points[cursorPointIndex]?.cursor,
    progress: trailProgress,
    color: trailState.trail.color,
    isNewlyActive: false,
  };
}

/** Tiny deterministic hash of a string to a small int, for per-trail variation. */
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** A trail LiveTrails is keeping on screen, including its current arrival or
 * departure transition. */
interface KeptTrail {
  trail: TrailState;
  visibility: TrailVisibilityTransition | null;
}

interface LiveTrailsProps {
  trailStates: TrailState[];
  frozen?: boolean;
  visible?: boolean;
  cinematic?: CinematicConfig | null;
  cinematicNextSignal?: number;
  showClickRipples?: boolean;
  soundEngine?: SoundEngine | null;
  /** Called with trail ids once they have fully faded out and been removed, so
   * the owner can free their accumulated events. */
  onTrailsRemoved?: (ids: string[]) => void;
  settings: RippleSettings & {
    strokeWidth: number;
    trailOpacity: number;
    animationSpeed: number;
    trailVisualStyle?: string;
    /** How settled trails accumulate and recede; defaults to a count window. */
    sediment?: SedimentSettings;
  };
}

export const LiveTrails: React.FC<LiveTrailsProps> = memo(
  ({
    trailStates,
    frozen = false,
    visible = true,
    cinematic = null,
    cinematicNextSignal = 0,
    showClickRipples = false,
    soundEngine = null,
    onTrailsRemoved,
    settings,
  }) => {
    const [activeClickEffects, setActiveClickEffects] = useState<
      LiveClickEffect[]
    >([]);
    const activeClickEffectsRef = useRef(activeClickEffects);
    useEffect(() => {
      activeClickEffectsRef.current = activeClickEffects;
    }, [activeClickEffects]);
    const svgRef = useRef<SVGSVGElement>(null);
    const cameraRef = useRef<CinematicCamera | null>(null);
    const cameraIndicesRef = useRef(new Map<string, number>());
    const nextCameraIndexRef = useRef(0);
    useEffect(() => {
      if (cinematic) {
        if (cameraRef.current) cameraRef.current.setConfig(cinematic);
        else cameraRef.current = new CinematicCamera(cinematic);
      } else {
        cameraRef.current = null;
        svgRef.current?.removeAttribute("viewBox");
      }
    }, [cinematic]);
    useEffect(() => {
      if (cinematicNextSignal > 0) cameraRef.current?.requestNext();
    }, [cinematicNextSignal]);
    const pathLayerRef = useRef<SVGGElement>(null);
    const animationRef = useRef<number | undefined>(undefined);
    const consecutiveErrorsRef = useRef(0);

    const renderer = getTrailRenderer(settings.trailVisualStyle ?? "color");
    const rendererRef = useRef(renderer);
    useEffect(() => {
      rendererRef.current = renderer;
    }, [renderer]);

    // Settings via refs so the loop reads latest without restarting.
    const strokeWidthRef = useRef(settings.strokeWidth);
    const trailOpacityRef = useRef(settings.trailOpacity);
    const sedimentRef = useRef(settings.sediment ?? DEFAULT_SEDIMENT_SETTINGS);
    useEffect(() => {
      strokeWidthRef.current = settings.strokeWidth;
      trailOpacityRef.current = settings.trailOpacity;
      sedimentRef.current = settings.sediment ?? DEFAULT_SEDIMENT_SETTINGS;
    }, [settings.strokeWidth, settings.trailOpacity, settings.sediment]);
    const lastFrameClockRef = useRef<number | null>(null);

    const frozenRef = useRef(frozen);
    useEffect(() => {
      frozenRef.current = frozen;
    }, [frozen]);

    const showClickRipplesRef = useRef(showClickRipples);
    useEffect(() => {
      showClickRipplesRef.current = showClickRipples;
      if (!showClickRipples) setActiveClickEffects([]);
    }, [showClickRipples]);

    const soundEngineRef = useRef(soundEngine);
    useEffect(() => {
      soundEngineRef.current = soundEngine;
    }, [soundEngine]);
    const soundFramesRef = useRef<TrailSoundFrame[]>([]);
    const soundTrailIndicesRef = useRef<Map<string, number>>(new Map());
    const nextSoundTrailIndexRef = useRef(0);
    const retiredSoundTrailIndicesRef = useRef<number[]>([]);
    const queueSoundTrailRetirement = (trailId: string) => {
      const soundTrailIndex = soundTrailIndicesRef.current.get(trailId);
      if (soundTrailIndex !== undefined) {
        retiredSoundTrailIndicesRef.current.push(soundTrailIndex);
      }
      soundTrailIndicesRef.current.delete(trailId);
    };

    const spawnedClickKeysByTrailRef = useRef<Map<string, Set<string>>>(
      new Map(),
    );

    // Per-trail draw state. `seenAt` is the clock time the trail began drawing;
    // progress = (clock - seenAt) / drawDuration, so it traces over its real
    // duration like the archive. As new points arrive the duration grows, so the
    // draw keeps going (catches up) instead of snapping to the end. `total` and
    // `grewAt` track the latest point count and when it last grew, to decide when
    // a caught-up trail has settled.
    const drawRef = useRef<Map<string, LiveTrailDrawState>>(new Map());

    // Trails LiveTrails keeps on screen — the current live trails plus recently
    // departed ones still fading out. Owned here (not just `trailStates`) so a
    // trail's lifetime is decoupled from the churning event window. Each entry
    // tracks its current visibility transition. Updated ONLY in the effect below
    // (never during render) so the rendered keys are always unique.
    const [kept, setKept] = useState<KeptTrail[]>(() =>
      trailStates.map((trail) => ({ trail, visibility: null })),
    );
    const keptRef = useRef<KeptTrail[]>(kept);

    // Ids dropped from `kept` (fully faded), buffered to report to the owner so
    // it can free their accumulated events. Filled in the (pure) state updaters,
    // flushed here after commit.
    const removedIdsRef = useRef<string[]>([]);
    const onRemovedRef = useRef(onTrailsRemoved);
    useEffect(() => {
      onRemovedRef.current = onTrailsRemoved;
    }, [onTrailsRemoved]);

    useEffect(() => {
      keptRef.current = kept;
      if (retiredSoundTrailIndicesRef.current.length > 0) {
        const trailIndices = retiredSoundTrailIndicesRef.current;
        retiredSoundTrailIndicesRef.current = [];
        for (const trailIndex of trailIndices) {
          soundEngineRef.current?.retireTrail(trailIndex);
        }
      }
      if (removedIdsRef.current.length > 0) {
        const ids = removedIdsRef.current;
        removedIdsRef.current = [];
        const removed = new Set(ids);
        setActiveClickEffects((effects) =>
          retainClickEffectsForActiveTrails(effects, removed),
        );
        onRemovedRef.current?.(ids);
      }
    }, [kept]);

    // Reconcile `kept` with the latest live trails. Runs on every trailStates
    // change (live data changes frequently, so this also drives depart expiry).
    useEffect(() => {
      const now = drawClock();
      const liveById = new Map(trailStates.map((t) => [t.trail.id, t]));

      const draws = drawRef.current;
      setKept((prev) => {
        const next: KeptTrail[] = [];
        const handled = new Set<string>();

        for (const entry of prev) {
          const id = entry.trail.trail.id;
          handled.add(id);
          const live = liveById.get(id);
          // A settled trail the sediment window has pushed out starts
          // departing even though it is still in the live data.
          const d = draws.get(id);
          const resumed =
            live !== undefined &&
            d !== undefined &&
            live.trail.points.length > d.total;
          const dimExpired = shouldDepartTrail(d, resumed);
          if (live && !dimExpired) {
            // Still live — refresh geometry and ease back if it was departing.
            const visibility =
              entry.visibility?.toOpacity === 0
                ? startTrailVisibilityTransition(entry.visibility, now, true)
                : entry.visibility;
            next.push({ trail: live, visibility });
          } else if (entry.visibility?.toOpacity !== 0) {
            // Left, or dimmed long enough — start its fade.
            next.push({
              trail: live ?? entry.trail,
              visibility: startTrailVisibilityTransition(
                entry.visibility,
                now,
                false,
              ),
            });
          } else if (getTrailVisibility(entry.visibility, now) > 0) {
            // Still fading — keep.
            next.push(entry);
          } else {
            // Fully faded — drop, and report so its events can be freed.
            removedIdsRef.current.push(id);
            spawnedClickKeysByTrailRef.current.delete(id);
            queueSoundTrailRetirement(id);
          }
        }
        // Brand-new live trails not already in `kept`.
        for (const t of trailStates) {
          if (!handled.has(t.trail.id)) {
            next.push({ trail: t, visibility: null });
          }
        }
        return next;
      });
    }, [trailStates]);

    // Drive window departures and depart-fade expiry on a timer, since the
    // reconcile above only runs when `trailStates` changes — a fully-settled
    // canvas with no new events would otherwise never remove anything.
    useEffect(() => {
      const id = window.setInterval(() => {
        // While frozen, the draw clock is paused and the canvas isn't
        // repainting — so don't advance depart/removal either, or trails would
        // silently pop off-screen during a pause.
        if (frozenRef.current) return;
        const now = drawClock();
        const draws = drawRef.current;
        setKept((prev) => {
          let changed = false;
          const next: KeptTrail[] = [];
          for (const entry of prev) {
            const tid = entry.trail.trail.id;
            const d = draws.get(tid);
            const dimExpired = shouldDepartTrail(d);
            const departing = entry.visibility?.toOpacity === 0;
            if (dimExpired && !departing) {
              next.push({
                trail: entry.trail,
                visibility: startTrailVisibilityTransition(
                  entry.visibility,
                  now,
                  false,
                ),
              });
              changed = true;
            } else if (
              !departing ||
              getTrailVisibility(entry.visibility, now) > 0
            ) {
              next.push(entry);
            } else {
              // Fully faded — drop, and report so its events can be freed.
              changed = true;
              removedIdsRef.current.push(tid);
              spawnedClickKeysByTrailRef.current.delete(tid);
              queueSoundTrailRetirement(tid);
            }
          }
          return changed ? next : prev;
        });
      }, 1000);
      return () => window.clearInterval(id);
    }, []);

    useEffect(
      () => () => {
        for (const trailIndex of soundTrailIndicesRef.current.values()) {
          soundEngineRef.current?.retireTrail(trailIndex);
        }
      },
      [],
    );

    // Per-trail imperative handles, keyed by stable trail id.
    const trailHandles = useRef<Map<string, ImperativeTrailHandle>>(new Map());
    const cursorHandles = useRef<Map<string, ImperativeTrailCursorHandle>>(
      new Map(),
    );
    const rippleGroups = useRef<Map<string, SVGGElement>>(new Map());

    // Accumulated paused wall-clock, subtracted from the clock so trails don't
    // leap when resumed.
    const pausedAccumMsRef = useRef(0);
    const pauseStartedAtRef = useRef<number | null>(null);

    // The draw clock: wall-clock minus time spent paused. Depart timestamps and
    // fades MUST use this (not raw performance.now()) so a depart-fade that's in
    // progress when the canvas pauses doesn't keep accruing during the pause.
    const drawClock = () =>
      getDrawClockTime(
        performance.now(),
        pausedAccumMsRef.current,
        pauseStartedAtRef.current,
      );

    useEffect(() => {
      const clearScheduled = () => {
        if (animationRef.current !== undefined) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = undefined;
        }
      };

      const pauseDrawClock = (perfNow: number) => {
        if (pauseStartedAtRef.current === null) {
          pauseStartedAtRef.current = perfNow;
        }
      };

      const resumeDrawClock = (perfNow: number) => {
        if (pauseStartedAtRef.current !== null) {
          pausedAccumMsRef.current += perfNow - pauseStartedAtRef.current;
          pauseStartedAtRef.current = null;
        }
      };

      const scheduleNext = () => {
        clearScheduled();
        if (document.visibilityState === "hidden") {
          pauseDrawClock(performance.now());
          return;
        }
        animationRef.current = requestAnimationFrame(tick);
      };

      const tick = (perfNow: number) => {
        try {
          runFrame(perfNow);
          consecutiveErrorsRef.current = 0;
        } catch (err) {
          const n = ++consecutiveErrorsRef.current;
          // One bad frame shouldn't kill the loop, but a persistently throwing
          // frame must not spam 60×/s forever. Log the first few + occasionally,
          // then give up so the wedge is loud-once, not silent-but-spamming.
          if (n <= 3 || n % 300 === 0) {
            console.error(
              `[LiveTrails] frame error (#${n}, kept=${keptRef.current.length}):`,
              err,
            );
          }
          if (n > 600) {
            console.error("[LiveTrails] giving up rAF loop after persistent errors");
            return; // stop rescheduling — the loop is wedged on broken state
          }
        }
        scheduleNext();
      };

      const runFrame = (perfNow: number) => {
        if (frozenRef.current) {
          pauseDrawClock(perfNow);
          soundEngineRef.current?.tick(
            getDrawClockTime(
              perfNow,
              pausedAccumMsRef.current,
              pauseStartedAtRef.current,
            ),
            [],
          );
          return;
        }
        resumeDrawClock(perfNow);

        const entries = keptRef.current;
        const clockMs = perfNow - pausedAccumMsRef.current;
        const trailOpacity = trailOpacityRef.current;
        const strokeWidth = strokeWidthRef.current;
        const sediment = sedimentRef.current;
        const drawMap = drawRef.current;
        const frameDtMs =
          lastFrameClockRef.current === null
            ? 0
            : Math.max(0, clockMs - lastFrameClockRef.current);
        lastFrameClockRef.current = clockMs;
        const useMultiply = sedimentUsesMultiply(sediment.style);
        const haloWidth = Math.max(
          HALO_MIN_WIDTH,
          strokeWidth * HALO_WIDTH_FACTOR,
        );

        // Re-rank the settled field before drawing: every settled trail gets
        // its depth target for this frame, and any pushed out of the window
        // is flagged so the reconcile/timer above starts its departure.
        const presentIds = new Set<string>();
        for (const entry of entries) presentIds.add(entry.trail.trail.id);
        const depthTargets = applySedimentWindow(
          drawMap,
          presentIds,
          sediment,
          window.innerWidth * window.innerHeight,
        );
        const soundEngine = soundEngineRef.current;
        const soundFrames = soundFramesRef.current;
        soundFrames.length = 0;
        const visibilityByTrail = new Map<string, number>();

        const present = new Set<string>();
        const cameraTrails: CameraFrame["activeTrails"] = [];

        for (const entry of entries) {
          const ts = entry.trail;
          const key = ts.trail.id;
          present.add(key);
          const handle = trailHandles.current.get(key);
          if (!handle) continue;

          const pts = ts.trail.points.length;
          let draw = drawMap.get(key);
          const drawDuration = getLiveDrawDuration(ts);
          if (draw === undefined) {
            // New trail: anchor its draw clock to now.
            draw = createLiveTrailDrawState(
              clockMs,
              pts,
              ts.variedPoints.length,
            );
            drawMap.set(key, draw);
          } else {
            advanceDrawState(
              draw,
              pts,
              ts.variedPoints.length,
              clockMs,
              drawDuration,
            );
          }

          // Draw over the trail's real duration (clamped), like the archive: a
          // trail spanning 20s of activity traces over ~20s. As points arrive the
          // duration grows, so progress doesn't snap to the end — the draw keeps
          // going and naturally catches up to live.
          const drawProgress = Math.min(
            1,
            (clockMs - draw.seenAt) / drawDuration,
          );
          const caughtUp = drawProgress >= 1;

          const wasSettled = draw.settled;
          advanceSettlingState(draw, caughtUp, clockMs);
          if (draw.settled && !wasSettled) {
            draw.inkArea = estimateInkArea(ts.variedPoints, strokeWidth);
          }
          // A settled trail always shows its full current geometry (dimmed); a
          // live one draws progressively toward its tip.
          const progress = draw.settled ? 1 : drawProgress;
          draw.drawProgress = progress;

          // Glide toward this frame's window depth. A trail that is tracing
          // (new or resumed) heads back to the surface.
          draw.depth = approachDepth(
            draw.depth,
            draw.settled ? (depthTargets.get(key) ?? 0) : 0,
            frameDtMs,
            DEPTH_TAU_MS,
          );

          // Completed ink recedes with its depth while a resumed portion draws
          // at the live opacity. When that portion settles, it fades into the
          // sediment base.
          const settleOpacity = getLiveTrailOpacity(
            draw,
            clockMs,
            sedimentOpacity(draw.depth, sediment),
          );
          const activeOpacity = getActiveTrailOpacity(draw, clockMs);
          const visibility = getTrailVisibility(entry.visibility, clockMs);
          // Click marks recede with their trail's ink so a dark person's
          // rings don't stay heavy over pale sediment.
          visibilityByTrail.set(key, visibility * settleOpacity);
          const activeStartProgress =
            draw.activeFromVariedPoint === null || ts.variedPoints.length < 2
              ? null
              : draw.activeFromVariedPoint / (ts.variedPoints.length - 1);

          const baseHaloOpacity = sediment.activeHalo
            ? getBaseHaloOpacity(draw, clockMs) * HALO_OPACITY
            : 0;
          const baseOutline: TrailOutline | null =
            baseHaloOpacity > 0 && draw.activeFromVariedPoint === null
              ? { color: PAPER_COLOR, width: haloWidth, opacity: baseHaloOpacity }
              : null;
          const activeOutline: TrailOutline | null =
            sediment.activeHalo && activeOpacity > 0
              ? {
                  color: PAPER_COLOR,
                  width: haloWidth,
                  opacity: activeOpacity * HALO_OPACITY,
                }
              : null;

          const result = handle.update(
            0,
            trailOpacity * settleOpacity,
            strokeWidth,
            visibility,
            progress,
            activeStartProgress === null || activeOpacity <= 0
              ? undefined
              : {
                  startProgress: activeStartProgress,
                  baseProgress:
                    draw.activeDimmedAt === null
                      ? activeStartProgress
                      : progress,
                  opacity: trailOpacity * activeOpacity,
                  outline: activeOutline,
                },
            {
              color: sedimentWashColor(
                ts.trail.color,
                draw.depth,
                sediment.style,
                sediment.maxWash,
              ),
              blend: useMultiply ? "multiply" : "normal",
              outline: baseOutline,
            },
          );

          const activelyTracing =
            result &&
            !caughtUp &&
            !draw.settled &&
            entry.visibility?.toOpacity !== 0;
          if (cameraRef.current && activelyTracing) {
            let index = cameraIndicesRef.current.get(key);
            if (index === undefined) {
              index = nextCameraIndexRef.current++;
              cameraIndicesRef.current.set(key, index);
            }
            cameraTrails.push({
              index,
              ...result.cursorPosition,
              progress: result.trailProgress,
            });
          }
          if (soundEngine && activelyTracing) {
            let soundTrailIndex = soundTrailIndicesRef.current.get(key);
            if (soundTrailIndex === undefined) {
              soundTrailIndex = nextSoundTrailIndexRef.current++;
              soundTrailIndicesRef.current.set(key, soundTrailIndex);
            }
            soundFrames.push(
              createLiveSoundFrame(
                soundTrailIndex,
                ts,
                result.cursorPosition,
                result.trailProgress,
              ),
            );
          }

          if (result && showClickRipplesRef.current) {
            let spawnedClickKeys = spawnedClickKeysByTrailRef.current.get(key);
            if (!spawnedClickKeys) {
              spawnedClickKeys = new Set();
              spawnedClickKeysByTrailRef.current.set(key, spawnedClickKeys);
            }
            const effects = collectDueClickEffects(
              ts,
              result.trailProgress,
              spawnedClickKeys,
              result.cursorPosition,
              rendererRef.current.getClickColor(ts.trail.color),
              Date.now(),
            );
            if (effects.length > 0) {
              if (soundEngine) {
                for (const effect of effects) {
                  soundEngine.triggerClick({
                    x: effect.x,
                    y: effect.y,
                    holdDuration: effect.holdDuration,
                  });
                }
              }
              setActiveClickEffects((active) => [...active, ...effects]);
            }
          }

          // Show the cursor at the moving draw-head while the trail is still
          // actively tracing (not caught up, not settled, not departing).
          const cursorHandle = cursorHandles.current.get(key);
          if (
            cursorHandle &&
            result &&
            result.cursorPosition &&
            !caughtUp &&
            !draw.settled &&
            entry.visibility?.toOpacity !== 0
          ) {
            const cpIdx = Math.min(
              Math.floor((pts - 1) * (result.trailProgress ?? progress)),
              pts - 1,
            );
            cursorHandle.update(
              result.cursorPosition,
              ts.trail.points[cpIdx]?.cursor,
              false,
              progress,
              visibility,
            );
          } else {
            cursorHandle?.hide();
          }
        }

        for (const effect of activeClickEffectsRef.current) {
          const group = rippleGroups.current.get(effect.id);
          if (!group) continue;
          const opacity = String(visibilityByTrail.get(effect.trailId) ?? 0);
          if (group.getAttribute("opacity") !== opacity) {
            group.setAttribute("opacity", opacity);
          }
        }

        const viewBox = cameraRef.current?.tick({
          screenW: window.innerWidth,
          screenH: window.innerHeight,
          nowMs: clockMs,
          activeTrails: cameraTrails,
        });
        if (viewBox) {
          svgRef.current?.setAttribute(
            "viewBox",
            `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`,
          );
        }
        for (const key of cameraIndicesRef.current.keys()) {
          if (!present.has(key)) cameraIndicesRef.current.delete(key);
        }
        soundEngine?.tick(clockMs, soundFrames);

        // Prune draw tracking for trails that left so the map can't grow.
        if (drawMap.size > present.size) {
          for (const key of drawMap.keys()) {
            if (!present.has(key)) drawMap.delete(key);
          }
        }
      };

      const onVisibility = () => scheduleNext();
      document.addEventListener("visibilitychange", onVisibility);
      scheduleNext();

      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        clearScheduled();
      };
    }, []);

    return (
      <svg
        ref={svgRef}
        className="trails-svg"
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "none",
          visibility: visible ? "visible" : "hidden",
        }}
      >
        {showClickRipples &&
          activeClickEffects.map((effect) => (
            <g
              key={effect.id}
              ref={(group) => {
                if (group) rippleGroups.current.set(effect.id, group);
                else rippleGroups.current.delete(effect.id);
              }}
            >
              <RippleEffect effect={effect} settings={settings} />
            </g>
          ))}
        <g ref={pathLayerRef}>
          {kept.map((entry) => {
            const ts = entry.trail;
            const key = ts.trail.id;
            return (
              <TrailPath
                key={`live-path-${key}`}
                ref={(handle) => {
                  if (handle) trailHandles.current.set(key, handle);
                  else trailHandles.current.delete(key);
                }}
                trailState={ts}
                fixedMonoStrokeWidth={1 + (hashKey(key) % 5)}
                renderer={renderer}
              />
            );
          })}
        </g>
        {kept.map((entry) => {
          const ts = entry.trail;
          const key = ts.trail.id;
          return (
            <TrailCursor
              key={`live-cursor-${key}`}
              ref={(handle) => {
                if (handle) cursorHandles.current.set(key, handle);
                else cursorHandles.current.delete(key);
              }}
              trailState={ts}
              renderer={renderer}
            />
          );
        })}
      </svg>
    );
  },
);
