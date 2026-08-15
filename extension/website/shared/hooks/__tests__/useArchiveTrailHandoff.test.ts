// ABOUTME: Verifies archive batch handoffs retain the most recent completed trails.
// ABOUTME: Keeps prior trails eligible for the renderer's normal displacement fade.

import { describe, expect, it } from "vitest";
import type { TrailState } from "../../types";
import { createCompletedTrailResidue } from "../useArchiveTrailHandoff";

function trailState(id: string, startOffsetMs: number): TrailState {
  return {
    trail: {
      id,
      points: [
        { x: 0, y: 0, ts: 0 },
        { x: 1, y: 1, ts: 100 },
      ],
      color: "blue",
      opacity: 1,
      startTime: 0,
      endTime: 100,
      clicks: [],
    },
    startOffsetMs,
    durationMs: 100,
    variedPoints: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    clicksWithProgress: [],
  };
}

describe("createCompletedTrailResidue", () => {
  it("keeps the latest trails as already-dimmed completed paths", () => {
    const residue = createCompletedTrailResidue(
      [
        trailState("latest", 300),
        trailState("oldest", 100),
        trailState("middle", 200),
      ],
      2,
      3000,
    );

    expect(residue.map(({ trail }) => trail.id)).toEqual(["middle", "latest"]);
    expect(residue.map(({ startOffsetMs }) => startOffsetMs)).toEqual([
      -3100, -3100,
    ]);
  });

  it("keeps no residue when the renderer has no completed-trail window", () => {
    expect(
      createCompletedTrailResidue([trailState("trail", 0)], 0, 3000),
    ).toEqual([]);
  });
});
