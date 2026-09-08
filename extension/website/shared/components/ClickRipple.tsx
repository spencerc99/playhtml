// ABOUTME: Shared ripple effect for click/hold visualization
// ABOUTME: Used by AnimatedTrails and AnimatedClicks so ripple logic stays DRY
import { useEffect, useRef, memo } from "react";
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

export function getRippleLifecycle(
  effect: ClickEffect,
  rippleSettings: RippleSettings,
  now: number,
) {
  const holdMultiplier = effect.holdDuration
    ? Math.min(MAX_HOLD_MULTIPLIER, 1 + effect.holdDuration / 1000)
    : 1;
  const baseTotalDuration =
    rippleSettings.clickMinDuration +
    effect.durationFactor *
      (rippleSettings.clickMaxDuration - rippleSettings.clickMinDuration);
  const effectTotalDuration = baseTotalDuration * holdMultiplier;
  const expansionDuration =
    rippleSettings.clickExpansionDuration * holdMultiplier;
  const outerRingStartDelay =
    Math.max(0, rippleSettings.clickNumRings - 1) *
    rippleSettings.clickRingDelayMs;
  const completedAt =
    effect.startTime +
    Math.max(effectTotalDuration, outerRingStartDelay + expansionDuration);

  return {
    holdMultiplier,
    effectTotalDuration,
    expansionDuration,
    opacity: rippleSettings.clickOpacity,
    complete: now >= completedAt,
  };
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
    const now = Date.now();
    const ringRefs = useRef<Array<SVGCircleElement | null>>([]);
    /** Ensures onComplete runs once even when effects restart in Strict Mode. */
    const completionFiredRef = useRef(false);
    const completionIdRef = useRef(effect.id);

    const lifecycle = getRippleLifecycle(effect, rippleSettings, now);
    const { holdMultiplier, expansionDuration } = lifecycle;

    const baseMaxRadius =
      rippleSettings.clickMinRadius +
      effect.radiusFactor *
        (rippleSettings.clickMaxRadius - rippleSettings.clickMinRadius);
    const effectMaxRadius = baseMaxRadius * holdMultiplier;

    // Honor the configured ring delay directly — staggering is when each ring
    // BEGINS expanding. The visual density comes from each ring freezing at
    // a different target radius (see ring rendering below), not time stagger.
    const ringStaggerMs = rippleSettings.clickRingDelayMs;
    const numRings = Math.max(1, rippleSettings.clickNumRings);

    useEffect(() => {
      if (completionIdRef.current !== effect.id) {
        completionIdRef.current = effect.id;
        completionFiredRef.current = false;
      }
    }, [effect.id]);

    useEffect(() => {
      let animationFrameId: number;

      const animate = () => {
        const timestamp = Date.now();
        for (let i = 0; i < numRings; i++) {
          const ring = ringRefs.current[i];
          if (!ring) continue;
          const radius = getRingRadius(i, timestamp);
          if (radius === null) {
            ring.style.display = "none";
          } else {
            ring.style.display = "";
            const value = String(radius);
            if (ring.getAttribute("r") !== value) ring.setAttribute("r", value);
          }
        }
        if (getRippleLifecycle(effect, rippleSettings, timestamp).complete) {
          if (!completionFiredRef.current) {
            completionFiredRef.current = true;
            onComplete?.(effect.id);
          }
        } else {
          animationFrameId = requestAnimationFrame(animate);
        }
      };

      animate();

      return () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
      };
    }, [effect, rippleSettings, onComplete]);

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

    const getRingRadius = (i: number, timestamp: number): number | null => {
      const ringStartTime = effect.startTime + i * ringStaggerMs;
      const elapsed = timestamp - ringStartTime;

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
      return ringTargetRadius * easeOutCubic(rawProgress);
    };

    const rings = Array.from({ length: numRings }, (_, i) => {
      const ringRadius = getRingRadius(i, now);
      return (
        <circle
          key={i}
          ref={(ring) => {
            ringRefs.current[i] = ring;
          }}
          cx={effect.x}
          cy={effect.y}
          r={ringRadius ?? 0}
          fill="none"
          stroke={effect.color}
          strokeWidth={rippleSettings.clickStrokeWidth}
          opacity={Math.max(0, lifecycle.opacity)}
          style={{
            mixBlendMode: "multiply",
            display: ringRadius === null ? "none" : "",
          }}
        />
      );
    });

    return <g>{rings}</g>;
  },
  (previous, next) =>
    previous.effect === next.effect &&
    previous.onComplete === next.onComplete &&
    previous.settings.clickMinRadius === next.settings.clickMinRadius &&
    previous.settings.clickMaxRadius === next.settings.clickMaxRadius &&
    previous.settings.clickCoreRadius === next.settings.clickCoreRadius &&
    previous.settings.clickMinDuration === next.settings.clickMinDuration &&
    previous.settings.clickMaxDuration === next.settings.clickMaxDuration &&
    previous.settings.clickExpansionDuration ===
      next.settings.clickExpansionDuration &&
    previous.settings.clickStrokeWidth === next.settings.clickStrokeWidth &&
    previous.settings.clickOpacity === next.settings.clickOpacity &&
    previous.settings.clickNumRings === next.settings.clickNumRings &&
    previous.settings.clickRingDelayMs === next.settings.clickRingDelayMs &&
    previous.settings.clickAnimationStopPoint ===
      next.settings.clickAnimationStopPoint,
);
