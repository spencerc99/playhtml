// ABOUTME: Shared ripple effect for click/hold visualization
// ABOUTME: Used by AnimatedTrails and AnimatedClicks so ripple logic stays DRY
import React, { useState, useEffect, memo } from "react";
import { ClickEffect } from "../types";

export interface RippleSettings {
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

export const RippleEffect = memo(
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
