// ABOUTME: Tests click spawning and lifecycle timing for the live cursor-trail renderer.
// ABOUTME: Covers one-shot effects and clock pauses while the document is hidden.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TrailState } from "../../types";
import type { SoundEngine } from "../../sound/SoundEngine";
import { DEFAULT_SETTINGS } from "../settingsDefaults";
import {
  createLiveSoundFrame,
  getDrawClockTime,
  LiveTrails,
} from "../LiveTrails";
import {
  collectDueClickEffects,
  retainClickEffectsForActiveTrails,
} from "../clickEffects";

function trailState(): TrailState {
  return {
    trail: {
      id: "participant|https://example.com",
      points: [
        { x: 0, y: 0, ts: 0 },
        { x: 100, y: 100, ts: 1000 },
      ],
      color: "#123456",
      opacity: 1,
      startTime: 0,
      endTime: 1000,
      clicks: [],
    },
    startOffsetMs: 0,
    durationMs: 1000,
    variedPoints: [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
    clicksWithProgress: [
      { x: 25, y: 25, ts: 250, progress: 0.25 },
      { x: 75, y: 75, ts: 750, progress: 0.75, duration: 1200 },
    ],
  };
}

describe("collectDueClickEffects", () => {
  it("emits each click once as live playback reaches it", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const spawned = new Set<string>();
    const state = trailState();

    expect(
      collectDueClickEffects(
        state,
        0.2,
        spawned,
        { x: 10, y: 20 },
        "#abcdef",
        1000,
      ),
    ).toEqual([]);

    const firstEffects = collectDueClickEffects(
      state,
      0.5,
      spawned,
      { x: 30, y: 40 },
      "#abcdef",
      1000,
    );
    expect(firstEffects).toEqual([
      expect.objectContaining({
        id: "participant|https://example.com|250|0",
        trailId: "participant|https://example.com",
        x: 30,
        y: 40,
        color: "#abcdef",
        startTime: 1000,
      }),
    ]);

    expect(
      collectDueClickEffects(
        state,
        0.8,
        spawned,
        { x: 70, y: 80 },
        "#abcdef",
        1100,
      ),
    ).toEqual([
      expect.objectContaining({
        id: "participant|https://example.com|750|1",
        x: 70,
        y: 80,
        holdDuration: 1200,
        startTime: 1100,
      }),
    ]);

    expect(
      collectDueClickEffects(
        state,
        1,
        spawned,
        { x: 90, y: 100 },
        "#abcdef",
        1200,
      ),
    ).toEqual([]);

    expect(
      retainClickEffectsForActiveTrails(firstEffects, new Set(["other-trail"])),
    ).toBe(firstEffects);
    expect(
      retainClickEffectsForActiveTrails(
        firstEffects,
        new Set(["participant|https://example.com"]),
      ),
    ).toEqual([]);

    random.mockRestore();
  });
});

describe("getDrawClockTime", () => {
  it("freezes lifecycle time while a pause is active", () => {
    expect(getDrawClockTime(15_000, 2_000, 10_000)).toBe(8_000);
    expect(getDrawClockTime(30_000, 2_000, 10_000)).toBe(8_000);
  });

  it("resumes from the same lifecycle time after accounting for the pause", () => {
    expect(getDrawClockTime(30_000, 22_000, null)).toBe(8_000);
  });
});

describe("createLiveSoundFrame", () => {
  it("maps the live draw head to the current cursor instrument", () => {
    const state = trailState();
    state.trail.points[0].cursor = "pointer";
    state.trail.points[1].cursor = "text";

    expect(
      createLiveSoundFrame(7, state, { x: 75, y: 80 }, 1),
    ).toEqual({
      trailIndex: 7,
      x: 75,
      y: 80,
      prevX: 75,
      prevY: 80,
      cursorType: "text",
      progress: 1,
      color: "#123456",
      isNewlyActive: false,
    });
  });
});

describe("LiveTrails sound", () => {
  it("feeds active live draw heads to the sound engine", async () => {
    const testGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const state = trailState();
    state.trail.points[0].cursor = "pointer";
    const soundEngine = {
      tick: vi.fn(),
      triggerClick: vi.fn(),
      retireTrail: vi.fn(),
    } as unknown as SoundEngine;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(LiveTrails, {
          trailStates: [state],
          soundEngine,
          settings: DEFAULT_SETTINGS,
        }),
      );
    });

    act(() => scheduledFrames.shift()?.(1000));
    act(() => scheduledFrames.shift()?.(1600));

    expect(soundEngine.tick).toHaveBeenLastCalledWith(1600, [
      expect.objectContaining({
        trailIndex: 0,
        cursorType: "pointer",
        progress: 0.6,
      }),
    ]);

    await act(async () => {
      root.render(
        React.createElement(LiveTrails, {
          trailStates: [state],
          frozen: true,
          soundEngine,
          settings: DEFAULT_SETTINGS,
        }),
      );
    });
    act(() => scheduledFrames.shift()?.(1700));

    expect(soundEngine.tick).toHaveBeenLastCalledWith(1700, []);

    await act(async () => root.unmount());
    expect(soundEngine.retireTrail).toHaveBeenCalledWith(0);
    container.remove();
    vi.unstubAllGlobals();
    delete testGlobal.IS_REACT_ACT_ENVIRONMENT;
  });
});
