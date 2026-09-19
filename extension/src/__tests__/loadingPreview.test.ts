// ABOUTME: Verifies the browser-history movement-loading preview remains explicitly selectable.
// ABOUTME: Ensures preview data hides trails without mutating the stored walking record.

import { describe, expect, it } from "vitest";
import {
  createMovementLoadingPreview,
  isMovementLoadingPreview,
} from "../entrypoints/walking-record/loadingPreview";
import type { WalkingRecord } from "../history/walkingRecord";

const cursorEvent = {
  id: "cursor-1",
  type: "cursor" as const,
  ts: 1_000,
  data: { event: "move", x: 0.5, y: 0.5 },
  meta: {
    pid: "pk_test",
    sid: "sid_test",
    url: "https://example.com/page",
    vw: 1_000,
    vh: 800,
    tz: "America/Los_Angeles",
  },
};

const record: WalkingRecord = {
  period: "week",
  range: { startTs: 1_000, endTs: 2_000 },
  rangeLabel: "aug 17 – 23, 2026",
  totalTimeMs: 60_000,
  totalTimeLabel: "1 min",
  cursorDistancePx: 100,
  pageCount: 1,
  hourBuckets: new Array(24).fill(0),
  movementCount: 1,
  departures: [],
  settledPlaces: [],
  timeSpent: [],
  dayPlates: [
    {
      date: "2026-08-17",
      day: "mon",
      vignette: "12m on example.com",
      hue: "#4a9a8a",
      future: false,
      traceTargets: [],
      tracePaths: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]],
    },
  ],
  landscapePaths: [[cursorEvent]],
};

describe("walking record loading preview", () => {
  it("activates only for the explicit movement preview", () => {
    expect(isMovementLoadingPreview("?previewLoading=movement")).toBe(true);
    expect(isMovementLoadingPreview("?previewLoading=portraits")).toBe(false);
    expect(isMovementLoadingPreview("")).toBe(false);
  });

  it("hides movement paths without changing the source record", () => {
    const preview = createMovementLoadingPreview(record);

    expect(preview.dayPlates[0].tracePaths).toEqual([]);
    expect(preview.landscapePaths).toEqual([]);
    expect(record.dayPlates[0].tracePaths).toEqual([
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    ]);
    expect(record.landscapePaths).toEqual([[cursorEvent]]);
  });
});
