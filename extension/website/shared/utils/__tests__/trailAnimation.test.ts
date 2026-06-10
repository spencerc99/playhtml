// ABOUTME: Tests performance-oriented trail animation planning helpers.
// ABOUTME: Verifies optimized frame selection preserves existing visual timing.

import { describe, expect, it } from "vitest";
import {
  buildFreehandPathSegment,
  buildStraightPathSegment,
  getFinishedTrailRenderRange,
} from "../trailAnimation";

describe("buildStraightPathSegment", () => {
  it("builds the same straight path shape with an interpolated head point", () => {
    const path = buildStraightPathSegment(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 10 },
      ],
      0,
      2,
      { x: 25, y: 15 },
    );

    expect(path).toBe("M 0 0 L 10 0 L 20 10 L 25 15");
  });
});

describe("buildFreehandPathSegment", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 10 },
    { x: 30, y: 25 },
  ];

  it("builds a closed filled outline around the point window", () => {
    const path = buildFreehandPathSegment(points, 0, 3, 4, true);

    expect(path.startsWith("M ")).toBe(true);
    expect(path.endsWith(" Z")).toBe(true);
    expect(path).toContain("Q");
  });

  it("includes the interpolated head in the outline", () => {
    const withoutHead = buildFreehandPathSegment(points, 0, 2, 4, false);
    const withHead = buildFreehandPathSegment(points, 0, 2, 4, false, {
      x: 25,
      y: 15,
    });

    expect(withHead).not.toBe(withoutHead);
  });

  it("bakes the stroke size into the geometry", () => {
    const thin = buildFreehandPathSegment(points, 0, 3, 2, true);
    const thick = buildFreehandPathSegment(points, 0, 3, 8, true);

    expect(thick).not.toBe(thin);
  });

  it("returns an empty path for an empty window", () => {
    expect(buildFreehandPathSegment(points, 2, 1, 4, true)).toBe("");
    expect(buildFreehandPathSegment([], 0, 0, 4, true)).toBe("");
  });
});

describe("getFinishedTrailRenderRange", () => {
  const sortedFinishOrder = [
    { originalIndex: 0, finishedAtMs: 100 },
    { originalIndex: 1, finishedAtMs: 200 },
    { originalIndex: 2, finishedAtMs: 300 },
    { originalIndex: 3, finishedAtMs: 400 },
    { originalIndex: 4, finishedAtMs: 500 },
  ];

  it("keeps the visible finished window plus trails still fading after eviction", () => {
    expect(getFinishedTrailRenderRange(sortedFinishOrder, 550, 2, 3000)).toEqual(
      {
        start: 0,
        end: 5,
        finishedCount: 5,
      },
    );
  });

  it("skips finished trails whose eviction fade has completed", () => {
    expect(
      getFinishedTrailRenderRange(sortedFinishOrder, 3500, 2, 3000),
    ).toEqual({
      start: 3,
      end: 5,
      finishedCount: 5,
    });
  });
});
