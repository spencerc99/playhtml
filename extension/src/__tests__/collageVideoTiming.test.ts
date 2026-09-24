// ABOUTME: Tests the collage video's clock and sizing: loop length, frame sampling, output dimensions.
// ABOUTME: Guards per-frame delays, the browser's fast-frame clamp, the cap, and even encoder sizes.

import { describe, expect, it } from "vitest";
import {
  COLLAGE_VIDEO_MAX_MS,
  SLOW_FRAME_MS,
  animationTimeline,
  displayedFrameMs,
  frameIndexAt,
  videoFrameCount,
  videoFrameTimeMs,
  videoLoopMs,
  videoSizeCandidates,
} from "../entrypoints/scraps/collageVideoTiming";

describe("animationTimeline", () => {
  it("starts each frame after the delays before it", () => {
    const timeline = animationTimeline([100, 50, 250]);
    expect(timeline.starts).toEqual([0, 100, 150]);
    expect(timeline.loopMs).toBe(400);
  });

  it("shows fast frames at the speed browsers play them", () => {
    expect(displayedFrameMs(0)).toBe(SLOW_FRAME_MS);
    expect(displayedFrameMs(10)).toBe(SLOW_FRAME_MS);
    expect(displayedFrameMs(20)).toBe(20);
    expect(animationTimeline([0, 0]).loopMs).toBe(2 * SLOW_FRAME_MS);
  });

  it("refuses an animation with no frames or an unreadable delay", () => {
    expect(() => animationTimeline([])).toThrow();
    expect(() => displayedFrameMs(Number.NaN)).toThrow();
    expect(() => displayedFrameMs(-5)).toThrow();
  });
});

describe("frameIndexAt", () => {
  const timeline = animationTimeline([100, 50, 250]);

  it("picks the frame showing at each moment of a loop", () => {
    expect(frameIndexAt(timeline, 0)).toBe(0);
    expect(frameIndexAt(timeline, 99.9)).toBe(0);
    expect(frameIndexAt(timeline, 100)).toBe(1);
    expect(frameIndexAt(timeline, 149)).toBe(1);
    expect(frameIndexAt(timeline, 150)).toBe(2);
    expect(frameIndexAt(timeline, 399)).toBe(2);
  });

  it("loops a short animation inside a longer video", () => {
    expect(frameIndexAt(timeline, 400)).toBe(0);
    expect(frameIndexAt(timeline, 520)).toBe(1);
    expect(frameIndexAt(timeline, 1_200 + 160)).toBe(2);
  });
});

describe("videoLoopMs", () => {
  it("runs as long as the slowest animation's loop", () => {
    expect(
      videoLoopMs([animationTimeline([100, 100]), animationTimeline([700])]),
    ).toBe(700);
  });

  it("holds a long animation to the cap", () => {
    expect(videoLoopMs([animationTimeline([60_000])])).toBe(
      COLLAGE_VIDEO_MAX_MS,
    );
  });

  it("needs something that animates", () => {
    expect(() => videoLoopMs([])).toThrow();
  });
});

describe("video frames", () => {
  it("counts frames for a duration at the rate", () => {
    expect(videoFrameCount(1_000, 30)).toBe(30);
    expect(videoFrameCount(400, 30)).toBe(12);
    expect(videoFrameCount(10_000, 30)).toBe(300);
    expect(videoFrameCount(10, 30)).toBe(1);
  });

  it("places each output frame on the collage's clock", () => {
    expect(videoFrameTimeMs(0, 30)).toBe(0);
    expect(videoFrameTimeMs(3, 30)).toBeCloseTo(100);
    expect(videoFrameTimeMs(30, 30)).toBeCloseTo(1_000);
  });

  it("samples each animation on its own timeline", () => {
    const fast = animationTimeline([100, 100]);
    const slow = animationTimeline([500, 500]);
    const at = (index: number) => videoFrameTimeMs(index, 30);
    // At 0.2s the fast one has looped back to its first frame; the slow one
    // is still on its first.
    expect(frameIndexAt(fast, at(6))).toBe(0);
    expect(frameIndexAt(slow, at(6))).toBe(0);
    // At 0.6s the fast one is back on its first frame, and on its second by
    // 0.7s; the slow one has moved to its second at 0.6s.
    expect(frameIndexAt(fast, at(18))).toBe(0);
    expect(frameIndexAt(fast, at(21))).toBe(1);
    expect(frameIndexAt(slow, at(18))).toBe(1);
  });
});

describe("videoSizeCandidates", () => {
  it("prefers twice the frame, stepping down with even sides", () => {
    expect(videoSizeCandidates({ width: 600, height: 400 })).toEqual([
      { width: 1200, height: 800 },
      { width: 900, height: 600 },
      { width: 750, height: 500 },
      { width: 600, height: 400 },
    ]);
  });

  it("rounds odd sides to even ones", () => {
    const [first, ...rest] = videoSizeCandidates({ width: 333, height: 201 });
    expect(first).toEqual({ width: 666, height: 402 });
    for (const size of rest) {
      expect(size.width % 2).toBe(0);
      expect(size.height % 2).toBe(0);
    }
  });

  it("fits a large frame within the longest side the encoder takes", () => {
    const sizes = videoSizeCandidates({ width: 3000, height: 1500 }, [2, 1], 3840);
    expect(sizes).toEqual([
      { width: 3840, height: 1920 },
      { width: 3000, height: 1500 },
    ]);
  });

  it("does not repeat a size that the cap makes the same", () => {
    const sizes = videoSizeCandidates({ width: 4000, height: 2000 }, [2, 1.5], 3840);
    expect(sizes).toEqual([{ width: 3840, height: 1920 }]);
  });
});
