// ABOUTME: Tests the pure live-trail windowing: which trails draw, finish, and
// ABOUTME: stay visible under a monotonic clock as the trail set grows.

import { describe, it, expect } from "vitest";
import { computeLiveTrailWindow, type LiveTrailTiming } from "../trailAnimation";

function timing(startMs: number): LiveTrailTiming {
  return { startMs, durationMs: 1000 };
}

describe("computeLiveTrailWindow", () => {
  it("includes a trail that is currently drawing", () => {
    const r = computeLiveTrailWindow([timing(0)], 500, 50, 3000);
    expect(r.drawing).toContain(0);
    expect(r.finished).not.toContain(0);
  });

  it("moves a trail to finished after its duration elapses", () => {
    const r = computeLiveTrailWindow([timing(0)], 1500, 50, 3000);
    expect(r.drawing).not.toContain(0);
    expect(r.finished).toContain(0);
  });

  it("does not include a trail before its start", () => {
    const r = computeLiveTrailWindow([timing(1000)], 200, 50, 3000);
    expect(r.drawing).not.toContain(0);
    expect(r.finished).not.toContain(0);
  });

  it("evicts the oldest finished trail beyond windowSize once fade elapsed", () => {
    const trails = [timing(0), timing(100), timing(200)];
    const r = computeLiveTrailWindow(trails, 10_000, 1, 3000);
    expect(r.finished).toContain(2);
    expect(r.finished).not.toContain(0);
    expect(r.finished).not.toContain(1);
  });

  it("handles appended later-starting trails without disturbing earlier ones", () => {
    const r = computeLiveTrailWindow([timing(0), timing(5000)], 5500, 50, 3000);
    expect(r.drawing).toContain(1);
    expect(r.finished).toContain(0);
  });
});
