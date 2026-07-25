// ABOUTME: Tests cursor-trail scheduling helpers used by movement visualizations.
// ABOUTME: Verifies stagger playback can use constant-time schedule lookup.

import { describe, expect, it } from "vitest";
import { buildTrailSchedulePositionLookup } from "../useCursorTrails";

describe("buildTrailSchedulePositionLookup", () => {
  it("maps trail indexes to their ordered stagger positions", () => {
    const orderedIndices = [2, 0, 3, 1];
    const positions = buildTrailSchedulePositionLookup(orderedIndices, 4);

    expect(Array.from(positions)).toEqual([1, 3, 0, 2]);
  });
});
