// ABOUTME: Provides the explicit browser-history loading preview selected from the page URL.
// ABOUTME: Keeps movement placeholders visible without changing the stored walking record.

import type { WalkingRecord } from "../../history/walkingRecord";

export function isMovementLoadingPreview(search: string): boolean {
  return new URLSearchParams(search).get("previewLoading") === "movement";
}

export function createMovementLoadingPreview(
  record: WalkingRecord,
): WalkingRecord {
  return {
    ...record,
    dayPlates: record.dayPlates.map((dayPlate) => ({
      ...dayPlate,
      tracePaths: [],
    })),
    landscapePaths: [],
  };
}
