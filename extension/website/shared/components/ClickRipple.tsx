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

const MAX_HOLD_MULTIPLIER = 3;

export function getHoldMultiplier(holdDuration?: number): number {
  return holdDuration
    ? Math.min(MAX_HOLD_MULTIPLIER, 1 + holdDuration / 1000)
    : 1;
}

export function getRippleMaxRadius(
  radiusFactor: number,
  holdDuration: number | undefined,
  settings: Pick<RippleSettings, "clickMinRadius" | "clickMaxRadius">,
): number {
  const baseMaxRadius =
    settings.clickMinRadius +
    radiusFactor * (settings.clickMaxRadius - settings.clickMinRadius);
  return Math.min(
    settings.clickMaxRadius,
    baseMaxRadius * getHoldMultiplier(holdDuration),
  );
}

export function getRippleRingCount(
  ringCountFactor: number,
  settings: Pick<RippleSettings, "clickNumRings">,
): number {
  const maximumRingCount = Math.max(2, Math.round(settings.clickNumRings));
  const boundedFactor = Math.max(0, Math.min(1, ringCountFactor));
  return Math.min(
    maximumRingCount,
    2 + Math.floor(boundedFactor * (maximumRingCount - 1)),
  );
}

export function getRippleTargetRadii(
  effect: Pick<
    ClickEffect,
    "radiusFactor" | "ringCountFactor" | "holdDuration"
  >,
  settings: RippleSettings,
): number[] {
  const effectMaxRadius = getRippleMaxRadius(
    effect.radiusFactor,
    effect.holdDuration,
    settings,
  );
  const outerTargetRadius =
    effectMaxRadius * settings.clickAnimationStopPoint;
  const coreJitterPx = (effect.radiusFactor - 0.5) * 4;
  const coreRadius = Math.max(
    1,
    Math.min(settings.clickCoreRadius + coreJitterPx, outerTargetRadius),
  );
  const numRings = getRippleRingCount(effect.ringCountFactor, settings);

  return Array.from({ length: numRings }, (_, index) =>
    numRings === 1
      ? outerTargetRadius
      : coreRadius +
        (outerTargetRadius - coreRadius) * (index / (numRings - 1)),
  );
}

export function hasRippleCompleted(
  elapsed: number,
  effectTotalDuration: number,
  expansionDuration: number,
  numRings: number,
  ringStaggerMs: number,
): boolean {
  const outerRingElapsed = elapsed - (numRings - 1) * ringStaggerMs;
  return (
    elapsed >= effectTotalDuration && outerRingElapsed >= expansionDuration
  );
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

    // Scale holds up to the configured visual ceiling. The multiplier matches
    // the bounded hold response used by click audio.
    const holdMultiplier = getHoldMultiplier(effect.holdDuration);
    const ringTargetRadii = getRippleTargetRadii(effect, rippleSettings);

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
    const numRings = ringTargetRadii.length;

    // The outermost ring travels the farthest, so it dictates when the whole
    // ripple has finished animating.
    const allRingsComplete = useMemo(() => {
      const totalElapsed = now - effect.startTime;
      return hasRippleCompleted(
        totalElapsed,
        effectTotalDuration,
        expansionDuration,
        numRings,
        ringStaggerMs,
      );
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
    const outerTargetRadius = ringTargetRadii.at(-1) ?? 0;
    const expansionVelocity = outerTargetRadius / expansionDuration;

    const rings = ringTargetRadii.map((ringTargetRadius, i) => {
      const ringStartTime = effect.startTime + i * ringStaggerMs;
      const elapsed = now - ringStartTime;

      if (elapsed < 0) return null;

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
