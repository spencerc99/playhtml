// ABOUTME: Tests cursor-trail scheduling helpers used by movement visualizations.
// ABOUTME: Verifies stagger playback can use constant-time schedule lookup.

import { describe, expect, it } from "vitest";
import {
  buildLiveTrailId,
  buildTrailSchedulePositionLookup,
  getAccumulationEvictions,
  getLiveTrailGroupId,
} from "../useCursorTrails";

describe("buildTrailSchedulePositionLookup", () => {
  it("maps trail indexes to their ordered stagger positions", () => {
    const orderedIndices = [2, 0, 3, 1];
    const positions = buildTrailSchedulePositionLookup(orderedIndices, 4);

    expect(Array.from(positions)).toEqual([1, 3, 0, 2]);
  });
});

describe("live trail identity", () => {
  it("gives replacement segments distinct render identities", () => {
    const groupId = "participant|https://example.com/page";
    const firstSegmentId = buildLiveTrailId(groupId, 1000);
    const nextSegmentId = buildLiveTrailId(groupId, 400_000);

    expect(firstSegmentId).not.toBe(nextSegmentId);
    expect(getLiveTrailGroupId(firstSegmentId)).toBe(groupId);
    expect(getLiveTrailGroupId(nextSegmentId)).toBe(groupId);
  });

  it("only evicts accumulation when the active segment finishes", () => {
    const groupId = "participant|https://example.com/page";
    const previousSegmentId = buildLiveTrailId(groupId, 1000);
    const activeSegmentId = buildLiveTrailId(groupId, 400_000);
    const activeTrailIds = new Set([activeSegmentId]);

    expect(
      getAccumulationEvictions([previousSegmentId], activeTrailIds),
    ).toEqual([]);
    expect(getAccumulationEvictions([activeSegmentId], activeTrailIds)).toEqual([
      groupId,
    ]);
  });
});
