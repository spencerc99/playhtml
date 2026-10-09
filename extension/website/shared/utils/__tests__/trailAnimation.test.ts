// ABOUTME: Tests performance-oriented trail animation planning helpers.
// ABOUTME: Verifies optimized frame selection preserves existing visual timing.

import { describe, expect, it } from "vitest";
import {
  buildFreehandPathSegment,
  buildStraightPathSegment,
  didPlaybackCycleWrap,
  getFinishedTrailRenderRange,
} from "../trailAnimation";

describe("didPlaybackCycleWrap", () => {
  it("detects the transition from the end of one batch to its beginning", () => {
    expect(didPlaybackCycleWrap(999, 0)).toBe(true);
    expect(didPlaybackCycleWrap(500, 600)).toBe(false);
  });
});

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

  it("can derive width variation from the cursor point spacing", () => {
    const evenlySpaced = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    const unevenlySpaced = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 5, y: 0 },
      { x: 30, y: 0 },
    ];
    const style = { thinning: 0.55, simulatePressure: true };

    expect(
      buildFreehandPathSegment(evenlySpaced, 0, 3, 4, true, undefined, style),
    ).not.toBe(
      buildFreehandPathSegment(unevenlySpaced, 0, 3, 4, true, undefined, style),
    );
  });

  it("returns an empty path for an empty window", () => {
    expect(buildFreehandPathSegment(points, 2, 1, 4, true)).toBe("");
    expect(buildFreehandPathSegment([], 0, 0, 4, true)).toBe("");
  });

  it("preserves every curve when replay grows, wraps, changes width, or moves its tail", () => {
    const trajectory = Array.from({ length: 1200 }, (_, i) => ({
      x: i * 2,
      y: 100 * Math.sin(i / 20),
    }));
    for (const [start, end, size, complete] of [
      [0, 100, 4, false],
      [0, 101, 4, false],
      [0, 400, 4, false],
      [0, 400, 8, false],
      [0, 999, 8, false],
      [1, 1000, 8, false],
      [200, 1199, 8, true],
      [0, 1, 4, false],
    ] as const) {
      const head = complete ? undefined : { x: trajectory[end].x + 1, y: 40 };
      const cached = buildFreehandPathSegment(
        trajectory,
        start,
        end,
        size,
        complete,
        head,
      );
      const uncached = buildFreehandPathSegment(
        [...trajectory],
        start,
        end,
        size,
        complete,
        head,
      );
      expect(cached).toBe(uncached);
    }
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
    expect(
      getFinishedTrailRenderRange(sortedFinishOrder, 550, 2, 3000),
    ).toEqual({
      start: 0,
      end: 5,
      finishedCount: 5,
    });
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

  it("matches eviction timing across tied finishes, empty windows, and exact fade boundaries", () => {
    const order = Array.from({ length: 100 }, (_, i) => ({
      originalIndex: i,
      finishedAtMs: Math.floor(i / 3) * 100,
    }));
    for (const windowSize of [0, 1, 24, 100, 200]) {
      for (const elapsed of [-1, 0, 99, 100, 3000, 3099, 3100, 6000, 10000]) {
        const finishedCount = order.filter(
          (entry) => entry.finishedAtMs <= elapsed,
        ).length;
        let start = 0;
        while (
          start < finishedCount - windowSize &&
          order[start + windowSize].finishedAtMs <= elapsed - 3000
        )
          start++;
        expect(
          getFinishedTrailRenderRange(order, elapsed, windowSize, 3000),
        ).toEqual({
          start,
          end: finishedCount,
          finishedCount,
        });
      }
    }
  });
});
