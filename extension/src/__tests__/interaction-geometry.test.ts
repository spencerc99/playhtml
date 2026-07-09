// ABOUTME: Tests the pure angle/distance/travel geometry used by InteractionRenderer.
// ABOUTME: No DOM.
import { describe, it, expect } from "vitest";
import {
  angleDeg,
  distance,
  travelToward,
  midpoint,
} from "../features/emotes/interaction-geometry";

describe("angleDeg", () => {
  it("points right at 0deg, down at 90deg", () => {
    expect(angleDeg({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0);
    expect(angleDeg({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(90);
    expect(angleDeg({ x: 0, y: 0 }, { x: -10, y: 0 })).toBeCloseTo(180);
  });
});

describe("distance", () => {
  it("computes euclidean distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("travelToward", () => {
  it("moves the requested distance along the angle when there's room", () => {
    const p = travelToward({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, 120);
    expect(p.x).toBeCloseTo(20);
    expect(p.y).toBeCloseTo(0);
  });

  it("caps at maxDist even if the gap is larger", () => {
    const p = travelToward({ x: 0, y: 0 }, { x: 1000, y: 0 }, 500, 120);
    expect(p.x).toBeCloseTo(120);
  });

  it("caps at the actual gap so it stops at the target, not past it", () => {
    const p = travelToward({ x: 0, y: 0 }, { x: 50, y: 0 }, 500, 120);
    expect(p.x).toBeCloseTo(50);
  });
});

describe("midpoint", () => {
  it("averages both points", () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });
});
