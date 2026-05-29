// ABOUTME: Low-level cursor-trail rendering primitives shared by the looping and live animators.
// ABOUTME: One trail's SVG path + cursor, the per-frame geometry, and the finished-trail fade math.

import React, { useState, useEffect, useRef, useCallback } from "react";
import { TrailState } from "../types";
import {
  getCursorComponent,
  getCursorHotspot,
  getCursorScaleFactor,
} from "../cursors";
import { type TrailRenderer } from "../styles/trailRenderers";
import {
  buildStraightPathSegment,
  type FinishedTrailOrderEntry,
} from "../utils/trailAnimation";

// How many ms to spend fading a trail out when evicted by windowSize
export const EVICTION_FADE_MS = 3000;

// Finished trails dim to this opacity over COMPLETION_FADE_MS
export const COMPLETED_OPACITY = 0.5;
export const COMPLETION_FADE_MS = 3000;

// How many points to show behind the cursor while drawing
export const TAIL_LENGTH = 1000;

// Compute visible points and path data for a trail at a given elapsed time.
export function computeTrailFrame(trailState: TrailState, elapsedTimeMs: number) {
  const { trail, startOffsetMs, durationMs, variedPoints } = trailState;

  if (trail.points.length < 2 || variedPoints.length < 2) return null;

  const trailElapsedMs = elapsedTimeMs - startOffsetMs;
  if (trailElapsedMs < 0) return null;

  const trailProgress = Math.min(1, trailElapsedMs / durationMs);
  const isFinished = trailProgress >= 1;

  const totalVariedPoints = variedPoints.length;
  const exactVariedPosition = (totalVariedPoints - 1) * trailProgress;
  const headIndex = Math.floor(exactVariedPosition);
  const headFraction = exactVariedPosition - headIndex;

  const tailStart = isFinished
    ? Math.max(0, totalVariedPoints - TAIL_LENGTH)
    : Math.max(0, headIndex - TAIL_LENGTH + 1);
  const tailEnd = Math.min(headIndex, totalVariedPoints - 1);

  let interpolatedHead: { x: number; y: number } | undefined;
  if (!isFinished && headIndex < totalVariedPoints - 1 && headFraction > 0) {
    const p1 = variedPoints[headIndex];
    const p2 = variedPoints[headIndex + 1];
    interpolatedHead = {
      x: p1.x + (p2.x - p1.x) * headFraction,
      y: p1.y + (p2.y - p1.y) * headFraction,
    };
  }

  const cursorPosition = interpolatedHead ?? variedPoints[tailEnd];

  const pointCount = tailEnd - tailStart + 1 + (interpolatedHead ? 1 : 0);
  const pathData =
    pointCount >= 2
      ? buildStraightPathSegment(
          variedPoints,
          tailStart,
          tailEnd,
          interpolatedHead,
        )
      : "";

  const currentPointIndex = Math.min(
    Math.floor((trail.points.length - 1) * trailProgress),
    trail.points.length - 1,
  );

  return {
    trailProgress,
    isFinished,
    cursorPosition,
    pathData,
    cursorType: trail.points[currentPointIndex]?.cursor,
  };
}

// Imperatively-updated trail. Renders SVG structure once on mount, then the
// parent rAF loop updates DOM attributes directly via the ref handle.
// Path and cursor are rendered as siblings (not nested) so they can live in
// separate SVG layers — paths below, cursors on top.
export interface ImperativeTrailHandle {
  update(
    elapsedTimeMs: number,
    trailOpacity: number,
    strokeWidth: number,
    evictionFade: number,
  ): { trailProgress: number; cursorPosition: { x: number; y: number } } | null;
  getGroup(): SVGGElement | null;
  hide(): void;
}

export interface TrailPathProps {
  trailState: TrailState;
  fixedMonoStrokeWidth: number;
  renderer: TrailRenderer;
}

