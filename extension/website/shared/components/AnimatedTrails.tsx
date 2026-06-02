// ABOUTME: Animated trails visualization component with imperative animation loop
// ABOUTME: Handles trail rendering, click effects, and animation timing without per-frame React re-renders
import React, {
  useState,
  useEffect,
  useRef,
  memo,
  useCallback,
  useMemo,
} from "react";
import { TrailState, ClickEffect } from "../types";
import {
  getCursorComponent,
  getCursorHotspot,
  getCursorScaleFactor,
} from "../cursors";
import { RippleEffect } from "./ClickRipple";
import { useDebugHover } from "./DebugHover";
import type { SoundEngine } from "../sound/SoundEngine";
import type { TrailSoundFrame } from "../sound/types";
import { getTrailRenderer, type TrailRenderer } from "../styles/trailRenderers";
import {
  buildStraightPathSegment,
  getFinishedTrailRenderRange,
  type FinishedTrailOrderEntry,
} from "../utils/trailAnimation";

// How many ms to spend fading a trail out when evicted by windowSize
const EVICTION_FADE_MS = 3000;

// Finished trails dim to this opacity over COMPLETION_FADE_MS
const COMPLETED_OPACITY = 0.5;
const COMPLETION_FADE_MS = 3000;
// Hidden tabs heavily throttle rAF; 100ms (~10fps) keeps audio/time progression
// alive without spending too much background CPU.
const HIDDEN_TAB_TICK_MS = 100;

// How many points to show behind the cursor while drawing
const TAIL_LENGTH = 1000;

