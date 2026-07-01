// ABOUTME: Tests scroll viewport animation timeline and frame calculations.
// ABOUTME: Verifies interpolation behavior used by the animated viewport renderer.
import { describe, expect, it } from "vitest";
import type { ScrollAnimation } from "../../types";
import { getViewportTitleText } from "../../utils/titleText";
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

describe("AnimatedScrollViewports title text", () => {
  it("decodes HTML entities before rendering metadata titles", () => {
    expect(
      getViewportTitleText(
        "https://example.com/post",
        "Spencer&#39;s &amp; Codex &quot;notes&quot;",
      ),
    ).toBe("Spencer's & Codex \"notes\"");

    expect(
      getViewportTitleText(
        "https://example.com/post",
        "Spencer&amp;#39;s &amp;amp; Codex",
      ),
    ).toBe("Spencer's & Codex");

    expect(
      getViewportTitleText(
        "https://example.com/post",
        "Spencer&apos;s &rsquo;note&rsquo;",
      ),
    ).toBe("Spencer's \u2019note\u2019");
  });

  it("normalizes title whitespace and falls back for blank titles", () => {
    expect(
      getViewportTitleText(
        "https://example.com/post",
        "\n\t  Spencer&#39;s\u0000   notes  ",
      ),
    ).toBe("Spencer's notes");

    expect(getViewportTitleText("https://example.com/post", "&nbsp;")).toBe(
      "example.com",
    );
  });

  it("keeps URL-derived Wikipedia titles readable", () => {
    expect(
      getViewportTitleText(
        "https://en.wikipedia.org/wiki/Spencer%27s_Online_Notes",
      ),
    ).toBe("Spencer's Online Notes");
  });
});
