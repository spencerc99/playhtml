// ABOUTME: Tests duration selection for finite archive playback scenes.
// ABOUTME: Verifies active visualizations advance on their own schedules.

import { describe, expect, it } from "vitest";
import { getPlaybackCycleDuration } from "../usePlaybackCycle";

describe("getPlaybackCycleDuration", () => {
  it("uses the click schedule when invisible cursor trails have a longer cycle", () => {
    const cursorDuration = 120000;
    const clickDuration = 45000;

    expect(getPlaybackCycleDuration([0, clickDuration, 0])).toBe(
      clickDuration,
    );
    expect(getPlaybackCycleDuration([cursorDuration, clickDuration, 0])).toBe(
      cursorDuration,
    );
  });

  it("falls back to one minute while no active schedule is ready", () => {
    expect(getPlaybackCycleDuration([0, 0, 0])).toBe(60000);
  });
});
