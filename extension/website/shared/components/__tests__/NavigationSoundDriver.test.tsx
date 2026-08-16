// ABOUTME: Verifies the navigation accent fires off the playback clock in any view
// ABOUTME: including loop retriggering and staying silent without an engine

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SoundEngine } from "../../sound/SoundEngine";
import { NavigationSoundDriver } from "../MovementCanvas";
import type { ScheduledNavigation } from "../../utils/navigationSchedule";

const CYCLE_MS = 10000;

const schedule: ScheduledNavigation[] = [
  { atMs: 1000, ts: 1000, pid: "a" },
  { atMs: 5000, ts: 5000, pid: "a" },
  { atMs: 9000, ts: 9000, pid: "a" },
];

let frames: FrameRequestCallback[] = [];

function renderDriver(soundEngine: SoundEngine | null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(NavigationSoundDriver, {
        schedule,
        durationMs: CYCLE_MS,
        animationSpeed: 1,
        soundEngine,
      }),
    );
  });
  return { root, container };
}

/** Advance the driver's own rAF loop to an absolute timestamp. */
function advanceTo(ms: number) {
  act(() => {
    const pending = frames;
    frames = [];
    pending.forEach((cb) => cb(ms));
  });
}

beforeEach(() => {
  const testGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  frames = [];
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeEngine() {
  return { triggerNavigation: vi.fn() } as unknown as SoundEngine & {
    triggerNavigation: ReturnType<typeof vi.fn>;
  };
}

describe("NavigationSoundDriver", () => {
  it("sounds each moment as playback crosses it", () => {
    const engine = fakeEngine();
    const { root, container } = renderDriver(engine);

    // First frame establishes the clock origin at t=0.
    advanceTo(0);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(0);

    advanceTo(1500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(1);

    advanceTo(5500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(2);

    advanceTo(9500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(3);

    act(() => root.unmount());
    container.remove();
  });

  it("retriggers on the next loop pass", () => {
    const engine = fakeEngine();
    const { root, container } = renderDriver(engine);

    advanceTo(0);
    advanceTo(9500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(3);

    // Wrap past the cycle end back to the head: the 1000ms moment plays again.
    advanceTo(11500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(4);

    act(() => root.unmount());
    container.remove();
  });

  it("stays silent with no engine", () => {
    const { root, container } = renderDriver(null);
    // With no engine the effect returns before scheduling any frame.
    expect(frames).toHaveLength(0);
    act(() => root.unmount());
    container.remove();
  });
});