// Renders only the trail path (no cursor). The parent rAF loop drives updates
// via the imperative handle.
export const TrailPath = React.forwardRef<ImperativeTrailHandle, TrailPathProps>(
  ({ trailState, fixedMonoStrokeWidth, renderer }, ref) => {
    const groupRef = useRef<SVGGElement>(null);
    const pathRef = useRef<SVGPathElement>(null);
    const haloRef = useRef<SVGPathElement>(null);
    const lastGroupOpacityRef = useRef("");
    const lastPathDataRef = useRef("");
    const lastRendererIdRef = useRef("");
    const lastTrailOpacityRef = useRef<number | null>(null);
    const lastStrokeWidthRef = useRef<number | null>(null);
    const lastCursorTypeRef = useRef<string | undefined>(undefined);
    const lastTrailColorRef = useRef("");
    const finishedFrameRef = useRef<ReturnType<typeof computeTrailFrame>>(null);

    useEffect(() => {
      finishedFrameRef.current = null;
      lastPathDataRef.current = "";
      lastRendererIdRef.current = "";
      lastTrailOpacityRef.current = null;
      lastStrokeWidthRef.current = null;
      lastCursorTypeRef.current = undefined;
      lastTrailColorRef.current = "";
    }, [trailState]);

    const hideTrail = useCallback(() => {
      const group = groupRef.current;
      if (group && lastGroupOpacityRef.current !== "0") {
        group.setAttribute("opacity", "0");
        lastGroupOpacityRef.current = "0";
      }
    }, []);

    React.useImperativeHandle(
      ref,
      () => ({
        hide: hideTrail,
        getGroup() {
          return groupRef.current;
        },
        update(elapsedTimeMs, trailOpacity, strokeWidth, evictionFade) {
          const group = groupRef.current;
          if (!group) return null;

          if (evictionFade <= 0) {
            hideTrail();
            return null;
          }

          const isPastEnd =
            elapsedTimeMs - trailState.startOffsetMs >= trailState.durationMs;
          let frame = isPastEnd ? finishedFrameRef.current : null;
          if (!frame) {
            frame = computeTrailFrame(trailState, elapsedTimeMs);
            if (isPastEnd) {
              finishedFrameRef.current = frame;
            }
          }

          if (!frame) {
            hideTrail();
            return null;
          }

          const groupOpacity = String(evictionFade);
          if (lastGroupOpacityRef.current !== groupOpacity) {
            group.setAttribute("opacity", groupOpacity);
            lastGroupOpacityRef.current = groupOpacity;
          }

          const { pathData, trailProgress, cursorPosition } = frame;

          const pathEl = pathRef.current;
          if (pathEl) {
            if (pathData) {
              if (
                lastPathDataRef.current !== pathData ||
                lastRendererIdRef.current !== renderer.id ||
                lastTrailOpacityRef.current !== trailOpacity ||
                lastStrokeWidthRef.current !== strokeWidth ||
                lastCursorTypeRef.current !== frame.cursorType ||
                lastTrailColorRef.current !== trailState.trail.color
              ) {
                renderer.updatePath({
                  pathEl,
                  haloEl: haloRef.current,
                  pathData,
                  trailOpacity,
                  strokeWidth,
                  cursorType: frame.cursorType,
                  trailProgress,
                  trailColor: trailState.trail.color,
                  fixedMonoStrokeWidth,
                });
                lastPathDataRef.current = pathData;
                lastRendererIdRef.current = renderer.id;
                lastTrailOpacityRef.current = trailOpacity;
                lastStrokeWidthRef.current = strokeWidth;
                lastCursorTypeRef.current = frame.cursorType;
                lastTrailColorRef.current = trailState.trail.color;
              }
            } else {
              pathEl.style.display = "none";
              if (haloRef.current) haloRef.current.style.display = "none";
              lastPathDataRef.current = "";
            }
          }

          return { trailProgress, cursorPosition };
        },
      }),
      [fixedMonoStrokeWidth, hideTrail, renderer, trailState],
    );

    const color = trailState.trail.color;

    return (
      <g ref={groupRef} opacity="0">
        <path
          ref={haloRef}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ display: "none" }}
        />
        <path
          ref={pathRef}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ display: "none" }}
        />
      </g>
    );
  },
);

export interface TrailCursorProps {
  trailState: TrailState;
  renderer: TrailRenderer;
}

// Renders only the cursor icon. Positioned imperatively by the parent rAF loop
// via the ref handle.
export interface ImperativeTrailCursorHandle {
  update(
    cursorPosition: { x: number; y: number },
    cursorType: string | undefined,
    isFinished: boolean,
    trailProgress: number,
    evictionFade: number,
  ): void;
  hide(): void;
}

