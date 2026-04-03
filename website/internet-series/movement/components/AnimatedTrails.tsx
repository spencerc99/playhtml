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
import { getCursorComponent } from "../cursors";
import { RippleEffect } from "./ClickRipple";

// Cursor-type-to-monochrome-style mapping for black & white rendering mode
interface MonochromeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

function getMonochromeStyle(cursorType: string | undefined): MonochromeStyle {
  switch (cursorType) {
    case "pointer":
      return { fill: "#fff", stroke: "#000", strokeWidth: 1, opacity: 0.7 };
    case "text":
      return { fill: "none", stroke: "#000", strokeWidth: 1.5, opacity: 0.5 };
    case "grab":
    case "grabbing":
    case "move":
      return { fill: "#000", stroke: "none", strokeWidth: 0, opacity: 0.9 };
    case "wait":
    case "progress":
      return { fill: "#888", stroke: "none", strokeWidth: 0, opacity: 0.4 };
    case "crosshair":
      return { fill: "none", stroke: "#000", strokeWidth: 1, opacity: 0.6 };
    default:
      return { fill: "#000", stroke: "none", strokeWidth: 0, opacity: 0.8 };
  }
}



// How many ms to spend fading a trail out when evicted by windowSize
const EVICTION_FADE_MS = 3000;

// How many points to show behind the cursor while drawing
const TAIL_LENGTH = 1000;

