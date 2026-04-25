// ABOUTME: Standalone click/hold ripple visualizer
// ABOUTME: Uses same ripple logic as AnimatedTrails but renders only ripples (no trails/path/cursor)
import React, { useState, useEffect, useRef, memo, useCallback } from "react";
import { ClickEffect } from "../types";
import { RippleEffect, RippleSettings } from "./ClickRipple";
import type { SoundEngine } from "../sound/SoundEngine";

// Hidden tabs heavily throttle rAF; 100ms (~10fps) keeps audio/time progression
// alive without spending too much background CPU. Mirrors AnimatedTrails.
const HIDDEN_TAB_TICK_MS = 100;

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
  soundEngine?: SoundEngine | null;
}

export const AnimatedClicks: React.FC<AnimatedClicksProps> = memo(
  ({ scheduledClicks, timeRange, settings, soundEngine = null }) => {
    const [activeClickEffects, setActiveClickEffects] = useState<ClickEffect[]>(
      [],
    );
    const animationRef = useRef<number>();
    const timeoutRef = useRef<number>();
    const spawnedThisCycleRef = useRef<Set<string>>(new Set());

    const animationSpeedRef = useRef(settings.animationSpeed);
    useEffect(() => {
      animationSpeedRef.current = settings.animationSpeed;
    }, [settings.animationSpeed]);

    const soundEngineRef = useRef(soundEngine);
    useEffect(() => {
      soundEngineRef.current = soundEngine;
    }, [soundEngine]);

    // Ripples persist after their animation finishes — they only clear when
    // the whole scene resets (data change, resize, or cycle restart).
    // We do count completions so the rAF loop knows when every spawned ripple
    // has finished animating and the cycle is safe to restart.
    const finishedCountRef = useRef(0);
    const handleClickComplete = useCallback((_id: string) => {
      finishedCountRef.current += 1;
    }, []);

    const spawnedCountRef = useRef(0);

    // Microtask-batched commits so multiple per-frame spawns don't each cause
    // their own React re-render.
    const pendingSpawnsRef = useRef<ClickEffect[]>([]);
    const flushSpawnsScheduledRef = useRef(false);
    const scheduleFlushSpawns = useCallback(() => {
      if (flushSpawnsScheduledRef.current) return;
      flushSpawnsScheduledRef.current = true;
      queueMicrotask(() => {
        flushSpawnsScheduledRef.current = false;
        const batch = pendingSpawnsRef.current;
        if (batch.length === 0) return;
        pendingSpawnsRef.current = [];
        setActiveClickEffects((prev) => [...prev, ...batch]);
      });
    }, []);

    // Animation loop. Time advances freely past `timeRange.duration`; we only
    // restart the cycle once every scheduled click has spawned AND every
    // rendered ripple has finished, so the loop reads as one smooth pass.
    // Spawning happens inline in the rAF callback (not a separate effect) so
    // effect-ordering quirks can't replay a burst of bells when
    // `scheduledClicks` changes identity.
    useEffect(() => {
      if (scheduledClicks.length === 0 || timeRange.duration <= 0) {
        setActiveClickEffects([]);
        spawnedThisCycleRef.current.clear();
        return;
      }

      // Reset state when clicks or duration change so we don't carry ripples
      // anchored to stale x/y coordinates after a resize / refetch.
      spawnedThisCycleRef.current.clear();
      finishedCountRef.current = 0;
      spawnedCountRef.current = 0;
      setActiveClickEffects([]);
      soundEngineRef.current?.reset();
      pendingSpawnsRef.current = [];

      let startTime: number | null = null;

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

      // When the tab is hidden, browsers throttle rAF to ~1fps which stalls
      // the click cycle and stops triggering bells in time. Fall back to a
      // setTimeout tick so the timeline (and audio) keeps progressing.
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

        const realElapsed = timestamp - startTime;
        const scaledElapsed = realElapsed * animationSpeedRef.current;

        const spawned = spawnedThisCycleRef.current;
        for (const sc of scheduledClicks) {
          if (scaledElapsed >= sc.spawnAtMs && !spawned.has(sc.id)) {
            spawned.add(sc.id);
            spawnedCountRef.current += 1;
            soundEngineRef.current?.triggerClick({
              x: sc.x,
              y: sc.y,
              holdDuration: sc.holdDuration,
            });
            pendingSpawnsRef.current.push({
              id: `${sc.id}-${timestamp}`,
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
        }
        if (pendingSpawnsRef.current.length > 0) {
          scheduleFlushSpawns();
        }

        const allSpawned = scaledElapsed >= timeRange.duration;
        const allDone =
          spawnedCountRef.current > 0 &&
          finishedCountRef.current >= spawnedCountRef.current;

        if (allSpawned && allDone) {
          startTime = timestamp;
          spawnedThisCycleRef.current.clear();
          finishedCountRef.current = 0;
          spawnedCountRef.current = 0;
          setActiveClickEffects([]);
          soundEngineRef.current?.reset();
        }

        scheduleNextFrame();
      };

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
        // Drop pending spawns so a queued microtask cannot commit after unmount.
        pendingSpawnsRef.current = [];
        flushSpawnsScheduledRef.current = false;
      };
    }, [scheduledClicks, timeRange.duration, scheduleFlushSpawns]);

    const rippleSettings: RippleSettings = {
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
            onComplete={handleClickComplete}
          />
        ))}
      </svg>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.scheduledClicks === nextProps.scheduledClicks &&
      prevProps.timeRange.duration === nextProps.timeRange.duration &&
      prevProps.settings.animationSpeed === nextProps.settings.animationSpeed &&
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
        nextProps.settings.clickAnimationStopPoint &&
      prevProps.soundEngine === nextProps.soundEngine
    );
  },
);
