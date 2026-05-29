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
  settings: {
    strokeWidth: number;
    trailOpacity: number;
    animationSpeed: number;
    trailVisualStyle?: string;
  };
}

export const LiveTrails: React.FC<LiveTrailsProps> = memo(
  ({ trailStates, windowSize = 50, settings }) => {
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

        const globalElapsed = (perfNow - origin.wallMs) * speed;
        const dataNow = origin.dataOriginMs + globalElapsed;

        const timings: LiveTrailTiming[] = states.map((ts) => ({
          startMs: origin.dataOriginMs + ts.startOffsetMs,
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
          const result = handle.update(globalElapsed, trailOpacity, strokeWidth, 1);
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
            finishedAtMs: states[idx].startOffsetMs + states[idx].durationMs,
          }))
          .sort((a, b) => a.finishedAtMs - b.finishedAtMs);

        for (let pos = 0; pos < finishedEntries.length; pos++) {
          const idx = finishedEntries[pos].originalIndex;
          const ts = states[idx];
          const key = trailKey(ts);
          const handle = trailHandles.current.get(key);
          if (!handle || !ts) continue;
          const fade = computeTrailFade(
            ts,
            pos,
            finishedEntries,
            globalElapsed,
            windowSize,
            finishedEntries.length,
          );
          if (fade <= 0) {
            handle.hide();
            cursorHandles.current.get(key)?.hide();
            continue;
          }
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
