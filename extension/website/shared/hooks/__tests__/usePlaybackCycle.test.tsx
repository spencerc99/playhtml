// ABOUTME: Exercises finite playback clocks through completion and visibility fades.
// ABOUTME: Keeps the current animation frame available while playback is paused.
// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { usePlaybackCycle } from "../usePlaybackCycle";

it("holds the current frame while fading and waits at the end for footage", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({
    toFake: ["performance", "requestAnimationFrame", "cancelAnimationFrame"],
  });
  const root = createRoot(document.createElement("div"));
  let elapsed = () => 0;
  function Probe({ frozen }: { frozen: boolean }) {
    elapsed = usePlaybackCycle({
      enabled: true,
      cycleKey: "batch",
      durationMs: 1000,
      animationSpeed: 1,
      frozen,
      onComplete: () => false,
    });
    return null;
  }
  try {
    await act(async () => root.render(<Probe frozen={false} />));
    act(() => vi.advanceTimersByTime(500));
    const fadingFrame = elapsed();
    expect(fadingFrame).toBeGreaterThan(0);
    await act(async () => root.render(<Probe frozen={true} />));
    act(() => vi.advanceTimersByTime(3000));
    expect(elapsed()).toBe(fadingFrame);
    await act(async () => root.render(<Probe frozen={false} />));
    act(() => vi.advanceTimersByTime(3000));
    expect(elapsed()).toBe(1000);
    act(() => vi.advanceTimersByTime(3000));
    expect(elapsed()).toBe(1000);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
