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
} from "./liveClickEffects";
import {
  TrailPath,
  TrailCursor,
  COMPLETED_OPACITY,
  EVICTION_FADE_MS,
  type ImperativeTrailHandle,
  type ImperativeTrailCursorHandle,
} from "./trailPrimitives";

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

// Once a trail has settled (dimmed, done tracing), keep it on screen this long
// before removing it, so finished trails persist as a dim backdrop rather than
// vanishing. After this it depart-fades out. (The maxGroups cap upstream also
// bounds how many accumulate regardless.)
const REMOVE_AFTER_DIM_MS = 20_000;

// A removed trail fades out over this long instead of popping — matches the
// archive's eviction fade (EVICTION_FADE_MS).
const KEEP_AFTER_DEPART_MS = EVICTION_FADE_MS;

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

/** A trail LiveTrails is keeping on screen. `departedAt` is null while the trail
 * is still in the live window; once it leaves, it's the wall-clock time the fade
 * started. */
interface KeptTrail {
  trail: TrailState;
  departedAt: number | null;
}

interface LiveTrailsProps {
  trailStates: TrailState[];
  frozen?: boolean;
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
  };
}

export const LiveTrails: React.FC<LiveTrailsProps> = memo(
  ({
    trailStates,
    frozen = false,
    showClickRipples = false,
    soundEngine = null,
    onTrailsRemoved,
    settings,
  }) => {
    const [activeClickEffects, setActiveClickEffects] = useState<
      LiveClickEffect[]
    >([]);
    const svgRef = useRef<SVGSVGElement>(null);
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
    useEffect(() => {
      strokeWidthRef.current = settings.strokeWidth;
      trailOpacityRef.current = settings.trailOpacity;
    }, [settings.strokeWidth, settings.trailOpacity]);

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
    const drawRef = useRef<
      Map<
        string,
        {
          seenAt: number;
          total: number;
          grewAt: number;
          settled: boolean;
          settledAt: number | null;
        }
      >
    >(new Map());

    // Trails LiveTrails keeps on screen — the current live trails plus recently
    // departed ones still fading out. Owned here (not just `trailStates`) so a
    // trail's lifetime is decoupled from the churning event window. Each entry
    // tracks `departedAt` (null while still live). Updated ONLY in the effect
    // below (never during render) so the rendered keys are always unique.
    const [kept, setKept] = useState<KeptTrail[]>(() =>
      trailStates.map((trail) => ({ trail, departedAt: null })),
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
          // A trail that has been dimmed (settled) for REMOVE_AFTER_DIM_MS starts
          // departing even though it is still in the live data.
          const d = draws.get(id);
          const dimExpired =
            d?.settled &&
            d.settledAt !== null &&
            now - d.settledAt >= REMOVE_AFTER_DIM_MS;
          if (live && !dimExpired) {
            // Still live — refresh geometry, clear any departed mark.
            next.push({ trail: live, departedAt: null });
          } else if (entry.departedAt === null) {
            // Left, or dimmed long enough — start its fade.
            next.push({ trail: live ?? entry.trail, departedAt: now });
          } else if (now - entry.departedAt < KEEP_AFTER_DEPART_MS) {
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
            next.push({ trail: t, departedAt: null });
          }
        }
        return next;
      });
    }, [trailStates]);

    // Drive depart-on-dim-expiry and depart-fade expiry on a timer, since the
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
            const dimExpired =
              d?.settled &&
              d.settledAt !== null &&
              now - d.settledAt >= REMOVE_AFTER_DIM_MS;
            if (entry.departedAt === null) {
              if (dimExpired) {
                next.push({ trail: entry.trail, departedAt: now });
                changed = true;
              } else {
                next.push(entry);
              }
            } else if (now - entry.departedAt < KEEP_AFTER_DEPART_MS) {
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
        const drawMap = drawRef.current;
        const soundEngine = soundEngineRef.current;
        const soundFrames = soundFramesRef.current;
        soundFrames.length = 0;

        const present = new Set<string>();

        for (const entry of entries) {
          const ts = entry.trail;
          const key = ts.trail.id;
          present.add(key);
          const handle = trailHandles.current.get(key);
          if (!handle) continue;

          const pts = ts.trail.points.length;
          let draw = drawMap.get(key);
          if (draw === undefined) {
            // New trail: anchor its draw clock to now.
            draw = {
              seenAt: clockMs,
              total: pts,
              grewAt: clockMs,
              settled: false,
              settledAt: null,
            };
            drawMap.set(key, draw);
          } else if (pts > draw.total && !draw.settled) {
            // Gained points while still live — there's more to draw, so refresh
            // the activity clock. Once settled we IGNORE new points for liveness
            // (a dimmed trail never brightens again, even if the person resumes).
            draw.total = pts;
            draw.grewAt = clockMs;
          }

          // Draw over the trail's real duration (clamped), like the archive: a
          // trail spanning 20s of activity traces over ~20s. As points arrive the
          // duration grows, so progress doesn't snap to the end — the draw keeps
          // going and naturally catches up to live.
          const drawDuration = Math.min(
            MAX_DRAW_MS,
            Math.max(MIN_DRAW_MS, ts.durationMs),
          );
          const drawProgress = Math.min(
            1,
            (clockMs - draw.seenAt) / drawDuration,
          );
          const caughtUp = drawProgress >= 1;

          // Latch "settled" once a trail has fully drawn and gone quiet for
          // SETTLE_MS. Settling is one-way: a settled trail stays dimmed for the
          // rest of its life (it never un-dims), per the design.
          if (!draw.settled && caughtUp && clockMs - draw.grewAt >= SETTLE_MS) {
            draw.settled = true;
            draw.settledAt = clockMs;
          }
          // A settled trail always shows its full current geometry (dimmed); a
          // live one draws progressively toward its tip.
          const progress = draw.settled ? 1 : drawProgress;

          // Departed trails fade from their current opacity to 0 over the keep
          // window, then the reconcile effect drops them.
          let departFade = 1;
          if (entry.departedAt !== null) {
            departFade = Math.max(
              0,
              1 - (clockMs - entry.departedAt) / KEEP_AFTER_DEPART_MS,
            );
          }

          // Live (tracing) trails are full opacity; settled ones ease down to
          // COMPLETED_OPACITY over DIM_FADE_MS (no jarring snap). Depart fade
          // multiplies on top.
          let settleOpacity = 1;
          if (draw.settled && draw.settledAt !== null) {
            const dimT = Math.min(1, (clockMs - draw.settledAt) / DIM_FADE_MS);
            settleOpacity = 1 - (1 - COMPLETED_OPACITY) * dimT;
          }
          const groupFade = settleOpacity * departFade;

          const result = handle.update(
            0,
            trailOpacity,
            strokeWidth,
            groupFade,
            progress,
          );

          const activelyTracing =
            result &&
            !caughtUp &&
            !draw.settled &&
            entry.departedAt === null;
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
            entry.departedAt === null
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
              groupFade,
            );
          } else {
            cursorHandle?.hide();
          }
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
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
      >
        {showClickRipples &&
          activeClickEffects.map((effect) => (
            <RippleEffect
              key={effect.id}
              effect={effect}
              settings={settings}
            />
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
