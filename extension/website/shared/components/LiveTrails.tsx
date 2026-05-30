// ABOUTME: Draw-on-arrival cursor-trail animator for the live stream surfaces.
// ABOUTME: Snapshots each trail on first sight and owns its lifecycle, immune to upstream re-derivation churn.

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

// A trail draws over its own real duration (endTime - startTime), clamped so
// a momentary flick is still perceptible and a long idle span doesn't take
// minutes. Median real duration is ~3s; the tail runs to a minute-plus.
const MIN_DRAW_MS = 800;
const MAX_DRAW_MS = 8000;

// Trails captured in the same tick (one WebSocket batch) are staggered so they
// trickle in rather than all bursting at once.
const STAGGER_STEP_MS = 350;
const MAX_STAGGER_MS = 4000;

// How much further each rank beyond the keep-window fades a finished trail.
const EVICTION_RANK_STEP_MS = 625;

/** Coarse identity used only to detect whether we've already snapshotted a
 * trail. Because LiveTrails freezes the trail's geometry on first sight, an
 * imperfect key (a re-derived trail occasionally captured twice) is harmless —
 * it never causes the flashing that a render-key change would. Start time +
 * first point is stable enough that the common case is one snapshot per trail. */
function trailKey(ts: TrailState): string {
  const p0 = ts.trail.points[0];
  return `${ts.trail.startTime}:${p0?.x ?? 0}:${p0?.y ?? 0}`;
}

/** Tiny deterministic hash of a string to a small int, for per-trail variation. */
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Per-trail draw duration: its real span, clamped to a perceptible range. */
function drawDurationFor(ts: { durationMs: number }, speed: number): number {
  const scaled = ts.durationMs / (speed || 1);
  return Math.min(MAX_DRAW_MS, Math.max(MIN_DRAW_MS, scaled));
}

/** A trail LiveTrails has captured and now owns. The frozen `trail` snapshot
 * is never replaced by later re-derivations of the same logical trail. */
interface Snapshot {
  key: string;
  trail: TrailState;
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

    // Snapshots are the trails LiveTrails owns and renders. They are added when
    // a new trail key first appears in `trailStates` and removed when eviction
    // fully fades them. React state so the render reflects the owned set; a ref
    // mirror lets the rAF loop read it without restarting.
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const snapshotsRef = useRef<Snapshot[]>(snapshots);
    useEffect(() => {
      snapshotsRef.current = snapshots;
    }, [snapshots]);

    const seenKeysRef = useRef<Set<string>>(new Set());
    const orderCounterRef = useRef(0);

    const trailHandles = useRef<Map<string, ImperativeTrailHandle>>(new Map());
    const cursorHandles = useRef<Map<string, ImperativeTrailCursorHandle>>(
      new Map(),
    );

    // Accumulated wall-clock time spent paused, subtracted from the draw clock
    // so trails don't leap forward when resumed.
    const pausedAccumMsRef = useRef(0);
    const pauseStartedAtRef = useRef<number | null>(null);

    // Capture newly-arrived trails into the owned snapshot set. Existing keys
    // are ignored — their frozen snapshot is kept, so upstream re-derivation
    // (which shifts trail boundaries as the event window slides) can never
    // change or unmount a trail that's already on screen.
    useEffect(() => {
      if (trailStates.length === 0) return;
      const fresh: Snapshot[] = [];
      let batchIndex = 0;
      const now =
        typeof performance !== "undefined" ? performance.now() : 0;
      for (const ts of trailStates) {
        const key = trailKey(ts);
        if (seenKeysRef.current.has(key)) continue;
        seenKeysRef.current.add(key);
        const stagger = Math.min(MAX_STAGGER_MS, batchIndex * STAGGER_STEP_MS);
        fresh.push({
          key,
          trail: ts,
          seenAtMs: now + stagger,
          order: orderCounterRef.current++,
        });
        batchIndex++;
      }
      if (fresh.length > 0) {
        setSnapshots((prev) => [...prev, ...fresh]);
      }
    }, [trailStates]);

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

        const owned = snapshotsRef.current;
        if (owned.length === 0) {
          scheduleNext();
          return;
        }

        const clockMs = perfNow - pausedAccumMsRef.current;
        const speed = animationSpeedRef.current;
        const trailOpacity = trailOpacityRef.current;
        const strokeWidth = strokeWidthRef.current;
        const size = windowSizeRef.current;

        // Keep the most-recently-arrived `size` snapshots fully visible; older
        // ones fade by arrival order.
        const orders = owned.map((s) => s.order).sort((a, b) => a - b);
        const keepFromOrder =
          orders.length > size ? orders[orders.length - size] : -Infinity;

        const evictedKeys: string[] = [];

        for (const snap of owned) {
          const { key, trail: ts } = snap;
          const handle = trailHandles.current.get(key);
          const cursorHandle = cursorHandles.current.get(key);
          if (!handle) continue;

          // Negative until a staggered trail's start arrives — keep it hidden
          // until then so it eases in rather than popping mid-draw.
          const drawElapsed = clockMs - snap.seenAtMs;
          if (drawElapsed < 0) {
            handle.hide();
            cursorHandle?.hide();
            continue;
          }
          const drawDuration = drawDurationFor(ts, speed);
          const progress = Math.min(1, drawElapsed / drawDuration);
          const isFinished = progress >= 1;

          // Eviction fade for trails older than the keep window.
          let evictionFade = 1;
          if (snap.order < keepFromOrder) {
            const overflowRank = keepFromOrder - snap.order;
            const fadeProgress = Math.min(
              1,
              (overflowRank * EVICTION_RANK_STEP_MS) / EVICTION_FADE_MS,
            );
            evictionFade = Math.max(0, 1 - fadeProgress);
          }

          if (evictionFade <= 0) {
            handle.hide();
            cursorHandle?.hide();
            evictedKeys.push(key);
            continue;
          }

          // Drawing trails render at full opacity; finished trails dim to
          // COMPLETED_OPACITY and persist. Eviction fade multiplies on top.
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

        // Remove fully-evicted snapshots from the owned set (and forget their
        // keys so an identical trail could re-appear later).
        if (evictedKeys.length > 0) {
          for (const key of evictedKeys) seenKeysRef.current.delete(key);
          const drop = new Set(evictedKeys);
          setSnapshots((prev) => prev.filter((s) => !drop.has(s.key)));
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
          {snapshots.map((snap) => (
            <TrailPath
              key={`live-path-${snap.key}`}
              ref={(handle) => {
                if (handle) trailHandles.current.set(snap.key, handle);
                else trailHandles.current.delete(snap.key);
              }}
              trailState={snap.trail}
              fixedMonoStrokeWidth={1 + (hashKey(snap.key) % 5)}
              renderer={renderer}
            />
          ))}
        </g>
        {snapshots.map((snap) => (
          <TrailCursor
            key={`live-cursor-${snap.key}`}
            ref={(handle) => {
              if (handle) cursorHandles.current.set(snap.key, handle);
              else cursorHandles.current.delete(snap.key);
            }}
            trailState={snap.trail}
            renderer={renderer}
          />
        ))}
      </svg>
    );
  },
);
