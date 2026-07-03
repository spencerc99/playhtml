// ABOUTME: Verifies pure timing helpers for artificial-user browser actions.
// ABOUTME: Keeps actor rhythm scaling bounded before Playwright actions use it.

import { describe, expect, test } from "bun:test";
import {
  chooseActionDelay,
  jitterPoint,
  scaleDuration,
} from "./actions";
import { createRandom } from "./random";

describe("scaleDuration", () => {
  test("scales action duration by persona tempo", () => {
    expect(scaleDuration(1000, 1.25)).toBe(1250);
    expect(scaleDuration(1000, 0.8)).toBe(800);
  });

  test("never returns a sub-frame duration", () => {
    expect(scaleDuration(1, 0.1)).toBe(25);
  });
});

describe("chooseActionDelay", () => {
  test("chooses a scaled delay inside a range", () => {
    const random = createRandom("delay");
    const delay = chooseActionDelay(random, { minMs: 200, maxMs: 500 }, 1.5);

    expect(delay).toBeGreaterThanOrEqual(300);
    expect(delay).toBeLessThanOrEqual(750);
  });
});

describe("jitterPoint", () => {
  test("returns a deterministic point inside the jitter radius", () => {
    const a = jitterPoint(
      createRandom("point"),
      { x: 100, y: 100 },
      20,
    );
    const b = jitterPoint(
      createRandom("point"),
      { x: 100, y: 100 },
      20,
    );

    expect(a).toEqual(b);
    expect(Math.hypot(a.x - 100, a.y - 100)).toBeLessThanOrEqual(20);
  });

  test("keeps jittered points inside bounds", () => {
    const point = jitterPoint(
      createRandom("bounds"),
      { x: 5, y: 5 },
      40,
      { minX: 0, maxX: 20, minY: 0, maxY: 20 },
    );

    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(20);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeLessThanOrEqual(20);
  });
});
