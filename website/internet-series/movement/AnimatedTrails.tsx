// ABOUTME: Animated trails visualization component with animation loop
// ABOUTME: Handles trail rendering, click effects, and animation timing
import React, { useState, useEffect, useRef, memo, useCallback } from "react";
import { TrailState, ClickEffect } from "./types";
import { getCursorComponent } from "./cursors";

// RISO pattern overlay component
const RisoPattern = React.memo(() => (
  <svg
    width="100%"
    height="100%"
    className="riso-pattern"
    style={{
      position: "absolute",
      inset: 0,
      opacity: 0.7,
      pointerEvents: "none",
      mixBlendMode: "multiply",
    }}
  >
    <defs>
      <filter id="noise">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9"
          numOctaves="3"
          stitchTiles="stitch"
        />
        <feColorMatrix
          type="matrix"
          values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 2 -1"
        />
      </filter>
      <filter id="grain">
        <feTurbulence
          type="turbulence"
          baseFrequency="0.5"
          numOctaves="2"
          stitchTiles="stitch"
        />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncA type="discrete" tableValues="0 0.2 0.3 0.4" />
        </feComponentTransfer>
      </filter>
      <filter id="smoothing">
        <feGaussianBlur in="SourceGraphic" stdDeviation="0.5" />
      </filter>
    </defs>
    <rect width="100%" height="100%" filter="url(#noise)" />
    <rect
      width="100%"
      height="100%"
      filter="url(#grain)"
      style={{ opacity: 0.3 }}
    />
  </svg>
));

interface RippleSettings {
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
}

// Ripple Effect Component for clicks
const RippleEffect = memo(
  ({
    effect,
    settings: rippleSettings,
  }: {
    effect: ClickEffect;
    settings: RippleSettings;
  }) => {
    const [now, setNow] = useState(Date.now());
    const [isAnimating, setIsAnimating] = useState(true);

    // Scale by hold duration if present (250ms is minimum hold threshold)
    // Formula: multiplier = 1 + (holdDuration / 1000) so 250ms = 1.25x, 1000ms = 2x, 2000ms = 3x
    const holdMultiplier = effect.holdDuration ? (1 + effect.holdDuration / 1000) : 1;
    
    const baseMaxRadius = rippleSettings.clickMinRadius + effect.radiusFactor * (rippleSettings.clickMaxRadius - rippleSettings.clickMinRadius);
    const effectMaxRadius = baseMaxRadius * holdMultiplier;
    
    const baseTotalDuration = rippleSettings.clickMinDuration + effect.durationFactor * (rippleSettings.clickMaxDuration - rippleSettings.clickMinDuration);
    const effectTotalDuration = baseTotalDuration * holdMultiplier;

    useEffect(() => {
      let animationFrameId: number;

      const animate = () => {
        setNow(Date.now());
        animationFrameId = requestAnimationFrame(animate);
      };

      if (isAnimating) {
        animationFrameId = requestAnimationFrame(animate);
      }

      return () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
      };
    }, [isAnimating]);

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const expansionDuration = rippleSettings.clickExpansionDuration * holdMultiplier;
    
    const totalElapsed = now - effect.startTime;
    const allRingsComplete = totalElapsed >= effectTotalDuration || Array.from({ length: rippleSettings.clickNumRings }).every((_, i) => {
      const ringStartTime = effect.startTime + (i * rippleSettings.clickRingDelayMs);
      const elapsed = now - ringStartTime;
      const ringProgress = Math.min(1, elapsed / expansionDuration);
      return ringProgress >= rippleSettings.clickAnimationStopPoint;
    });

    if (isAnimating && allRingsComplete) {
      setIsAnimating(false);
    }

    const rings = Array.from({ length: rippleSettings.clickNumRings }, (_, i) => {
      const ringStartTime = effect.startTime + (i * rippleSettings.clickRingDelayMs);
      const elapsed = now - ringStartTime;

      if (elapsed < 0) return null;

      const rawProgress = Math.min(1, elapsed / expansionDuration);
      const clampedProgress = Math.min(rawProgress, rippleSettings.clickAnimationStopPoint);
      const normalizedProgress = clampedProgress / rippleSettings.clickAnimationStopPoint;
      const ringRadius = effectMaxRadius * rippleSettings.clickAnimationStopPoint * easeOutCubic(normalizedProgress);
      const ringOpacity = rippleSettings.clickOpacity;

      return (
        <circle
          key={i}
          cx={effect.x}
          cy={effect.y}
          r={ringRadius}
          fill="none"
          stroke={effect.color}
          strokeWidth={rippleSettings.clickStrokeWidth}
          opacity={Math.max(0, ringOpacity)}
          style={{ mixBlendMode: "multiply" }}
        />
      );
    });

    return <g>{rings}</g>;
  }
);

interface AnimatedTrailsProps {
  trailStates: TrailState[];
  containerRef: React.RefObject<HTMLDivElement>;
  timeRange: { min: number; max: number; duration: number };
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
  };
}

