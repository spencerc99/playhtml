// ABOUTME: Tests rectangle splitting and clip-path generation for the scissors effect.
// ABOUTME: Covers horizontal, diagonal, degenerate, and non-intersecting cut geometry.

import { describe, expect, it } from "vitest";
import { cutRectangle, polygonClipPath } from "../features/scissors/geometry";

function area(points: Array<{ x: number; y: number }>): number {
  return Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
}

describe("scissors geometry", () => {
  it("splits a rectangle into two complete halves", () => {
    const cut = cutRectangle(100, 80, { x: 0, y: 40 }, { x: 100, y: 40 });

    expect(cut).not.toBeNull();
    expect(area(cut!.first)).toBeCloseTo(4000);
    expect(area(cut!.second)).toBeCloseTo(4000);
    expect(cut!.normal).toEqual({ x: -0, y: 1 });
  });

  it("extends a diagonal gesture as a line through the whole rectangle", () => {
    const cut = cutRectangle(120, 80, { x: 30, y: 20 }, { x: 90, y: 60 });

    expect(cut).not.toBeNull();
    expect(area(cut!.first) + area(cut!.second)).toBeCloseTo(9600);
  });

  it("rejects a line that misses the rectangle", () => {
    expect(
      cutRectangle(100, 80, { x: 0, y: -20 }, { x: 100, y: -20 }),
    ).toBeNull();
  });

  it("rejects a gesture without direction", () => {
    expect(
      cutRectangle(100, 80, { x: 20, y: 20 }, { x: 20, y: 20 }),
    ).toBeNull();
  });

  it("formats polygon points as percentages", () => {
    expect(
      polygonClipPath(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 50 },
        ],
        100,
        50,
      ),
    ).toBe("polygon(0% 0%, 100% 0%, 100% 100%)");
  });
});
