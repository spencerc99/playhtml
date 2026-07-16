// ABOUTME: Tests one-shot click spawning for the live cursor-trail renderer.
// ABOUTME: Covers trail growth without replaying clicks already shown.

import { describe, expect, it, vi } from "vitest";
import type { TrailState } from "../../types";
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