export const TrailCursor = React.forwardRef<ImperativeTrailCursorHandle, TrailCursorProps>(
  ({ trailState, renderer }, ref) => {
    const cursorGroupRef = useRef<SVGGElement>(null);
    const cursorVisibleRef = useRef(false);
    const lastTransformRef = useRef("");

    const [cursorType, setCursorType] = useState<string | undefined>(
      trailState.trail.points[0]?.cursor,
    );
    const CursorComponent = getCursorComponent(cursorType);
    const cursorSize = 32;

    const hideCursor = useCallback(() => {
      const cursorGroup = cursorGroupRef.current;
      if (cursorGroup && cursorVisibleRef.current) {
        cursorGroup.style.display = "none";
        cursorVisibleRef.current = false;
      }
    }, []);

    React.useImperativeHandle(ref, () => ({
      hide: hideCursor,
      update(cursorPosition, newCursorType, isFinished, trailProgress, evictionFade) {
        const cursorGroup = cursorGroupRef.current;
        if (!cursorGroup) return;

        if (evictionFade <= 0 || isFinished || trailProgress <= 0) {
          hideCursor();
          return;
        }

        if (!cursorVisibleRef.current) {
          cursorGroup.style.display = "";
          cursorVisibleRef.current = true;
        }

        const transform = `translate(${cursorPosition.x}, ${cursorPosition.y})`;
        if (lastTransformRef.current !== transform) {
          cursorGroup.setAttribute("transform", transform);
          lastTransformRef.current = transform;
        }

        if (newCursorType !== cursorType) {
          setCursorType(newCursorType);
        }
      },
    }), [cursorType, hideCursor]);

    const color = renderer.getCursorColor(trailState.trail.color, cursorType);

    // Position the cursor so its hotspot lands at (0,0) — the cursorGroup's
    // translate then puts that hotspot exactly on the trail head.
    // Each cursor draws its path at a natural unit scale; the effective
    // scale applied to the path is (cursorSize / 24) * cursorScaleFactor.
    const hotspot = getCursorHotspot(cursorType);
    const cursorScaleFactor = getCursorScaleFactor(cursorType);
    const effectiveScale = (cursorSize / 24) * cursorScaleFactor;
    const hotspotOffsetX = -hotspot.x * effectiveScale;
    const hotspotOffsetY = -hotspot.y * effectiveScale;

    return (
      <g ref={cursorGroupRef} style={{ display: "none" }}>
        <g transform={`translate(${hotspotOffsetX}, ${hotspotOffsetY})`}>
          <CursorComponent color={color} size={cursorSize} />
        </g>
      </g>
    );
  },
);

export function computeTrailFade(
  trailState: TrailState,
  finishPosition: number,
  sortedFinishOrder: FinishedTrailOrderEntry[],
  elapsedTimeMs: number,
  windowSize: number,
  finishedCount: number,
): number {
  const trailElapsedMs = elapsedTimeMs - trailState.startOffsetMs;
  if (trailElapsedMs < 0) return 0;

  const trailProgress = Math.min(1, trailElapsedMs / trailState.durationMs);
  if (trailProgress < 1) return 1;

  const excessCount = Math.max(0, finishedCount - windowSize);
  if (finishPosition < excessCount) {
    const displacerIndex = finishPosition + windowSize;
    const evictedAtMs =
      displacerIndex < finishedCount
        ? sortedFinishOrder[displacerIndex].finishedAtMs
        : elapsedTimeMs;
    const timeSinceEvicted = elapsedTimeMs - evictedAtMs;
    return Math.max(
      0,
      COMPLETED_OPACITY * (1 - timeSinceEvicted / EVICTION_FADE_MS),
    );
  }

  const finishedAtMs = trailState.startOffsetMs + trailState.durationMs;
  const timeSinceFinished = elapsedTimeMs - finishedAtMs;
  const fadeFraction = Math.min(1, timeSinceFinished / COMPLETION_FADE_MS);
  return 1 - fadeFraction * (1 - COMPLETED_OPACITY);
}
