// ABOUTME: Tests archive trail audio behavior across active and silent frames.
// ABOUTME: Verifies inactive playback releases sustained sound-engine voices.
// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TrailState } from "../../types";
import type { SoundEngine } from "../../sound/SoundEngine";
import { AnimatedTrails } from "../AnimatedTrails";
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
    } as unknown as SoundEngine;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(AnimatedTrails, {
          trailStates: [trailState],
          timeRange: { duration: 3000 },
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
});
