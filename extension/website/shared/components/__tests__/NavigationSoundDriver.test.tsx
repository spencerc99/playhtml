// ABOUTME: Verifies the navigation accent fires off the trail layer's playback clock
// ABOUTME: when the trails view is active, and stays silent otherwise or without an engine

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
/** Stands in for the trail layer, which owns this object and writes it. */
let playbackClock = { loopedMs: 0 };

function renderDriver(soundEngine: SoundEngine | null, active = true) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(NavigationSoundDriver, {
        schedule,
        durationMs: CYCLE_MS,
        soundEngine,
        active,
        playbackClock,
      }),
    );
  });
  return { root, container };
}

/**
 * Move the trail layer's clock to a position in the cycle and let the driver
 * read it. The driver no longer keeps time itself, so the cycle position is
 * what a test sets rather than a wall-clock timestamp.
 */
function playbackAt(loopedMs: number) {
  playbackClock.loopedMs = loopedMs;
  act(() => {
    const pending = frames;
    frames = [];
    pending.forEach((cb) => cb(loopedMs));
  });
}

beforeEach(() => {
  const testGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  frames = [];
  playbackClock = { loopedMs: 0 };
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

    playbackAt(0);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(0);

    playbackAt(1500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(1);

    playbackAt(5500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(2);

    playbackAt(9500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(3);

    act(() => root.unmount());
    container.remove();
  });

  it("retriggers on the next loop pass", () => {
    const engine = fakeEngine();
    const { root, container } = renderDriver(engine);

    playbackAt(0);
    playbackAt(9500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(3);

    // The trail clock wraps to the head of the cycle. Every moment has to be
    // live again on the new pass, starting with the 1000ms one.
    playbackAt(1500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(4);

    playbackAt(5500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(5);
    playbackAt(9500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(6);

    act(() => root.unmount());
    container.remove();
  });

  it("follows the trail clock rather than keeping time of its own", () => {
    // The whole point of reading the shared clock: when the trail layer stalls
    // (a hidden tab, a long frame it clamps away) playback does not advance,
    // and the gongs must not advance either. A driver keeping its own wall
    // clock would sail past these moments while the trails stood still.
    const engine = fakeEngine();
    const { root, container } = renderDriver(engine);

    playbackAt(0);
    // Many frames pass, but the trail layer's position never moves.
    for (let i = 0; i < 30; i++) playbackAt(0);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(0);

    // It resumes exactly where the trails resume.
    playbackAt(1500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(1);

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

  it("stays silent when the trails view is not active", () => {
    const engine = fakeEngine();
    const { root, container } = renderDriver(engine, false);
    // Inactive: the effect returns before scheduling any frame.
    expect(frames).toHaveLength(0);

    playbackAt(0);
    playbackAt(9500);
    expect(engine.triggerNavigation).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it("stops scheduling frames once the trails view is deactivated", () => {
    const engine = fakeEngine();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(NavigationSoundDriver, {
          schedule,
          durationMs: CYCLE_MS,
          soundEngine: engine,
          active: true,
          playbackClock,
        }),
      );
    });

    playbackAt(0);
    playbackAt(1500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(1);
    expect(frames.length).toBeGreaterThan(0);

    act(() => {
      root.render(
        React.createElement(NavigationSoundDriver, {
          schedule,
          durationMs: CYCLE_MS,
          soundEngine: engine,
          active: false,
          playbackClock,
        }),
      );
    });

    // The inactive effect's cleanup cancels the in-flight frame and the new
    // effect returns before scheduling a replacement, so nothing is pending.
    frames = [];
    playbackAt(9500);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);

    act(() => root.unmount());
    container.remove();
  });
});