// Path generation from varied points, with LRU cache
function createPathGenerator() {
  const cache = new Map<string, string>();

  return (points: Array<{ x: number; y: number }>, style: string): string => {
    if (points.length < 2) return "";

    const cacheKey = `${style}-${points.length}-${points[0].x.toFixed(
      0,
    )}-${points[0].y.toFixed(0)}-${points[points.length - 1].x.toFixed(
      0,
    )}-${points[points.length - 1].y.toFixed(0)}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    let path = `M ${points[0].x} ${points[0].y}`;

    if (style === "straight") {
      for (let i = 1; i < points.length; i++) {
        path += ` L ${points[i].x} ${points[i].y}`;
      }
    } else {
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        path += ` Q ${p1.x} ${p1.y} ${(p1.x + p2.x) / 2} ${(p1.y + p2.y) / 2}`;
      }

      if (points.length > 1) {
        const lastPoint = points[points.length - 1];
        const secondLast = points[points.length - 2];
        path += ` Q ${secondLast.x} ${secondLast.y} ${lastPoint.x} ${lastPoint.y}`;
      }
    }

    cache.set(cacheKey, path);

    if (cache.size > 500) {
      const firstKey = cache.keys().next().value!;
      cache.delete(firstKey);
    }

    return path;
  };
}

// Compute visible points and path data for a trail at a given elapsed time.
function computeTrailFrame(
  trailState: TrailState,
  elapsedTimeMs: number,
  generatePath: (pts: Array<{ x: number; y: number }>, style: string) => string,
) {
  const { trail, startOffsetMs, durationMs, variedPoints } = trailState;

  if (trail.points.length < 2) return null;

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

  const pointsToDraw: Array<{ x: number; y: number }> = [];
  for (let i = tailStart; i <= tailEnd; i++) {
    pointsToDraw.push(variedPoints[i]);
  }

  if (!isFinished && headIndex < totalVariedPoints - 1 && headFraction > 0) {
    const p1 = variedPoints[headIndex];
    const p2 = variedPoints[headIndex + 1];
    pointsToDraw.push({
      x: p1.x + (p2.x - p1.x) * headFraction,
      y: p1.y + (p2.y - p1.y) * headFraction,
    });
  }

  const cursorPosition =
    pointsToDraw.length > 0
      ? pointsToDraw[pointsToDraw.length - 1]
      : variedPoints[0] || { x: 0, y: 0 };

  const pathData =
    pointsToDraw.length >= 2 ? generatePath(pointsToDraw, "straight") : "";

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
interface ImperativeTrailHandle {
  update(
    elapsedTimeMs: number,
    trailOpacity: number,
    strokeWidth: number,
    evictionFade: number,
    monochromeMode: boolean,
  ): { trailProgress: number; cursorPosition: { x: number; y: number } } | null;
}

interface TrailProps {
  trailState: TrailState;
  trailIndex: number;
  fixedMonoStrokeWidth: number;
  generatePath: (
    points: Array<{ x: number; y: number }>,
    style: string,
  ) => string;
}

const Trail = React.forwardRef<ImperativeTrailHandle, TrailProps>(
  ({ trailState, trailIndex, fixedMonoStrokeWidth, generatePath }, ref) => {
    const groupRef = useRef<SVGGElement>(null);
    const pathRef = useRef<SVGPathElement>(null);
    const cursorGroupRef = useRef<SVGGElement>(null);
    const cursorColorRef = useRef<SVGGElement>(null);
    const cursorMonoRef = useRef<SVGGElement>(null);

    const [cursorType, setCursorType] = useState<string | undefined>(
      trailState.trail.points[0]?.cursor,
    );
    const CursorComponent = getCursorComponent(cursorType);
    const cursorSize = 32;

    React.useImperativeHandle(ref, () => ({
      update(elapsedTimeMs, trailOpacity, strokeWidth, evictionFade, monochromeMode) {
        const group = groupRef.current;
        if (!group) return null;

        // evictionFade <= 0 means fully hidden
        if (evictionFade <= 0) {
          group.setAttribute("opacity", "0");
          return null;
        }

        const frame = computeTrailFrame(
          trailState,
          elapsedTimeMs,
          generatePath,
        );

        if (!frame) {
          group.setAttribute("opacity", "0");
          return null;
        }

        group.setAttribute("opacity", String(evictionFade));

        const { pathData, isFinished, cursorPosition, trailProgress } = frame;

        const pathEl = pathRef.current;
        if (pathEl) {
          if (pathData) {
            pathEl.setAttribute("d", pathData);

            if (monochromeMode) {
              const monoStyle = getMonochromeStyle(frame.cursorType);
              // Fixed width from prop — deterministic per trail, never changes
              const effectiveWidth = fixedMonoStrokeWidth;

              pathEl.setAttribute("stroke", monoStyle.fill !== "none" ? monoStyle.fill : monoStyle.stroke);
              pathEl.setAttribute("opacity", String(monoStyle.opacity * trailOpacity));
              pathEl.setAttribute("stroke-width", String(effectiveWidth));
              if (monoStyle.stroke !== "none" && monoStyle.fill !== "none") {
                // Pointer-like: outline stroke
                pathEl.setAttribute("stroke", monoStyle.stroke);
              }
              pathEl.setAttribute("filter", "url(#ink-texture)");
            } else {
              pathEl.setAttribute("stroke", color);
              pathEl.setAttribute("opacity", String(trailOpacity));
              pathEl.setAttribute("stroke-width", String(strokeWidth));
              pathEl.removeAttribute("filter");
            }
            pathEl.style.display = "";
          } else {
            pathEl.style.display = "none";
          }
        }

        const cursorGroup = cursorGroupRef.current;
        if (cursorGroup) {
          if (!isFinished && trailProgress > 0) {
            cursorGroup.style.display = "";
            cursorGroup.setAttribute(
              "transform",
              `translate(${cursorPosition.x}, ${cursorPosition.y})`,
            );
            // Toggle between color and monochrome cursor
            if (cursorColorRef.current) {
              cursorColorRef.current.style.display = monochromeMode ? "none" : "";
            }
            if (cursorMonoRef.current) {
              cursorMonoRef.current.style.display = monochromeMode ? "" : "none";
            }
          } else {
            cursorGroup.style.display = "none";
          }
        }

        if (frame.cursorType !== cursorType) {
          setCursorType(frame.cursorType);
        }

        return { trailProgress, cursorPosition };
      },
    }));

    const color = trailState.trail.color;
    const monoColor = "#000";

    return (
      <g ref={groupRef} opacity="0">
        <path
          ref={pathRef}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ mixBlendMode: "multiply", display: "none" }}
        />

        <g ref={cursorGroupRef} style={{ display: "none" }}>
          <g
            transform={`translate(${-12 * (cursorSize / 24)}, ${
              -4 * (cursorSize / 24)
            })`}
          >
            {/* Render both color and monochrome cursors; parent controls visibility */}
            <g ref={cursorColorRef} className="cursor-color">
              <CursorComponent color={color} size={cursorSize} />
            </g>
            <g ref={cursorMonoRef} className="cursor-mono" style={{ display: "none" }}>
              <CursorComponent color={monoColor} size={cursorSize} />
            </g>
          </g>
        </g>
      </g>
    );
  },
);

// Compute eviction fade for each trail index at a given time.
function computeEvictionFades(
  trailStates: TrailState[],
  sortedFinishOrder: Array<{ originalIndex: number; finishedAtMs: number }>,
  elapsedTimeMs: number,
  windowSize: number,
): Float64Array {
  // Returns an array indexed by originalIndex with eviction fade values.
  // 0 = hidden (not started or fully evicted), >0 = visible.
  const fades = new Float64Array(trailStates.length);

  const finished: Array<{ originalIndex: number; finishedAtMs: number }> = [];

  for (const entry of sortedFinishOrder) {
    const ts = trailStates[entry.originalIndex];
    const trailElapsedMs = elapsedTimeMs - ts.startOffsetMs;
    if (trailElapsedMs < 0) continue; // not started

    const trailProgress = Math.min(1, trailElapsedMs / ts.durationMs);
    if (trailProgress < 1) {
      fades[entry.originalIndex] = 1; // active
    } else {
      finished.push(entry);
    }
  }

  const excessCount = Math.max(0, finished.length - windowSize);
  for (let i = 0; i < finished.length; i++) {
    const f = finished[i];
    if (i < excessCount) {
      // Fade based on when this trail was pushed out of the window, not when
      // it finished. The trail at index windowSize is the one that displaced
      // trail i — so use its finishedAtMs as the eviction trigger time.
      const displacerIndex = i + windowSize;
      const evictedAtMs =
        displacerIndex < finished.length
          ? finished[displacerIndex].finishedAtMs
          : elapsedTimeMs;
      const timeSinceEvicted = elapsedTimeMs - evictedAtMs;
      fades[f.originalIndex] = Math.max(
        0,
        1 - timeSinceEvicted / EVICTION_FADE_MS,
      );
    } else {
      fades[f.originalIndex] = 1;
    }
  }

  return fades;
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
  settings: {
    strokeWidth: number;
    pointSize: number;
    trailOpacity: number;
    animationSpeed: number;
    clickMinRadius: number;
    clickMaxRadius: number;
    clickMinDuration: number;
    clickMaxDuration: number;
    clickExpansionDuration: number;
    clickStrokeWidth: number;
    clickOpacity: number;
    clickNumRings: number;
    clickRingDelayMs: number;
    clickAnimationStopPoint: number;
    monochromeMode?: boolean;
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
    settings,
  }) => {
    const [activeClickEffects, setActiveClickEffects] = useState<ClickEffect[]>(
      [],
    );

    const animationRef = useRef<number>();
    const spawnedClicksRef = useRef<Map<string, Set<number>>>(new Map());
    const svgRef = useRef<SVGSVGElement>(null);

    const generatePath = useRef(createPathGenerator()).current;

    // Settings refs — updated without re-render
    const animationSpeedRef = useRef(settings.animationSpeed);
    const strokeWidthRef = useRef(settings.strokeWidth);
    const trailOpacityRef = useRef(settings.trailOpacity);
    const monochromeModeRef = useRef(settings.monochromeMode ?? false);

    useEffect(() => {
      animationSpeedRef.current = settings.animationSpeed;
      strokeWidthRef.current = settings.strokeWidth;
      trailOpacityRef.current = settings.trailOpacity;
      monochromeModeRef.current = settings.monochromeMode ?? false;
    }, [settings.animationSpeed, settings.strokeWidth, settings.trailOpacity, settings.monochromeMode]);

    // Pre-sort finished trails once per trailStates change
    const sortedFinishOrder = useMemo(() => {
      return trailStates
        .map((ts, i) => ({
          originalIndex: i,
          finishedAtMs: ts.startOffsetMs + ts.durationMs,
        }))
        .sort((a, b) => a.finishedAtMs - b.finishedAtMs);
    }, [trailStates]);

    // Store one ref handle per trail index.
    const trailHandles = useRef<(ImperativeTrailHandle | null)[]>(
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
    const windowSizeRef = useRef(windowSize);
    const showClickRipplesRef = useRef(showClickRipples);
    const documentSpaceRef = useRef(documentSpace);

    useEffect(() => {
      trailStatesRef.current = trailStates;
    }, [trailStates]);
    useEffect(() => {
      sortedFinishOrderRef.current = sortedFinishOrder;
    }, [sortedFinishOrder]);
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
            svgRef.current.setAttribute("viewBox", `${window.scrollX} ${window.scrollY} ${vw} ${vh}`);
          }
          const elapsed = timeRange.duration;
          for (let i = 0; i < trailStatesRef.current.length; i++) {
            const handle = trailHandles.current[i];
            handle?.update(
              elapsed,
              trailOpacityRef.current,
              strokeWidthRef.current,
              1,
              monochromeModeRef.current,
            );
          }
        });
        return;
      }

      if (trailStates.length === 0) return;

      // Reset per-loop state so stale prevElapsed from a previous loop doesn't
      // look like a wrap and trigger a mass re-spawn of all clicks at once.
      prevElapsedRef.current = 0;
      spawnedClicksRef.current.clear();
      setActiveClickEffects([]);

      let startTime: number | null = null;

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
          svgRef.current.setAttribute("viewBox", `${scrollX} ${scrollY} ${vw} ${vh}`);
        }

        const realElapsed = timestamp - startTime;
        const scaledElapsed = realElapsed * animationSpeedRef.current;
        const loopedElapsed = scaledElapsed % timeRange.duration;

        // Detect loop wrap
        if (loopedElapsed < prevElapsedRef.current) {
          spawnedClicksRef.current.clear();
          setActiveClickEffects([]);
        }
        prevElapsedRef.current = loopedElapsed;

        const currentTrailStates = trailStatesRef.current;
        const trailOpacity = trailOpacityRef.current;
        const strokeWidth = strokeWidthRef.current;

        // Compute per-trail eviction fades
        const fades = computeEvictionFades(
          currentTrailStates,
          sortedFinishOrderRef.current,
          loopedElapsed,
          windowSizeRef.current,
        );

        // Track which trails are visible this frame for ripple pruning
        const newVisible = new Set<number>();

        // Update all trails imperatively
        for (let idx = 0; idx < currentTrailStates.length; idx++) {
          const handle = trailHandles.current[idx];
          if (!handle) continue;

          const fade = fades[idx];
          const result = handle.update(
            loopedElapsed,
            trailOpacity,
            strokeWidth,
            fade,
            monochromeModeRef.current,
          );

          if (fade > 0) newVisible.add(idx);

          // Spawn clicks
          if (result && showClickRipplesRef.current) {
            const ts = currentTrailStates[idx];
            const trailKey = `trail-${idx}`;
            if (!spawnedClicksRef.current.has(trailKey)) {
              spawnedClicksRef.current.set(trailKey, new Set());
            }
            const spawnedSet = spawnedClicksRef.current.get(trailKey)!;

            ts.clicksWithProgress.forEach((click, clickIdx) => {
              if (
                result.trailProgress >= click.progress &&
                !spawnedSet.has(clickIdx)
              ) {
                spawnedSet.add(clickIdx);
                pendingClicks.current.push({
                  id: `${idx}-${clickIdx}-${Date.now()}`,
                  x: result.cursorPosition.x,
                  y: result.cursorPosition.y,
                  color: monochromeModeRef.current ? "#000" : ts.trail.color,
                  radiusFactor: Math.random(),
                  durationFactor: Math.random(),
                  startTime: Date.now(),
                  trailIndex: idx,
                  holdDuration: click.duration,
                });
              }
            });
          }
        }

        visibleSetRef.current = newVisible;

        // Flush pending clicks
        if (pendingClicks.current.length > 0) {
          scheduleFlushClicks();
        }

        // Prune ripples for trails that became invisible
        scheduleRipplePrune();

        animationRef.current = requestAnimationFrame(animate);
      };

      animationRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }, [trailStates, timeRange.duration, frozen]);

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
          <filter id="ink-texture">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" />
          </filter>
        </defs>
        {trailStates.map((ts, idx) => (
          <Trail
            key={`trail-${idx}`}
            ref={(handle) => {
              while (trailHandles.current.length <= idx) {
                trailHandles.current.push(null);
              }
              trailHandles.current[idx] = handle;
            }}
            trailState={ts}
            trailIndex={idx}
            fixedMonoStrokeWidth={1 + ((idx * 7 + 3) % 5)}
            generatePath={generatePath}
          />
        ))}
        {showClickRipples &&
          activeClickEffects.map((effect) => (
            <RippleEffect
              key={effect.id}
              effect={effect}
              settings={{
                clickMinRadius: settings.clickMinRadius,
                clickMaxRadius: settings.clickMaxRadius,
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
      prevProps.settings.clickMinRadius === nextProps.settings.clickMinRadius &&
      prevProps.settings.clickMaxRadius === nextProps.settings.clickMaxRadius &&
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
        nextProps.settings.clickAnimationStopPoint &&
      prevProps.settings.monochromeMode === nextProps.settings.monochromeMode
    );
  },
);
