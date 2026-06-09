// ABOUTME: Locks the pure per-frame geometry of computeTrailFrame so primitive
// ABOUTME: extraction and future edits cannot silently change trail rendering.

import { describe, it, expect } from "vitest";
import { computeTrailFrame } from "../trailPrimitives";
import type { TrailState } from "../../types";

function trailState(): TrailState {
  const points = [
    { x: 0, y: 0, ts: 0 },
    { x: 100, y: 0, ts: 500 },
    { x: 100, y: 100, ts: 1000 },
  ];
  return {
    trail: {
      points,
      color: "#000",
      opacity: 1,
      startTime: 0,
      endTime: 1000,
      clicks: [],
    },
    startOffsetMs: 0,
    durationMs: 1000,
    variedPoints: points.map((p) => ({ x: p.x, y: p.y })),
    clicksWithProgress: [],
  } as TrailState;
}

describe("computeTrailFrame", () => {
  it("returns null before the trail starts", () => {
    expect(computeTrailFrame(trailState(), -10)).toBeNull();
  });

  it("marks the trail finished at/after its duration", () => {
    const frame = computeTrailFrame(trailState(), 1000);
    expect(frame).not.toBeNull();
    expect(frame!.isFinished).toBe(true);
    expect(frame!.trailProgress).toBe(1);
  });

  it("is mid-progress halfway through", () => {
    const frame = computeTrailFrame(trailState(), 500);
    expect(frame).not.toBeNull();
    expect(frame!.isFinished).toBe(false);
    expect(frame!.trailProgress).toBeGreaterThan(0);
    expect(frame!.trailProgress).toBeLessThan(1);
    expect(frame!.pathData.length).toBeGreaterThan(0);
  });
});