export const AnimatedTrails: React.FC<AnimatedTrailsProps> = memo(({
  trailStates,
  containerRef,
  timeRange,
  settings,
}) => {
  const [elapsedTimeMs, setElapsedTimeMs] = useState(0);
  const [activeClickEffects, setActiveClickEffects] = useState<ClickEffect[]>([]);
  const animationRef = useRef<number>();
  const pathCache = useRef<Map<string, string>>(new Map());
  const spawnedClicksRef = useRef<Map<string, Set<number>>>(new Map());

  // Use refs for all settings that should update without re-rendering
  const animationSpeedRef = useRef(settings.animationSpeed);
  const strokeWidthRef = useRef(settings.strokeWidth);
  const pointSizeRef = useRef(settings.pointSize);
  const trailOpacityRef = useRef(settings.trailOpacity);

  // Update refs without restarting animation
  useEffect(() => {
    animationSpeedRef.current = settings.animationSpeed;
    strokeWidthRef.current = settings.strokeWidth;
    pointSizeRef.current = settings.pointSize;
    trailOpacityRef.current = settings.trailOpacity;
  }, [settings.animationSpeed, settings.strokeWidth, settings.pointSize, settings.trailOpacity]);

  // Animation loop - elapsedTimeMs stays internal, never passed to parent
  useEffect(() => {
    if (trailStates.length === 0) return;

    let startTime: number | null = null;

    const animate = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;

      const realElapsed = timestamp - startTime;
      // Scale elapsed time by animation speed to make animation faster/slower
      // e.g., if speed = 2, after 1 second real time, 2 seconds of animation have passed
      const scaledElapsed = realElapsed * animationSpeedRef.current;
      // Loop within the original timeRange duration
      const loopedElapsed = scaledElapsed % timeRange.duration;

      setElapsedTimeMs(loopedElapsed);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [trailStates, timeRange.duration]);

  const handleSpawnClick = useCallback((click: ClickEffect) => {
    setActiveClickEffects(prev => [...prev, click]);
  }, []);

  // Generate path from varied points
  const generatePathFromVariedPoints = useCallback((
    points: Array<{ x: number; y: number }>,
    style: string
  ): string => {
    if (points.length < 2) return "";

    const cacheKey = `${style}-${points.length}-${points[0].x.toFixed(0)}-${points[0].y.toFixed(0)}-${points[points.length-1].x.toFixed(0)}-${points[points.length-1].y.toFixed(0)}`;
    const cached = pathCache.current.get(cacheKey);
    if (cached) return cached;

    let path = `M ${points[0].x} ${points[0].y}`;

    if (style === 'straight') {
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

    pathCache.current.set(cacheKey, path);

    if (pathCache.current.size > 500) {
      const firstKey = pathCache.current.keys().next().value;
      pathCache.current.delete(firstKey);
    }

    return path;
  }, []);

  const Trail = memo(({
    trailState,
    trailIndex,
    elapsedTimeMs,
    onSpawnClick,
    settingsRefs
  }: {
    trailState: TrailState;
    trailIndex: number;
    elapsedTimeMs: number;
    onSpawnClick: (click: ClickEffect) => void;
    settingsRefs: {
      strokeWidth: React.MutableRefObject<number>;
      pointSize: React.MutableRefObject<number>;
      trailOpacity: React.MutableRefObject<number>;
    };
  }) => {
    const { trail, startOffsetMs, durationMs, variedPoints, clicksWithProgress } = trailState;

    if (trail.points.length < 2) return null;
    if (elapsedTimeMs < startOffsetMs) return null;

    const trailElapsedMs = elapsedTimeMs - startOffsetMs;
    const trailProgress = Math.min(1, trailElapsedMs / durationMs);

    // Read current settings from refs
    const strokeWidth = settingsRefs.strokeWidth.current!;
    const pointSize = settingsRefs.pointSize.current!;
    const trailOpacity = settingsRefs.trailOpacity.current!;

    const cursorSize = 32;

    const totalVariedPoints = variedPoints.length;
    const exactVariedPosition = (totalVariedPoints - 1) * trailProgress;
    const currentVariedIndex = Math.floor(exactVariedPosition);
    const variedProgress = exactVariedPosition - currentVariedIndex;

    const pointsToDraw: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= Math.min(currentVariedIndex, totalVariedPoints - 1); i++) {
      pointsToDraw.push(variedPoints[i]);
    }

    if (currentVariedIndex < totalVariedPoints - 1 && variedProgress > 0) {
      const p1 = variedPoints[currentVariedIndex];
      const p2 = variedPoints[currentVariedIndex + 1];
      const interpolatedPoint = {
        x: p1.x + (p2.x - p1.x) * variedProgress,
        y: p1.y + (p2.y - p1.y) * variedProgress,
      };
      pointsToDraw.push(interpolatedPoint);
    }

    const cursorPosition = pointsToDraw.length > 0
      ? pointsToDraw[pointsToDraw.length - 1]
      : variedPoints[0] || { x: 0, y: 0 };

    useEffect(() => {
      const trailKey = `trail-${trailIndex}`;
      if (!spawnedClicksRef.current.has(trailKey)) {
        spawnedClicksRef.current.set(trailKey, new Set());
      }
      const spawnedSet = spawnedClicksRef.current.get(trailKey)!;

      clicksWithProgress.forEach((click, clickIdx) => {
        if (trailProgress >= click.progress && !spawnedSet.has(clickIdx)) {
          spawnedSet.add(clickIdx);

          onSpawnClick({
            id: `${trailIndex}-${clickIdx}-${Date.now()}`,
            x: cursorPosition.x,
            y: cursorPosition.y,
            color: trail.color,
            radiusFactor: Math.random(),
            durationFactor: Math.random(),
            startTime: Date.now(),
            trailIndex,
            holdDuration: click.duration, // Pass through hold duration if present
          });
        }
      });
    }, [trailProgress, clicksWithProgress, cursorPosition, trail.color, trailIndex, onSpawnClick]);

    const visiblePathData = pointsToDraw.length >= 2
      ? generatePathFromVariedPoints(pointsToDraw, 'straight')
      : "";

    const visibleDots = pointsToDraw.slice(0, -1);

    const currentPointIndex = Math.min(
      Math.floor((trail.points.length - 1) * trailProgress),
      trail.points.length - 1
    );
    const currentCursorType = trail.points[currentPointIndex]?.cursor;
    const CursorComponent = getCursorComponent(currentCursorType);

    return (
      <g key={`trail-${trailIndex}`}>
        {visiblePathData && (
          <path
            d={visiblePathData}
            fill="none"
            stroke={trail.color}
            strokeWidth={strokeWidth}
            opacity={trailOpacity}
            style={{ mixBlendMode: "multiply" }}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {pointSize > 0 && visibleDots.map((point, pointIndex) => (
          <circle
            key={`point-${trailIndex}-${pointIndex}`}
            cx={point.x}
            cy={point.y}
            r={pointSize / 2}
            fill={trail.color}
            opacity={trailOpacity * 0.6}
            style={{ mixBlendMode: "multiply" }}
          />
        ))}

        {trailProgress > 0 && trailProgress < 1 && (
          <g transform={`translate(${cursorPosition.x}, ${cursorPosition.y})`}>
            <g transform={`translate(${-12 * (cursorSize / 24)}, ${-4 * (cursorSize / 24)})`}>
              <CursorComponent color={trail.color} size={cursorSize} />
            </g>
          </g>
        )}
      </g>
    );
  }, (prevProps, nextProps) => {
    return prevProps.elapsedTimeMs === nextProps.elapsedTimeMs;
  });

  return (
    <div className="canvas-container" ref={containerRef}>
      <RisoPattern />
      <svg
        className="trails-svg"
        width="100%"
        height="100%"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "none",
        }}
      >
        {trailStates.map((trailState, trailIndex) => (
          <Trail
            key={`trail-${trailIndex}`}
            trailState={trailState}
            trailIndex={trailIndex}
            elapsedTimeMs={elapsedTimeMs}
            onSpawnClick={handleSpawnClick}
            settingsRefs={{
              strokeWidth: strokeWidthRef,
              pointSize: pointSizeRef,
              trailOpacity: trailOpacityRef,
            }}
          />
        ))}
        {activeClickEffects.map((effect) => (
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
    </div>
  );
}, (prevProps, nextProps) => {
  // Only re-render if trail states, time range, or click settings change
  // Visual settings (strokeWidth, pointSize, trailOpacity, animationSpeed) are handled via refs
  return (
    prevProps.trailStates === nextProps.trailStates &&
    prevProps.timeRange === nextProps.timeRange &&
    prevProps.containerRef === nextProps.containerRef &&
    prevProps.settings.clickMinRadius === nextProps.settings.clickMinRadius &&
    prevProps.settings.clickMaxRadius === nextProps.settings.clickMaxRadius &&
    prevProps.settings.clickMinDuration === nextProps.settings.clickMinDuration &&
    prevProps.settings.clickMaxDuration === nextProps.settings.clickMaxDuration &&
    prevProps.settings.clickExpansionDuration === nextProps.settings.clickExpansionDuration &&
    prevProps.settings.clickStrokeWidth === nextProps.settings.clickStrokeWidth &&
    prevProps.settings.clickOpacity === nextProps.settings.clickOpacity &&
    prevProps.settings.clickNumRings === nextProps.settings.clickNumRings &&
    prevProps.settings.clickRingDelayMs === nextProps.settings.clickRingDelayMs &&
    prevProps.settings.clickAnimationStopPoint === nextProps.settings.clickAnimationStopPoint
  );
});
