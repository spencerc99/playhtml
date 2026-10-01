// ABOUTME: Tests the line under the history heading that sums up every saved collage.
// ABOUTME: Covers plural words, the empty drawer, and counting shared pages once.

import { describe, expect, it } from "vitest";
import {
  collagesSummaryLine,
  newestCollage,
} from "../entrypoints/scraps/collageHistorySummary";
import type { CollageSummary } from "../entrypoints/scraps/collageRecord";

function summary(overrides: Partial<CollageSummary> = {}): CollageSummary {
  return {
    id: "collage_1",
    title: "a collage",
    createdAt: Date.UTC(2026, 8, 1, 12),
    updatedAt: Date.UTC(2026, 8, 1, 12),
    pieceCount: 1,
    sourcePages: ["https://a.test/"],
    paper: { color: "#fffdf9", grain: true },
    preview: { drawn: false, reason: "not drawn in a test" },
    ...overrides,
  };
}

function day(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

describe("collagesSummaryLine", () => {
  it("says nothing has been made before the first collage", () => {
    expect(collagesSummaryLine([])).toBe("nothing made yet");
    expect(newestCollage([])).toBeNull();
  });

  it("speaks in the singular for one of everything", () => {
    const only = summary();
    expect(collagesSummaryLine([only])).toBe(
      `1 collage · 1 piece from 1 page · last one ${day(only.createdAt)}`,
    );
  });

  it("adds up pieces and counts a page shared by collages once", () => {
    const older = summary({
      id: "collage_1",
      createdAt: Date.UTC(2026, 7, 20, 12),
      pieceCount: 4,
      sourcePages: ["https://a.test/", "https://b.test/"],
    });
    const newer = summary({
      id: "collage_2",
      createdAt: Date.UTC(2026, 8, 22, 12),
      // Edited before the newer one was made, so it still is not the newest.
      updatedAt: Date.UTC(2026, 8, 23, 12),
      pieceCount: 3,
      sourcePages: ["https://b.test/", "https://c.test/"],
    });
    const edited = summary({
      id: "collage_3",
      createdAt: Date.UTC(2026, 8, 2, 12),
      updatedAt: Date.UTC(2026, 8, 30, 12),
      pieceCount: 0,
      sourcePages: [],
    });
    expect(collagesSummaryLine([older, edited, newer])).toBe(
      `3 collages · 7 pieces from 3 pages · last one ${day(newer.createdAt)}`,
    );
    expect(newestCollage([older, edited, newer])?.id).toBe("collage_2");
  });

  it("counts an empty collage without inventing pages for it", () => {
    expect(
      collagesSummaryLine([summary({ pieceCount: 0, sourcePages: [] })]),
    ).toMatch(/^1 collage · 0 pieces from 0 pages · last one /);
  });
});
