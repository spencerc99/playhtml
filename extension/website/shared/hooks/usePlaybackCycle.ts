// ABOUTME: Drives one finite archive playback cycle independently of its visuals.
// ABOUTME: Advances only when the next event batch is ready, then restarts by key.

import { useEffect, useRef } from "react";

const HIDDEN_TAB_TICK_MS = 100;

export function usePlaybackCycle(params: {
  enabled: boolean;
  cycleKey: string;
  durationMs: number;
  animationSpeed: number;
  frozen: boolean;
  onComplete?: () => boolean;
}): void {
  const { enabled, cycleKey, durationMs, animationSpeed, frozen, onComplete } =
    params;
  const animationSpeedRef = useRef(animationSpeed);
  const frozenRef = useRef(frozen);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    animationSpeedRef.current = animationSpeed;
  }, [animationSpeed]);
  useEffect(() => {
    frozenRef.current = frozen;
  }, [frozen]);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!enabled || durationMs <= 0) return;

    let animationFrame: number | undefined;
    let timeout: number | undefined;
    let previousTimestamp: number | null = null;
    let elapsedMs = 0;

    const clearScheduledFrame = () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      if (timeout !== undefined) window.clearTimeout(timeout);
      animationFrame = undefined;
      timeout = undefined;
    };

    const scheduleNextFrame = () => {
      clearScheduledFrame();
      if (document.visibilityState === "hidden") {
        timeout = window.setTimeout(
          () => animate(performance.now()),
          HIDDEN_TAB_TICK_MS,
        );
        return;
      }
      animationFrame = requestAnimationFrame(animate);
    };

    const animate = (timestamp: number) => {
      if (previousTimestamp === null) previousTimestamp = timestamp;
      const frameDelta = Math.min(250, timestamp - previousTimestamp);
      previousTimestamp = timestamp;

      if (!frozenRef.current) {
        elapsedMs += frameDelta * animationSpeedRef.current;
      }

      if (elapsedMs >= durationMs) {
        if (onCompleteRef.current?.()) return;
        elapsedMs %= durationMs;
      }

      scheduleNextFrame();
    };

    const handleVisibilityChange = () => scheduleNextFrame();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleNextFrame();
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearScheduledFrame();
    };
  }, [enabled, cycleKey, durationMs]);
}