// Compute visible points and path data for a trail at a given elapsed time.
function computeTrailFrame(trailState: TrailState, elapsedTimeMs: number) {
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
interface ImperativeTrailHandle {
  update(
    elapsedTimeMs: number,
    trailOpacity: number,
    strokeWidth: number,
    evictionFade: number,
  ): { trailProgress: number; cursorPosition: { x: number; y: number } } | null;
  getGroup(): SVGGElement | null;
  hide(): void;
}

interface TrailPathProps {
  trailState: TrailState;
  fixedMonoStrokeWidth: number;
  renderer: TrailRenderer;
}

// Renders only the trail path (no cursor). The parent rAF loop drives updates
// via the imperative handle.
const TrailPath = React.forwardRef<ImperativeTrailHandle, TrailPathProps>(
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

interface TrailCursorProps {
  trailState: TrailState;
  renderer: TrailRenderer;
}

// Renders only the cursor icon. Positioned imperatively by the parent rAF loop
// via the ref handle.
interface ImperativeTrailCursorHandle {
  update(
    cursorPosition: { x: number; y: number },
    cursorType: string | undefined,
    isFinished: boolean,
    trailProgress: number,
    evictionFade: number,
  ): void;
  hide(): void;
}

const TrailCursor = React.forwardRef<ImperativeTrailCursorHandle, TrailCursorProps>(
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

function computeTrailFade(
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

interface AnimatedTrailsProps {
  trailStates: TrailState[];
  timeRange: { min: number; max: number; duration: number };
  showClickRipples?: boolean;
  frozen?: boolean;
  windowSize?: number;
  // When true, trail coordinates are in document space. The SVG viewBox is
  // updated each animation frame to track window.scrollX/scrollY so trails
  // appear glued to the page rather than to the fixed viewport. The overlay
  // container must be position: fixed when using this mode.
  documentSpace?: boolean;
  soundEngine?: SoundEngine | null;
  settings: {
    strokeWidth: number;
    trailOpacity: number;
    animationSpeed: number;
    clickMinRadius: number;
    clickMaxRadius: number;
    clickCoreRadius: number;
    clickMinDuration: number;
    clickMaxDuration: number;
    clickExpansionDuration: number;
    clickStrokeWidth: number;
    clickOpacity: number;
    clickNumRings: number;
    clickRingDelayMs: number;
    clickAnimationStopPoint: number;
    trailVisualStyle?: string;
  };
}

export const AnimatedTrails: React.FC<AnimatedTrailsProps> = memo(
  ({
    trailStates,
    timeRange,
    showClickRipples = true,
    frozen = false,
    windowSize = 50,
    documentSpace = false,
    soundEngine = null,
    settings,
  }) => {
    const [activeClickEffects, setActiveClickEffects] = useState<ClickEffect[]>(
      [],
    );

    const animationRef = useRef<number | undefined>(undefined);
    const timeoutRef = useRef<number | undefined>(undefined);
    const svgRef = useRef<SVGSVGElement>(null);
    const pathLayerRef = useRef<SVGGElement>(null);

    const renderer = getTrailRenderer(settings.trailVisualStyle ?? "color");
    const rendererRef = useRef(renderer);
    useEffect(() => { rendererRef.current = renderer; }, [renderer]);

    // Settings refs — updated without re-render
    const animationSpeedRef = useRef(settings.animationSpeed);
    const strokeWidthRef = useRef(settings.strokeWidth);
    const trailOpacityRef = useRef(settings.trailOpacity);

    useEffect(() => {
      animationSpeedRef.current = settings.animationSpeed;
      strokeWidthRef.current = settings.strokeWidth;
      trailOpacityRef.current = settings.trailOpacity;
    }, [settings.animationSpeed, settings.strokeWidth, settings.trailOpacity]);

    // Pre-sort finished trails once per trailStates change
    const sortedFinishOrder = useMemo(() => {
      return trailStates
        .map((ts, i) => ({
          originalIndex: i,
          finishedAtMs: ts.startOffsetMs + ts.durationMs,
        }))
        .sort((a, b) => a.finishedAtMs - b.finishedAtMs);
    }, [trailStates]);

    const finishPositionByTrail = useMemo(() => {
      const positions = new Int32Array(trailStates.length);
      sortedFinishOrder.forEach((entry, position) => {
        positions[entry.originalIndex] = position;
      });
      return positions;
    }, [sortedFinishOrder, trailStates.length]);

    const sortedStartOrder = useMemo(() => {
      return trailStates
        .map((ts, i) => ({
          originalIndex: i,
          startOffsetMs: ts.startOffsetMs,
          finishedAtMs: ts.startOffsetMs + ts.durationMs,
        }))
        .sort((a, b) => a.startOffsetMs - b.startOffsetMs);
    }, [trailStates]);

    // Store one ref handle per trail index for paths and cursors separately.
    const trailHandles = useRef<(ImperativeTrailHandle | null)[]>(
      new Array(trailStates.length).fill(null),
    );
    const cursorHandles = useRef<(ImperativeTrailCursorHandle | null)[]>(
      new Array(trailStates.length).fill(null),
    );

    // Click batching
    const pendingClicks = useRef<ClickEffect[]>([]);
    const flushClicksScheduled = useRef(false);

    const scheduleFlushClicks = useCallback(() => {
      if (flushClicksScheduled.current) return;
      flushClicksScheduled.current = true;
      queueMicrotask(() => {
        flushClicksScheduled.current = false;
        const clicks = pendingClicks.current;
        if (clicks.length === 0) return;
        pendingClicks.current = [];
        setActiveClickEffects((prev) => [...prev, ...clicks]);
      });
    }, []);

    // Loop wrap detection
    const prevElapsedRef = useRef(0);

    // Refs the rAF loop reads (kept current via effects)
    const trailStatesRef = useRef(trailStates);
    const sortedFinishOrderRef = useRef(sortedFinishOrder);
    const finishPositionByTrailRef = useRef(finishPositionByTrail);
    const sortedStartOrderRef = useRef(sortedStartOrder);
    const windowSizeRef = useRef(windowSize);
    const showClickRipplesRef = useRef(showClickRipples);
    const documentSpaceRef = useRef(documentSpace);
    const soundEngineRef = useRef(soundEngine);

    useEffect(() => {
      soundEngineRef.current = soundEngine;
    }, [soundEngine]);
    useEffect(() => {
      trailStatesRef.current = trailStates;
    }, [trailStates]);
    useEffect(() => {
      sortedFinishOrderRef.current = sortedFinishOrder;
    }, [sortedFinishOrder]);
    useEffect(() => {
      finishPositionByTrailRef.current = finishPositionByTrail;
    }, [finishPositionByTrail]);
    useEffect(() => {
      sortedStartOrderRef.current = sortedStartOrder;
    }, [sortedStartOrder]);
    useEffect(() => {
      windowSizeRef.current = windowSize;
    }, [windowSize]);
    useEffect(() => {
      showClickRipplesRef.current = showClickRipples;
    }, [showClickRipples]);
    useEffect(() => {
      documentSpaceRef.current = documentSpace;
    }, [documentSpace]);

    // Track which trail indices are currently visible, for ripple pruning.
    // Updated from rAF loop but only triggers a React re-render for ripple cleanup.
    const visibleSetRef = useRef<Set<number>>(new Set());
    const ripplePruneScheduled = useRef(false);
    const activeTrailIndicesRef = useRef<number[]>([]);
    const nextStartOrderIndexRef = useRef(0);
    const visibleMarksRef = useRef(new Uint32Array(trailStates.length));
    const visibleFrameIdRef = useRef(1);
    const visibleIndicesScratchRef = useRef<number[]>([]);
    const previousVisibleIndicesRef = useRef<number[]>([]);
    const nextClickIndexByTrailRef = useRef(new Int32Array(trailStates.length));
    const soundFramesRef = useRef<TrailSoundFrame[]>([]);
    const activePaintOrderIndicesRef = useRef<number[]>([]);
    const previousActivePaintOrderIndicesRef = useRef<number[]>([]);

    useEffect(() => {
      visibleMarksRef.current = new Uint32Array(trailStates.length);
      nextClickIndexByTrailRef.current = new Int32Array(trailStates.length);
      activeTrailIndicesRef.current = [];
      visibleIndicesScratchRef.current = [];
      previousVisibleIndicesRef.current = [];
      activePaintOrderIndicesRef.current = [];
      previousActivePaintOrderIndicesRef.current = [];
      nextStartOrderIndexRef.current = 0;
    }, [trailStates]);

    const scheduleRipplePrune = useCallback(() => {
      if (ripplePruneScheduled.current) return;
      ripplePruneScheduled.current = true;
      queueMicrotask(() => {
        ripplePruneScheduled.current = false;
        const visible = visibleSetRef.current;
        setActiveClickEffects((prev) => {
          const pruned = prev.filter((e) => visible.has(e.trailIndex));
          return pruned.length === prev.length ? prev : pruned;
        });
      });
    }, []);

    // The animation loop — pure imperative, no per-frame setState
    useEffect(() => {
      if (frozen) {
        // Frozen: update all trails once at full progress
        requestAnimationFrame(() => {
          if (documentSpaceRef.current && svgRef.current) {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            svgRef.current.setAttribute(
              "viewBox",
              `${window.scrollX} ${window.scrollY} ${vw} ${vh}`,
            );
          }
          const elapsed = timeRange.duration;
          for (let i = 0; i < trailStatesRef.current.length; i++) {
            const handle = trailHandles.current[i];
            handle?.update(
              elapsed,
              trailOpacityRef.current,
              strokeWidthRef.current,
              1,
            );
          }
        });
        return;
      }

      if (trailStates.length === 0) return;

      // Reset per-loop state so stale prevElapsed from a previous loop doesn't
      // look like a wrap and trigger a mass re-spawn of all clicks at once.
      prevElapsedRef.current = 0;
      nextClickIndexByTrailRef.current.fill(0);
      activeTrailIndicesRef.current = [];
      nextStartOrderIndexRef.current = 0;
      setActiveClickEffects([]);
      soundEngineRef.current?.reset();

      let startTime: number | null = null;

      const resetPlaybackTrackers = () => {
        activeTrailIndicesRef.current = [];
        nextStartOrderIndexRef.current = 0;
        nextClickIndexByTrailRef.current.fill(0);
      };

      const clearScheduledFrame = () => {
        if (animationRef.current !== undefined) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = undefined;
        }
        if (timeoutRef.current !== undefined) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = undefined;
        }
      };

      const scheduleNextFrame = () => {
        clearScheduledFrame();
        if (document.visibilityState === "hidden") {
          timeoutRef.current = window.setTimeout(
            () => animate(performance.now()),
            HIDDEN_TAB_TICK_MS,
          );
          return;
        }
        animationRef.current = requestAnimationFrame(animate);
      };

      const animate = (timestamp: number) => {
        if (startTime === null) startTime = timestamp;

        // In document space mode, shift the SVG viewBox to match the current
        // scroll position so trails appear glued to the page rather than to
        // the fixed viewport. Done imperatively here to avoid re-renders.
        if (documentSpaceRef.current && svgRef.current) {
          const scrollX = window.scrollX;
          const scrollY = window.scrollY;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          svgRef.current.setAttribute(
            "viewBox",
            `${scrollX} ${scrollY} ${vw} ${vh}`,
          );
        }

        const realElapsed = timestamp - startTime;
        const scaledElapsed = realElapsed * animationSpeedRef.current;
        const loopedElapsed = scaledElapsed % timeRange.duration;

        // Detect loop wrap
        if (loopedElapsed < prevElapsedRef.current) {
          resetPlaybackTrackers();
          setActiveClickEffects([]);
          soundEngineRef.current?.reset();
        }
        prevElapsedRef.current = loopedElapsed;

        const currentTrailStates = trailStatesRef.current;
        const trailOpacity = trailOpacityRef.current;
        const strokeWidth = strokeWidthRef.current;

        const frameId = visibleFrameIdRef.current++;
        if (visibleFrameIdRef.current === Number.MAX_SAFE_INTEGER) {
          visibleMarksRef.current.fill(0);
          visibleFrameIdRef.current = 1;
        }

        const visibleMarks = visibleMarksRef.current;
        const visibleIndices = visibleIndicesScratchRef.current;
        visibleIndices.length = 0;

        const markVisible = (trailIndex: number) => {
          if (visibleMarks[trailIndex] === frameId) return;
          visibleMarks[trailIndex] = frameId;
          visibleIndices.push(trailIndex);
        };

        const sortedStartOrder = sortedStartOrderRef.current;
        while (
          nextStartOrderIndexRef.current < sortedStartOrder.length &&
          sortedStartOrder[nextStartOrderIndexRef.current].startOffsetMs <=
            loopedElapsed
        ) {
          const entry = sortedStartOrder[nextStartOrderIndexRef.current];
          if (entry.finishedAtMs > loopedElapsed) {
            activeTrailIndicesRef.current.push(entry.originalIndex);
          }
          nextStartOrderIndexRef.current++;
        }

        const activeTrailIndices = activeTrailIndicesRef.current;
        let activeWriteIndex = 0;
        for (let i = 0; i < activeTrailIndices.length; i++) {
          const trailIndex = activeTrailIndices[i];
          const trailState = currentTrailStates[trailIndex];
          const finishedAtMs = trailState.startOffsetMs + trailState.durationMs;
          if (
            trailState.startOffsetMs <= loopedElapsed &&
            finishedAtMs > loopedElapsed
          ) {
            activeTrailIndices[activeWriteIndex] = trailIndex;
            activeWriteIndex++;
            markVisible(trailIndex);
          }
        }
        activeTrailIndices.length = activeWriteIndex;

        const sortedFinishOrder = sortedFinishOrderRef.current;
        const finishedRange = getFinishedTrailRenderRange(
          sortedFinishOrder,
          loopedElapsed,
          windowSizeRef.current,
          EVICTION_FADE_MS,
        );
        for (let i = finishedRange.start; i < finishedRange.end; i++) {
          markVisible(sortedFinishOrder[i].originalIndex);
        }

        let visibilityChanged =
          previousVisibleIndicesRef.current.length !== visibleIndices.length;
        for (const trailIndex of previousVisibleIndicesRef.current) {
          if (visibleMarks[trailIndex] !== frameId) {
            trailHandles.current[trailIndex]?.hide();
            cursorHandles.current[trailIndex]?.hide();
            visibilityChanged = true;
          }
        }

        const soundEngine = soundEngineRef.current;
        const soundEnabled = soundEngine?.isEnabled() ?? false;
        const soundFrames = soundFramesRef.current;
        soundFrames.length = 0;
        const activePaintOrderIndices = activePaintOrderIndicesRef.current;
        activePaintOrderIndices.length = 0;

        // Update visible trail paths and cursors imperatively
        for (const idx of visibleIndices) {
          const handle = trailHandles.current[idx];
          if (!handle) continue;

          const fade = computeTrailFade(
            currentTrailStates[idx],
            finishPositionByTrailRef.current[idx],
            sortedFinishOrder,
            loopedElapsed,
            windowSizeRef.current,
            finishedRange.finishedCount,
          );
          if (fade <= 0) continue;

          const result = handle.update(
            loopedElapsed,
            trailOpacity,
            strokeWidth,
            fade,
          );

          if (result && fade > 0 && result.trailProgress < 1) {
            activePaintOrderIndices.push(idx);
          }

          // Update cursor icon in the separate cursor layer
          const ts = currentTrailStates[idx];
          const cursorHandle = cursorHandles.current[idx];
          if (cursorHandle) {
            if (result && fade > 0) {
              const cpIdx = Math.min(
                Math.floor(
                  (ts.trail.points.length - 1) * result.trailProgress,
                ),
                ts.trail.points.length - 1,
              );
              cursorHandle.update(
                result.cursorPosition,
                ts.trail.points[cpIdx]?.cursor,
                result.trailProgress >= 1,
                result.trailProgress,
                fade,
              );
            } else {
              cursorHandle.update({ x: 0, y: 0 }, undefined, true, 0, 0);
            }
          }

          // Collect frame data for sound engine
          if (result && fade > 0 && soundEnabled) {
            const cpIdx = Math.min(
              Math.floor(
                (ts.trail.points.length - 1) * result.trailProgress,
              ),
              ts.trail.points.length - 1,
            );
            soundFrames.push({
              trailIndex: idx,
              x: result.cursorPosition.x,
              y: result.cursorPosition.y,
              prevX: result.cursorPosition.x,
              prevY: result.cursorPosition.y,
              cursorType: ts.trail.points[cpIdx]?.cursor,
              progress: result.trailProgress,
              color: rendererRef.current.getClickColor(ts.trail.color),
              isNewlyActive: false,
            });
          }

          // Spawn clicks
          if (result && showClickRipplesRef.current) {
            const ts = currentTrailStates[idx];
            let clickIdx = nextClickIndexByTrailRef.current[idx];
            while (
              clickIdx < ts.clicksWithProgress.length &&
              result.trailProgress >= ts.clicksWithProgress[clickIdx].progress
            ) {
              const click = ts.clicksWithProgress[clickIdx];

              soundEngine?.triggerClick({
                x: result.cursorPosition.x,
                y: result.cursorPosition.y,
                holdDuration: click.duration,
              });

              pendingClicks.current.push({
                id: `${idx}-${clickIdx}-${Date.now()}`,
                x: result.cursorPosition.x,
                y: result.cursorPosition.y,
                color: rendererRef.current.getClickColor(ts.trail.color),
                radiusFactor: Math.random(),
                durationFactor: Math.random(),
                startTime: Date.now(),
                trailIndex: idx,
                holdDuration: click.duration,
              });

              clickIdx++;
            }
            nextClickIndexByTrailRef.current[idx] = clickIdx;
          }
        }

        const pathLayer = pathLayerRef.current;
        if (pathLayer && activePaintOrderIndices.length > 0) {
          const previousActivePaintOrder =
            previousActivePaintOrderIndicesRef.current;
          let activePaintOrderChanged =
            previousActivePaintOrder.length !== activePaintOrderIndices.length;

          if (!activePaintOrderChanged) {
            for (let i = 0; i < activePaintOrderIndices.length; i++) {
              if (previousActivePaintOrder[i] !== activePaintOrderIndices[i]) {
                activePaintOrderChanged = true;
                break;
              }
            }
          }

          if (activePaintOrderChanged) {
            // Active heads paint over earlier or finished bodies.
            activePaintOrderIndices.sort(
              (a, b) =>
                currentTrailStates[a].startOffsetMs -
                currentTrailStates[b].startOffsetMs,
            );

            for (const idx of activePaintOrderIndices) {
              const group = trailHandles.current[idx]?.getGroup();
              if (group && group.parentNode === pathLayer) {
                pathLayer.appendChild(group);
              }
            }
            previousActivePaintOrder.length = activePaintOrderIndices.length;
            for (let i = 0; i < activePaintOrderIndices.length; i++) {
              previousActivePaintOrder[i] = activePaintOrderIndices[i];
            }
          }
        } else {
          previousActivePaintOrderIndicesRef.current.length = 0;
        }

        // Feed sound engine with collected trail frames
        if (soundFrames.length > 0 && soundEngine) {
          soundEngine.tick(loopedElapsed, soundFrames);
        }

        if (visibilityChanged) {
          const visibleSet = visibleSetRef.current;
          visibleSet.clear();
          for (const trailIndex of visibleIndices) {
            visibleSet.add(trailIndex);
          }
          previousVisibleIndicesRef.current = [...visibleIndices];
        }

        // Flush pending clicks
        if (pendingClicks.current.length > 0) {
          scheduleFlushClicks();
        }

        // Prune ripples for trails that became invisible
        if (visibilityChanged) {
          scheduleRipplePrune();
        }

        scheduleNextFrame();
      };

      // Hidden tabs throttle rAF heavily; switch scheduler mode immediately
      // when visibility changes so audio progression does not get stuck.
      const handleVisibilityChange = () => {
        if (startTime !== null) {
          scheduleNextFrame();
        }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);
      scheduleNextFrame();

      return () => {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        clearScheduledFrame();
      };
    }, [trailStates, timeRange.duration, frozen]);

    const debug = useDebugHover();

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
        }}
      >
        <defs>
          {renderer.svgDefs && (
            <g dangerouslySetInnerHTML={{ __html: renderer.svgDefs }} />
          )}
        </defs>
        {showClickRipples &&
          activeClickEffects.map((effect) => (
            <RippleEffect
              key={effect.id}
              effect={effect}
              settings={{
                clickMinRadius: settings.clickMinRadius,
                clickMaxRadius: settings.clickMaxRadius,
                clickCoreRadius: settings.clickCoreRadius,
                clickMinDuration: settings.clickMinDuration,
                clickMaxDuration: settings.clickMaxDuration,
                clickExpansionDuration: settings.clickExpansionDuration,
                clickStrokeWidth: settings.clickStrokeWidth,
                clickOpacity: settings.clickOpacity,
                clickNumRings: settings.clickNumRings,
                clickRingDelayMs: settings.clickRingDelayMs,
                clickAnimationStopPoint: settings.clickAnimationStopPoint,
              }}
            />
          ))}
        {debug.enabled && (
          <g style={{ pointerEvents: "stroke" }}>
            {trailStates.map((ts, idx) => {
              const points = ts.variedPoints;
              if (!points || points.length < 2) return null;
              const pathData = buildStraightPathSegment(
                points,
                0,
                points.length - 1,
              );
              const trail = ts.trail;
              const id = `debug-trail-${idx}`;
              const onEnter = () => {
                debug.show({
                  kind: "Cursor trail",
                  id,
                  color: trail.color,
                  title: `Trail #${idx}`,
                  fields: [
                    { label: "points", value: String(trail.points.length) },
                    { label: "clicks", value: String(trail.clicks.length) },
                    {
                      label: "duration",
                      value: `${Math.round(ts.durationMs)} ms`,
                    },
                    {
                      label: "start",
                      value: trail.startTime
                        ? new Date(trail.startTime).toLocaleString()
                        : "—",
                    },
                    {
                      label: "span",
                      value: `${Math.round((trail.endTime - trail.startTime) / 1000)}s`,
                    },
                  ],
                });
              };
              const onLeave = () => debug.hide(id);
              return (
                <path
                  key={id}
                  d={pathData}
                  fill="none"
                  stroke="rgba(0,0,0,0.001)"
                  strokeWidth={18}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ cursor: "help" }}
                  onMouseEnter={onEnter}
                  onMouseMove={onEnter}
                  onMouseLeave={onLeave}
                />
              );
            })}
          </g>
        )}
        <g ref={pathLayerRef}>
          {trailStates.map((ts, idx) => (
            <TrailPath
              key={`trail-path-${idx}`}
              ref={(handle) => {
                while (trailHandles.current.length <= idx) {
                  trailHandles.current.push(null);
                }
                trailHandles.current[idx] = handle;
              }}
              trailState={ts}
              fixedMonoStrokeWidth={1 + ((idx * 7 + 3) % 5)}
              renderer={renderer}
            />
          ))}
        </g>
        {trailStates.map((ts, idx) => (
          <TrailCursor
            key={`trail-cursor-${idx}`}
            ref={(handle) => {
              while (cursorHandles.current.length <= idx) {
                cursorHandles.current.push(null);
              }
              cursorHandles.current[idx] = handle;
            }}
            trailState={ts}
            renderer={renderer}
          />
        ))}
      </svg>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.trailStates === nextProps.trailStates &&
      prevProps.timeRange === nextProps.timeRange &&
      prevProps.showClickRipples === nextProps.showClickRipples &&
      prevProps.frozen === nextProps.frozen &&
      prevProps.windowSize === nextProps.windowSize &&
      prevProps.documentSpace === nextProps.documentSpace &&
      prevProps.soundEngine === nextProps.soundEngine &&
      prevProps.settings.strokeWidth === nextProps.settings.strokeWidth &&
      prevProps.settings.trailOpacity === nextProps.settings.trailOpacity &&
      prevProps.settings.animationSpeed ===
        nextProps.settings.animationSpeed &&
      prevProps.settings.trailVisualStyle ===
        nextProps.settings.trailVisualStyle &&
      prevProps.settings.clickMinRadius === nextProps.settings.clickMinRadius &&
      prevProps.settings.clickMaxRadius === nextProps.settings.clickMaxRadius &&
      prevProps.settings.clickCoreRadius === nextProps.settings.clickCoreRadius &&
      prevProps.settings.clickMinDuration ===
        nextProps.settings.clickMinDuration &&
      prevProps.settings.clickMaxDuration ===
        nextProps.settings.clickMaxDuration &&
      prevProps.settings.clickExpansionDuration ===
        nextProps.settings.clickExpansionDuration &&
      prevProps.settings.clickStrokeWidth ===
        nextProps.settings.clickStrokeWidth &&
      prevProps.settings.clickOpacity === nextProps.settings.clickOpacity &&
      prevProps.settings.clickNumRings === nextProps.settings.clickNumRings &&
      prevProps.settings.clickRingDelayMs ===
        nextProps.settings.clickRingDelayMs &&
      prevProps.settings.clickAnimationStopPoint ===
        nextProps.settings.clickAnimationStopPoint
    );
  },
);
