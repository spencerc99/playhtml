// ABOUTME: Draw-on-arrival cursor-trail animator for the live stream surfaces.
// ABOUTME: Each new trail draws once when first seen, then dims and persists; oldest evict when crowded.

import React, { useEffect, useRef, memo } from "react";
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

// A trail draws over its own real duration (endTime - startTime), clamped so
// a momentary flick is still perceptible and a long idle span doesn't take
// minutes. Median real duration is ~3s; the tail runs to a minute-plus.
const MIN_DRAW_MS = 800;
const MAX_DRAW_MS = 8000;

// Trails arriving in the same WebSocket batch are staggered so they trickle in
// rather than all bursting at once. Each newly-seen trail in a tick starts this
// much later than the previous one, capped so a big batch doesn't delay tails
// for too long.
const STAGGER_STEP_MS = 350;
const MAX_STAGGER_MS = 4000;

// How much further each rank beyond the keep-window fades a finished trail.
const EVICTION_RANK_STEP_MS = 625;

/** Per-trail draw duration: its real span, clamped to a perceptible range. */
function drawDurationFor(ts: { durationMs: number }, speed: number): number {
  const scaled = ts.durationMs / (speed || 1);
  return Math.min(MAX_DRAW_MS, Math.max(MIN_DRAW_MS, scaled));
}

/** Stable identity for a trail, robust to the events array dropping from the
 * front (the upstream cap slices oldest-first, which shifts positional index). */
function trailKey(ts: TrailState): string {
  const p0 = ts.trail.points[0];
  return `${ts.trail.startTime}:${ts.trail.endTime}:${p0?.x ?? 0}:${p0?.y ?? 0}`;
}

/** Tiny deterministic hash of a string to a small int, for per-trail variation. */
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Per-trail arrival bookkeeping. `seenAtMs` is the wall-clock time the trail
 * first appeared; `order` is a monotonic arrival counter used for eviction. */
interface ArrivalInfo {
  seenAtMs: number;
  order: number;
}

interface LiveTrailsProps {
  trailStates: TrailState[];
  windowSize?: number;
  frozen?: boolean;
  settings: {
    strokeWidth: number;
    trailOpacity: number;
    animationSpeed: number;
    trailVisualStyle?: string;
  };
}

