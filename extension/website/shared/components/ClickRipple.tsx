// ABOUTME: Shared ripple effect for click/hold visualization
// ABOUTME: Used by AnimatedTrails and AnimatedClicks so ripple logic stays DRY
import { useState, useEffect, useMemo, useRef, memo } from "react";
import { ClickEffect } from "../types";

export interface RippleSettings {
  clickMinRadius: number;
  clickMaxRadius: number;
  /** Radius of the small "core" mark at the click point (innermost ring).
   * Independent of clickMinRadius so the core stays small and visible even
   * when the rest of the ripple is large. */
  clickCoreRadius: number;
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
    onComplete,
  }: {
    effect: ClickEffect;
    settings: RippleSettings;
    onComplete?: (id: string) => void;
  }) => {
    const [now, setNow] = useState(Date.now());
    const [isAnimating, setIsAnimating] = useState(true);
    /** Ensures onComplete runs once — render-phase callbacks can run twice in Strict Mode. */
    const completionFiredRef = useRef(false);

    // Scale by hold duration if present.
    // 250ms = 1.25x, 1000ms = 2x, 2000ms = 3x
    const holdMultiplier = effect.holdDuration
      ? 1 + effect.holdDuration / 1000
      : 1;

    const baseMaxRadius =
      rippleSettings.clickMinRadius +
      effect.radiusFactor *
        (rippleSettings.clickMaxRadius - rippleSettings.clickMinRadius);
    const effectMaxRadius = baseMaxRadius * holdMultiplier;

    const baseTotalDuration =
      rippleSettings.clickMinDuration +
      effect.durationFactor *
        (rippleSettings.clickMaxDuration - rippleSettings.clickMinDuration);
    const effectTotalDuration = baseTotalDuration * holdMultiplier;

    const expansionDuration =
      rippleSettings.clickExpansionDuration * holdMultiplier;

    // Honor the configured ring delay directly — staggering is when each ring
    // BEGINS expanding. The visual density comes from each ring freezing at
    // a different target radius (see ring rendering below), not time stagger.
    const ringStaggerMs = rippleSettings.clickRingDelayMs;
    const numRings = Math.max(1, rippleSettings.clickNumRings);

    // The outermost ring travels the farthest, so it dictates when the whole
    // ripple has finished animating.
    const allRingsComplete = useMemo(() => {
      const totalElapsed = now - effect.startTime;
      if (totalElapsed >= effectTotalDuration) return true;

      const outerIndex = numRings - 1;
      const outerStartTime = effect.startTime + outerIndex * ringStaggerMs;
      const outerElapsed = now - outerStartTime;
      return outerElapsed >= expansionDuration;
    }, [
      now,
      effect.startTime,
      effectTotalDuration,
      expansionDuration,
      numRings,
      ringStaggerMs,
    ]);

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

    useEffect(() => {
      completionFiredRef.current = false;
    }, [effect.id]);

    useEffect(() => {
      if (!allRingsComplete || completionFiredRef.current) return;
      completionFiredRef.current = true;
      onComplete?.(effect.id);
      setIsAnimating(false);
    }, [allRingsComplete, effect.id, onComplete]);

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    // Each ring freezes at its own target radius — spaced from a small fixed
    // core out to (effectMaxRadius * clickAnimationStopPoint). Rings expand
    // from 0 → their target at constant velocity, so the outermost ring
    // takes the full expansionDuration and inner rings finish sooner.
    // Pinning the innermost ring to clickCoreRadius (with ±2px jitter via
    // radiusFactor) guarantees every ripple has a visible "core" mark where
    // the click landed, regardless of size.
    const outerTargetRadius =
      effectMaxRadius * rippleSettings.clickAnimationStopPoint;
    const coreJitterPx = (effect.radiusFactor - 0.5) * 4;
    const coreRadius = Math.max(
      1,
      Math.min(
        rippleSettings.clickCoreRadius + coreJitterPx,
        outerTargetRadius,
      ),
    );
    const expansionVelocity = outerTargetRadius / expansionDuration;

    const rings = Array.from({ length: numRings }, (_, i) => {
      const ringStartTime = effect.startTime + i * ringStaggerMs;
      const elapsed = now - ringStartTime;

      if (elapsed < 0) return null;

      // Innermost ring sits at the core mark; outer rings interpolate
      // linearly from core out to outerTargetRadius. With numRings === 1
      // the lone ring goes all the way out (otherwise it'd be a tiny dot).
      const ringTargetRadius =
        numRings === 1
          ? outerTargetRadius
          : coreRadius +
            (outerTargetRadius - coreRadius) * (i / (numRings - 1));

      const ringDuration = Math.max(1, ringTargetRadius / expansionVelocity);
      const rawProgress = Math.min(1, elapsed / ringDuration);
      const ringRadius = ringTargetRadius * easeOutCubic(rawProgress);

      return (
        <circle
          key={i}
          cx={effect.x}
          cy={effect.y}
          r={ringRadius}
          fill="none"
          stroke={effect.color}
          strokeWidth={rippleSettings.clickStrokeWidth}
          opacity={Math.max(0, rippleSettings.clickOpacity)}
          style={{ mixBlendMode: "multiply" }}
        />
      );
    });

    return <g>{rings}</g>;
  },
);
