// ABOUTME: Live cursor-trail animator. Renders the current trail set directly
// ABOUTME: (id-keyed, React owns add/remove/grow); the rAF loop draws each trail
// ABOUTME: by its own progress since first seen. No snapshot/eviction state.

import React, { useEffect, useRef, useState, memo } from "react";
import { TrailState } from "../types";
import { getTrailRenderer } from "../styles/trailRenderers";
import {
  TrailPath,
  TrailCursor,
  COMPLETED_OPACITY,
  EVICTION_FADE_MS,
  type ImperativeTrailHandle,
  type ImperativeTrailCursorHandle,
} from "./trailPrimitives";

const HIDDEN_TAB_TICK_MS = 100;

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
  /** Called with trail ids once they have fully faded out and been removed, so
   * the owner can free their accumulated events. */
  onTrailsRemoved?: (ids: string[]) => void;
  settings: {
    strokeWidth: number;
    trailOpacity: number;
    animationSpeed: number;
    trailVisualStyle?: string;
  };
}

export const LiveTrails: React.FC<LiveTrailsProps> = memo(
  ({ trailStates, frozen = false, onTrailsRemoved, settings }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const pathLayerRef = useRef<SVGGElement>(null);
    const animationRef = useRef<number | undefined>(undefined);
    const timeoutRef = useRef<number | undefined>(undefined);

    const renderer = getTrailRenderer(settings.trailVisualStyle ?? "color");

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
      if (removedIdsRef.current.length > 0) {
        const ids = removedIdsRef.current;
        removedIdsRef.current = [];
        onRemovedRef.current?.(ids);
      }
    }, [kept]);

    // Reconcile `kept` with the latest live trails. Runs on every trailStates
    // change (live data changes frequently, so this also drives depart expiry).
    useEffect(() => {
      const now = performance.now();
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
        const now = performance.now();
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
            }
          }
          return changed ? next : prev;
        });
      }, 1000);
      return () => window.clearInterval(id);
    }, []);

    // Per-trail imperative handles, keyed by stable trail id.
    const trailHandles = useRef<Map<string, ImperativeTrailHandle>>(new Map());
    const cursorHandles = useRef<Map<string, ImperativeTrailCursorHandle>>(
      new Map(),
    );

    // Accumulated paused wall-clock, subtracted from the clock so trails don't
    // leap when resumed.
    const pausedAccumMsRef = useRef(0);
    const pauseStartedAtRef = useRef<number | null>(null);

    useEffect(() => {
      const clearScheduled = () => {
        if (animationRef.current !== undefined) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = undefined;
        }
        if (timeoutRef.current !== undefined) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = undefined;
        }
      };

      const scheduleNext = () => {
        clearScheduled();
        if (document.visibilityState === "hidden") {
          timeoutRef.current = window.setTimeout(
            () => tick(performance.now()),
            HIDDEN_TAB_TICK_MS,
          );
          return;
        }
        animationRef.current = requestAnimationFrame(tick);
      };

      const tick = (perfNow: number) => {
        try {
          runFrame(perfNow);
        } catch (err) {
          console.warn("[LiveTrails] frame error:", err);
        }
        scheduleNext();
      };

      const runFrame = (perfNow: number) => {
        if (frozenRef.current) {
          if (pauseStartedAtRef.current === null) {
            pauseStartedAtRef.current = perfNow;
          }
          return;
        }
        if (pauseStartedAtRef.current !== null) {
          pausedAccumMsRef.current += perfNow - pauseStartedAtRef.current;
          pauseStartedAtRef.current = null;
        }

        const entries = keptRef.current;
        const clockMs = perfNow - pausedAccumMsRef.current;
        const trailOpacity = trailOpacityRef.current;
        const strokeWidth = strokeWidthRef.current;
        const drawMap = drawRef.current;

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
              1 - (perfNow - entry.departedAt) / KEEP_AFTER_DEPART_MS,
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
