// ABOUTME: Tests scroll viewport animation timeline and frame calculations.
// ABOUTME: Verifies interpolation behavior used by the animated viewport renderer.
import { describe, expect, it } from "vitest";
import type { ScrollAnimation } from "../../types";
import {
  buildViewportAnimationTimeline,
  getResizeDimensionsAtTime,
  getScrollPositionAtTime,
  getZoomLevelAtTime,
} from "../AnimatedScrollViewports";

function makeAnimation(overrides: Partial<ScrollAnimation> = {}): ScrollAnimation {
  return {
    participantId: "participant",
    sessionId: "session",
    pageUrl: "https://example.com",
    color: "#111",
    scrollEvents: [
      {
        scrollX: 0,
        scrollY: 0.1,
        timestamp: 100,
        viewportWidth: 1280,
        viewportHeight: 720,
      },
      {
        scrollX: 0,
        scrollY: 0.6,
        timestamp: 300,
        viewportWidth: 1280,
        viewportHeight: 720,
      },
      {
        scrollX: 0,
        scrollY: 0.9,
        timestamp: 700,
        viewportWidth: 1280,
        viewportHeight: 720,
      },
    ],
    resizeEvents: [
      { width: 1280, height: 720, timestamp: 200 },
      { width: 960, height: 540, timestamp: 600 },
    ],
    zoomEvents: [
      { zoom: 1, timestamp: 250 },
      { zoom: 1.5, timestamp: 750 },
    ],
    startTime: 100,
    endTime: 750,
    startViewportWidth: 1280,
    startViewportHeight: 720,
    endViewportWidth: 960,
    endViewportHeight: 540,
    ...overrides,
  };
}

describe("AnimatedScrollViewports timeline helpers", () => {
  it("builds timeline bounds and scroll range across scroll, resize, and zoom events", () => {
    const timeline = buildViewportAnimationTimeline(makeAnimation());

    expect(timeline.minTime).toBe(100);
    expect(timeline.maxTime).toBe(750);
    expect(timeline.scrollRange).toBeCloseTo(0.8);
  });

  it("interpolates scroll positions at a specific time", () => {
    expect(getScrollPositionAtTime(makeAnimation().scrollEvents, 200)).toEqual({
      scrollY: 0.35,
    });
  });

  it("interpolates resize dimensions at a specific time", () => {
    expect(
      getResizeDimensionsAtTime(makeAnimation().resizeEvents ?? [], 400, 1280, 720),
    ).toEqual({
      width: 1120,
      height: 630,
    });
  });

  it("interpolates zoom levels at a specific time", () => {
    expect(getZoomLevelAtTime(makeAnimation().zoomEvents ?? [], 500)).toBe(1.25);
  });
});
