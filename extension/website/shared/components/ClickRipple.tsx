// ABOUTME: Shared ripple effect for click/hold visualization
// ABOUTME: Used by AnimatedTrails and AnimatedClicks so ripple logic stays DRY
import { useEffect, useRef, memo, useMemo } from "react";
import { ClickEffect } from "../types";
import { subscribeRippleFrame } from "./rippleFrames";

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
    completedAt,
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
    const circlesRef = useRef<Array<SVGCircleElement | null>>([]);
    /** Tracks completion across repeated effect setup in Strict Mode. */
    const completedIdRef = useRef<string | null>(null);
    const onCompleteRef = useRef(onComplete);
    useEffect(() => {
      onCompleteRef.current = onComplete;
    }, [onComplete]);

    const geometry = useMemo(() => {
      const lifecycle = getRippleLifecycle(
        effect,
        rippleSettings,
        effect.startTime,
      );
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

        // Innermost ring sits at the core mark; outer rings interpolate
        // linearly from core out to outerTargetRadius. With numRings === 1
        // the lone ring goes all the way out (otherwise it'd be a tiny dot).
        const ringTargetRadius =
          numRings === 1
            ? outerTargetRadius
            : coreRadius +
              (outerTargetRadius - coreRadius) * (i / (numRings - 1));

        const ringDuration = Math.max(1, ringTargetRadius / expansionVelocity);
        return { ringStartTime, ringTargetRadius, ringDuration };
      });
      return { rings, lifecycle };
    }, [effect, rippleSettings]);

    useEffect(() => {
      const previousRadii = new Array<number>(geometry.rings.length);
      const previousVisibility = new Array<boolean>(geometry.rings.length);
      const update = (now: number) => {
        geometry.rings.forEach((ring, index) => {
          const elapsed = now - ring.ringStartTime;
          const visible = elapsed >= 0;
          const circle = circlesRef.current[index];
          if (circle && previousVisibility[index] !== visible) {
            circle.style.display = visible ? "" : "none";
            previousVisibility[index] = visible;
          }
          const progress = Math.max(
            0,
            Math.min(1, elapsed / ring.ringDuration),
          );
          const radius =
            ring.ringTargetRadius * (1 - Math.pow(1 - progress, 3));
          if (previousRadii[index] !== radius) {
            circlesRef.current[index]?.setAttribute("r", String(radius));
            previousRadii[index] = radius;
          }
        });
        const complete = now >= geometry.lifecycle.completedAt;
        if (complete && completedIdRef.current !== effect.id) {
          completedIdRef.current = effect.id;
          onCompleteRef.current?.(effect.id);
        }
        return !complete;
      };
      if (!update(Date.now())) return;
      return subscribeRippleFrame(update);
    }, [effect, rippleSettings, geometry]);

    const rings = geometry.rings.map((_, i) => {
      return (
        <circle
          key={i}
          ref={(circle) => {
            circlesRef.current[i] = circle;
          }}
          cx={effect.x}
          cy={effect.y}
          r={0}
          fill="none"
          stroke={effect.color}
          strokeWidth={rippleSettings.clickStrokeWidth}
          opacity={Math.max(0, geometry.lifecycle.opacity)}
          style={{ mixBlendMode: "multiply", display: "none" }}
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