export const LiveTrails: React.FC<LiveTrailsProps> = memo(
  ({ trailStates, windowSize = 50, frozen = false, settings }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const pathLayerRef = useRef<SVGGElement>(null);
    const animationRef = useRef<number | undefined>(undefined);
    const timeoutRef = useRef<number | undefined>(undefined);

    const renderer = getTrailRenderer(settings.trailVisualStyle ?? "color");

    const strokeWidthRef = useRef(settings.strokeWidth);
    const trailOpacityRef = useRef(settings.trailOpacity);
    const animationSpeedRef = useRef(settings.animationSpeed);
    useEffect(() => {
      strokeWidthRef.current = settings.strokeWidth;
      trailOpacityRef.current = settings.trailOpacity;
      animationSpeedRef.current = settings.animationSpeed;
    }, [settings.strokeWidth, settings.trailOpacity, settings.animationSpeed]);

    const frozenRef = useRef(frozen);
    useEffect(() => {
      frozenRef.current = frozen;
    }, [frozen]);

    const windowSizeRef = useRef(windowSize);
    useEffect(() => {
      windowSizeRef.current = windowSize;
    }, [windowSize]);

    const trailStatesRef = useRef(trailStates);
    useEffect(() => {
      trailStatesRef.current = trailStates;
    }, [trailStates]);

    const trailHandles = useRef<Map<string, ImperativeTrailHandle>>(new Map());
    const cursorHandles = useRef<Map<string, ImperativeTrailCursorHandle>>(
      new Map(),
    );

    // Arrival time + order per trail key. A trail draws over its own real
    // (clamped) duration starting from when it first appeared in the data —
    // NOT from its real event timestamp. This is the "draw on arrival" model.
    const arrivals = useRef<Map<string, ArrivalInfo>>(new Map());
    const arrivalCounterRef = useRef(0);

    // Accumulated wall-clock time spent paused. Subtracted from the draw clock
    // so trails don't leap forward when resumed.
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
        // When paused, hold the last drawn frame and accumulate the paused
        // wall-clock duration so the draw clock doesn't leap on resume.
        if (frozenRef.current) {
          if (pauseStartedAtRef.current === null) {
            pauseStartedAtRef.current = perfNow;
          }
          scheduleNext();
          return;
        }
        if (pauseStartedAtRef.current !== null) {
          pausedAccumMsRef.current += perfNow - pauseStartedAtRef.current;
          pauseStartedAtRef.current = null;
        }

        const states = trailStatesRef.current;
        if (states.length === 0) {
          scheduleNext();
          return;
        }

        // Wall clock with paused time removed; speed scales draw rate.
        const clockMs = perfNow - pausedAccumMsRef.current;
        const speed = animationSpeedRef.current;
        const trailOpacity = trailOpacityRef.current;
        const strokeWidth = strokeWidthRef.current;
        const size = windowSizeRef.current;

        // Register arrivals for any trail key we haven't seen yet. Trails that
        // first appear in the same tick (one WebSocket batch) are staggered:
        // each is given a slightly later draw-start so they trickle in rather
        // than bursting all at once. The stagger is capped per batch.
        const presentKeys = new Set<string>();
        let batchIndex = 0;
        for (const ts of states) {
          const key = trailKey(ts);
          presentKeys.add(key);
          if (!arrivals.current.has(key)) {
            const stagger = Math.min(
              MAX_STAGGER_MS,
              batchIndex * STAGGER_STEP_MS,
            );
            arrivals.current.set(key, {
              seenAtMs: clockMs + stagger,
              order: arrivalCounterRef.current++,
            });
            batchIndex++;
          }
        }
        // Prune arrival records for keys no longer present (the upstream cap
        // dropped them) so the Map can't grow unbounded.
        for (const key of arrivals.current.keys()) {
          if (!presentKeys.has(key)) arrivals.current.delete(key);
        }

        // Eviction: keep the most-recently-arrived `size` trails fully visible.
        // Older ones fade out over EVICTION_FADE_MS by arrival order. The
        // cutoff is the arrival `order` of the newest trail that should still
        // be fully visible; anything older fades based on how far past it is.
        const orders = [...arrivals.current.values()]
          .map((a) => a.order)
          .sort((a, b) => a - b);
        const keepFromOrder =
          orders.length > size ? orders[orders.length - size] : -Infinity;

        for (const ts of states) {
          const key = trailKey(ts);
          const handle = trailHandles.current.get(key);
          const cursorHandle = cursorHandles.current.get(key);
          if (!handle) continue;

          const info = arrivals.current.get(key)!;
          // Negative until a staggered trail's start time arrives — keep it
          // hidden until then so it eases in rather than popping mid-draw.
          const drawElapsed = clockMs - info.seenAtMs;
          if (drawElapsed < 0) {
            handle.hide();
            cursorHandle?.hide();
            continue;
          }
          const drawDuration = drawDurationFor(ts, speed);
          const progress = Math.min(1, drawElapsed / drawDuration);
          const isFinished = progress >= 1;

          // Eviction fade for trails older than the keep window. Each rank
          // past the cutoff fades the trail further, so the very oldest
          // disappear first over EVICTION_FADE_MS.
          let evictionFade = 1;
          if (info.order < keepFromOrder) {
            const overflowRank = keepFromOrder - info.order;
            const fadeProgress = Math.min(
              1,
              (overflowRank * EVICTION_RANK_STEP_MS) / EVICTION_FADE_MS,
            );
            evictionFade = Math.max(0, 1 - fadeProgress);
          }

          if (evictionFade <= 0) {
            handle.hide();
            cursorHandle?.hide();
            continue;
          }

          // Finished trails dim to COMPLETED_OPACITY and persist; drawing
          // trails render at full opacity. The group opacity carries the
          // eviction fade on top of that.
          const baseOpacity = isFinished ? COMPLETED_OPACITY : 1;
          const groupFade = baseOpacity * evictionFade;

          // Drive computeTrailFrame by our arrival progress: passing
          // (progress*durationMs + startOffsetMs) makes the primitive compute
          // exactly progress*durationMs of trail elapsed (startOffsetMs cancels).
          const frameElapsed = progress * ts.durationMs + ts.startOffsetMs;
          const result = handle.update(
            frameElapsed,
            trailOpacity,
            strokeWidth,
            groupFade,
          );

          if (cursorHandle && result && !isFinished) {
            const cpIdx = Math.min(
              Math.floor((ts.trail.points.length - 1) * result.trailProgress),
              ts.trail.points.length - 1,
            );
            cursorHandle.update(
              result.cursorPosition,
              ts.trail.points[cpIdx]?.cursor,
              result.trailProgress >= 1,
              result.trailProgress,
              groupFade,
            );
          } else {
            cursorHandle?.hide();
          }
        }

        scheduleNext();
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
          {trailStates.map((ts) => {
            const key = trailKey(ts);
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
        {trailStates.map((ts) => {
          const key = trailKey(ts);
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
