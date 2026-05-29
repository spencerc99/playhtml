// ABOUTME: Append-only, draw-once cursor-trail animator for the live stream surfaces.
// ABOUTME: Monotonic clock — trails draw once at their absolute time, then persist and evict.

import React, { useEffect, useRef, memo } from "react";
import { TrailState } from "../types";
import { getTrailRenderer } from "../styles/trailRenderers";
import {
  TrailPath,
  TrailCursor,
  computeTrailFade,
  EVICTION_FADE_MS,
  type ImperativeTrailHandle,
  type ImperativeTrailCursorHandle,
} from "./trailPrimitives";
import {
  computeLiveTrailWindow,
  type LiveTrailTiming,
  type FinishedTrailOrderEntry,
} from "../utils/trailAnimation";

const HIDDEN_TAB_TICK_MS = 100;

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

    const trailStatesRef = useRef(trailStates);
    useEffect(() => {
      trailStatesRef.current = trailStates;
    }, [trailStates]);

    const trailHandles = useRef<Map<string, ImperativeTrailHandle>>(new Map());
    const cursorHandles = useRef<Map<string, ImperativeTrailCursorHandle>>(
      new Map(),
    );

    const originRef = useRef<{ wallMs: number; dataOriginMs: number } | null>(
      null,
    );

    // Each trail's startOffsetMs is frozen the first time we see it, keyed by
    // its stable identity. useCursorTrails recomputes timeBounds.min on every
    // batch, so the per-frame ts.startOffsetMs drifts as the upstream cap
    // evicts oldest events; pinning keeps each trail's timing basis permanent.
    const pinnedOffsets = useRef<Map<string, number>>(new Map());

    // Accumulated wall-clock time spent paused, subtracted from the elapsed
    // clock so the animation doesn't leap forward when resumed.
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
        // wall-clock duration so the clock doesn't leap on resume.
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

        let dataMin = Infinity;
        for (const ts of states) {
          if (ts.trail.startTime < dataMin) dataMin = ts.trail.startTime;
        }
        if (!isFinite(dataMin)) {
          scheduleNext();
          return;
        }
        if (originRef.current === null) {
          originRef.current = { wallMs: perfNow, dataOriginMs: dataMin };
        }
        const origin = originRef.current;
        const speed = animationSpeedRef.current;

        const globalElapsed =
          (perfNow - origin.wallMs - pausedAccumMsRef.current) * speed;
        const dataNow = origin.dataOriginMs + globalElapsed;

        // Freeze each trail's offset on first sight; use the pinned value for
        // all timing so a surviving trail's animation never jumps when
        // timeBounds.min drifts upward on eviction.
        const offsetFor = (ts: TrailState): number => {
          const key = trailKey(ts);
          let off = pinnedOffsets.current.get(key);
          if (off === undefined) {
            off = ts.startOffsetMs;
            pinnedOffsets.current.set(key, off);
          }
          return off;
        };

        const timings: LiveTrailTiming[] = states.map((ts) => ({
          startMs: origin.dataOriginMs + offsetFor(ts),
          durationMs: ts.durationMs,
        }));
        const { drawing, finished } = computeLiveTrailWindow(
          timings,
          dataNow,
          windowSize,
          EVICTION_FADE_MS,
        );

        const trailOpacity = trailOpacityRef.current;
        const strokeWidth = strokeWidthRef.current;

        const visibleKeys = new Set<string>();
        for (const idx of drawing) visibleKeys.add(trailKey(states[idx]));
        for (const idx of finished) visibleKeys.add(trailKey(states[idx]));
        for (const [key, handle] of trailHandles.current) {
          if (!visibleKeys.has(key)) {
            handle.hide();
            cursorHandles.current.get(key)?.hide();
          }
        }

        for (const idx of drawing) {
          const ts = states[idx];
          const handle = trailHandles.current.get(trailKey(ts));
          if (!handle || !ts) continue;
          // computeTrailFrame subtracts the live ts.startOffsetMs internally;
          // adding it back atop the pinned basis makes the primitive see
          // (globalElapsed - pinnedOffset), which is drift-free.
          const pinnedElapsed =
            globalElapsed - offsetFor(ts) + ts.startOffsetMs;
          const result = handle.update(
            pinnedElapsed,
            trailOpacity,
            strokeWidth,
            1,
          );
          const cursorHandle = cursorHandles.current.get(trailKey(ts));
          if (cursorHandle && result) {
            const cpIdx = Math.min(
              Math.floor((ts.trail.points.length - 1) * result.trailProgress),
              ts.trail.points.length - 1,
            );
            cursorHandle.update(
              result.cursorPosition,
              ts.trail.points[cpIdx]?.cursor,
              result.trailProgress >= 1,
              result.trailProgress,
              1,
            );
          }
        }

        const finishedEntries: FinishedTrailOrderEntry[] = finished
          .map((idx) => ({
            originalIndex: idx,
            finishedAtMs: offsetFor(states[idx]) + states[idx].durationMs,
          }))
          .sort((a, b) => a.finishedAtMs - b.finishedAtMs);

        for (let pos = 0; pos < finishedEntries.length; pos++) {
          const idx = finishedEntries[pos].originalIndex;
          const ts = states[idx];
          const key = trailKey(ts);
          const handle = trailHandles.current.get(key);
          if (!handle || !ts) continue;
          // computeTrailFade subtracts the live ts.startOffsetMs internally, so
          // pass the same pinned-basis adjustment as drawing trails.
          const pinnedElapsed =
            globalElapsed - offsetFor(ts) + ts.startOffsetMs;
          const fade = computeTrailFade(
            ts,
            pos,
            finishedEntries,
            pinnedElapsed,
            windowSize,
            finishedEntries.length,
          );
          if (fade <= 0) {
            handle.hide();
            cursorHandles.current.get(key)?.hide();
            continue;
          }
          // The finished draw always yields exactly durationMs of elapsed in
          // computeTrailFrame (ts.startOffsetMs + durationMs - ts.startOffsetMs),
          // so it renders the completed frame regardless of drift.
          handle.update(
            ts.startOffsetMs + ts.durationMs,
            trailOpacity,
            strokeWidth,
            fade,
          );
          cursorHandles.current.get(key)?.hide();
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
    }, [windowSize]);

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
