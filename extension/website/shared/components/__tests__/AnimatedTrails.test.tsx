// ABOUTME: Tests archive trail audio behavior across active and silent frames.
// ABOUTME: Verifies inactive playback releases sustained sound-engine voices.
// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TrailState } from "../../types";
import type { SoundEngine } from "../../sound/SoundEngine";
import { AnimatedTrails } from "../AnimatedTrails";
import { TrailPositions } from "../trailPositions";
import { DEFAULT_SETTINGS } from "../settingsDefaults";

describe("AnimatedTrails sound", () => {
  it("ticks the sound engine when no trail is active", async () => {
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

    const trailState: TrailState = {
      trail: {
        id: "trail",
        pid: "participant",
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
      startOffsetMs: 1000,
      durationMs: 1000,
      variedPoints: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      clicksWithProgress: [],
    };
    const soundEngine = {
      isEnabled: vi.fn(() => true),
      reset: vi.fn(),
      tick: vi.fn(),
      // The draw loop asks each trail how far through its phrase its voice is,
      // so the drawing can breathe with it. Null is the unphrased answer.
      getArticulation: vi.fn(() => null),
    } as unknown as SoundEngine;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(AnimatedTrails, {
          trailStates: [trailState],
          timeRange: { min: 0, max: 3000, duration: 3000 },
          showClickRipples: false,
          soundEngine,
          settings: DEFAULT_SETTINGS,
        }),
      );
    });

    act(() => scheduledFrames.shift()?.(1000));

    expect(soundEngine.tick).toHaveBeenCalledWith(0, []);

    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    delete testGlobal.IS_REACT_ACT_ENVIRONMENT;
  });

  it("starts each pass through the data from a clean scene", async () => {
    // A loop wrap is the same fresh start the first pass gets. Positions left
    // over from the pass that just ended would steer the new pass's first
    // gongs to where a participant was rather than where they are.
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

    const trailState: TrailState = {
      trail: {
        id: "trail",
        pid: "participant",
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
      clicksWithProgress: [],
    };
    // A second participant who only moves in the back half of the cycle. Once
    // playback rewinds this trail is not being drawn, so nothing republishes
    // its position — whatever is left is what survived the wrap.
    const lateTrailState: TrailState = {
      trail: {
        id: "late-trail",
        pid: "late-participant",
        points: [
          { x: 600, y: 600, ts: 600 },
          { x: 700, y: 700, ts: 1000 },
        ],
        color: "#abcdef",
        opacity: 1,
        startTime: 600,
        endTime: 1000,
        clicks: [],
      },
      startOffsetMs: 600,
      durationMs: 400,
      variedPoints: [
        { x: 600, y: 600 },
        { x: 700, y: 700 },
      ],
      clicksWithProgress: [],
    };
    const soundEngine = {
      isEnabled: vi.fn(() => true),
      reset: vi.fn(),
      tick: vi.fn(),
      // The draw loop asks each trail how far through its phrase its voice is,
      // so the drawing can breathe with it. Null is the unphrased answer.
      getArticulation: vi.fn(() => null),
    } as unknown as SoundEngine;
    const trailPositions = new TrailPositions();
    const playbackClock = { loopedMs: 0 };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(AnimatedTrails, {
          trailStates: [trailState, lateTrailState],
          timeRange: { min: 0, max: 1000, duration: 1000 },
          showClickRipples: false,
          soundEngine,
          settings: DEFAULT_SETTINGS,
          trailPositions,
          playbackClock,
        }),
      );
    });

    // Frame deltas are clamped to 250ms, so the cycle is crossed by stepping
    // rather than by one jump. Run until the published clock rewinds.
    let timestamp = 0;
    act(() => scheduledFrames.shift()?.(timestamp));
    let previous = playbackClock.loopedMs;
    let wrapped = false;
    let lateSeenBeforeWrap = false;
    for (let step = 0; step < 20 && !wrapped; step++) {
      timestamp += 200;
      act(() => scheduledFrames.shift()?.(timestamp));
      if (trailPositions.forParticipant("late-participant")) {
        lateSeenBeforeWrap = true;
      }
      wrapped = playbackClock.loopedMs < previous;
      previous = playbackClock.loopedMs;
    }

    // The clock wrapped, and the scene was emptied along with it.
    expect(wrapped).toBe(true);
    // The late participant was on the canvas during the pass that just ended,
    // and is not being drawn at the top of the new one. Its position is gone
    // rather than left pointing at the far corner it reached last pass.
    expect(lateSeenBeforeWrap).toBe(true);
    expect(trailPositions.forParticipant("late-participant")).toBeNull();

    // The participant who is drawn across the whole cycle is republished by
    // the same frame that cleared, at where the new pass has it — the trail
    // runs (0,0) to (100,100), so the start of a pass is near the origin.
    const afterWrap = trailPositions.forParticipant("participant");
    expect(afterWrap).not.toBeNull();
    expect(afterWrap?.x).toBeLessThan(50);
    expect(afterWrap?.y).toBeLessThan(50);

    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    delete testGlobal.IS_REACT_ACT_ENVIRONMENT;
  });
});
