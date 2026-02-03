// ABOUTME: Standalone click/hold ripple visualizer
// ABOUTME: Uses same ripple logic as AnimatedTrails but renders only ripples (no trails/path/cursor)
import React, { useState, useEffect, useRef, memo, useCallback } from "react";
import { ClickEffect } from "../types";
import { RippleEffect, RippleSettings } from "./ClickRipple";

/** One click/hold to show at a specific time in the cycle */
export interface ScheduledClick {
  id: string;
  x: number;
  y: number;
  color: string;
  spawnAtMs: number;
  holdDuration?: number;
}

interface AnimatedClicksProps {
  scheduledClicks: ScheduledClick[];
  timeRange: { duration: number };
  settings: {
    animationSpeed: number;
  } & RippleSettings;
}

export const AnimatedClicks: React.FC<AnimatedClicksProps> = memo(({
  scheduledClicks,
  timeRange,
  settings,
}) => {
  const [elapsedTimeMs, setElapsedTimeMs] = useState(0);
  const [activeClickEffects, setActiveClickEffects] = useState<ClickEffect[]>([]);
  const animationRef = useRef<number>();
  const lastElapsedRef = useRef(0);
  const spawnedThisCycleRef = useRef<Set<string>>(new Set());

  const animationSpeedRef = useRef(settings.animationSpeed);
  useEffect(() => {
    animationSpeedRef.current = settings.animationSpeed;
  }, [settings.animationSpeed]);

  const handleSpawnClick = useCallback((click: ClickEffect) => {
    setActiveClickEffects((prev) => [...prev, click]);
  }, []);

  // Animation loop: same as AnimatedTrails (0..duration, scaled by speed, looping)
  useEffect(() => {
    if (scheduledClicks.length === 0 || timeRange.duration <= 0) return;

    let startTime: number | null = null;

    const animate = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;

      const realElapsed = timestamp - startTime;
      const scaledElapsed = realElapsed * animationSpeedRef.current;
      const loopedElapsed = scaledElapsed % timeRange.duration;

      // Detect cycle wrap so we can re-spawn clicks on the next loop
      if (loopedElapsed < lastElapsedRef.current) {
        spawnedThisCycleRef.current.clear();
      }
      lastElapsedRef.current = loopedElapsed;

      setElapsedTimeMs(loopedElapsed);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [scheduledClicks, timeRange.duration]);

  // Spawn ripples when elapsedTimeMs passes each click's spawnAtMs
  useEffect(() => {
    const spawned = spawnedThisCycleRef.current;
    scheduledClicks.forEach((sc) => {
      if (elapsedTimeMs >= sc.spawnAtMs && !spawned.has(sc.id)) {
        spawned.add(sc.id);
        handleSpawnClick({
          id: `${sc.id}-${Date.now()}`,
          x: sc.x,
          y: sc.y,
          color: sc.color,
          radiusFactor: Math.random(),
          durationFactor: Math.random(),
          startTime: Date.now(),
          trailIndex: 0,
          holdDuration: sc.holdDuration,
        });
      }
    });
  }, [elapsedTimeMs, scheduledClicks, handleSpawnClick]);

  const rippleSettings: RippleSettings = {
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
  };

  return (
    <svg
      className="animated-clicks-svg"
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
      }}
    >
      {activeClickEffects.map((effect) => (
        <RippleEffect
          key={effect.id}
          effect={effect}
          settings={rippleSettings}
        />
      ))}
    </svg>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.scheduledClicks === nextProps.scheduledClicks &&
    prevProps.timeRange.duration === nextProps.timeRange.duration &&
    prevProps.settings.animationSpeed === nextProps.settings.animationSpeed &&
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
