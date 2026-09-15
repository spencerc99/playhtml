// ABOUTME: Tests scroll viewport animation timeline and frame calculations.
// ABOUTME: Verifies interpolation behavior used by the animated viewport renderer.
import { describe, expect, it } from "vitest";
import type { ActiveViewport, ScrollAnimation } from "../../types";
import { getViewportTitleText } from "../../utils/titleText";
import {
  advanceContinuousViewportPhases,
  buildViewportAnimationTimeline,
  countAdmittedViewports,
  getScrollQueueIndex,
  getViewportFrame,
  getResizeDimensionsAtTime,
  getScrollPositionAtTime,
  getZoomLevelAtTime,
  settledViewportOpacity,
} from "../AnimatedScrollViewports";
import {
  INSTALLATION_FADE_MS,
  INSTALLATION_SCROLL_HOLD_MS,
} from "../../utils/installationPlaybackQueue";

function makeAnimation(
  overrides: Partial<ScrollAnimation> = {},
): ScrollAnimation {
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
      getResizeDimensionsAtTime(
        makeAnimation().resizeEvents ?? [],
        400,
        1280,
        720,
      ),
    ).toEqual({
      width: 1120,
      height: 630,
    });
  });

  it("interpolates zoom levels at a specific time", () => {
    expect(getZoomLevelAtTime(makeAnimation().zoomEvents ?? [], 500)).toBe(
      1.25,
    );
  });
});

describe("AnimatedScrollViewports queue helpers", () => {
  it("stops after one pass when archive playback owns the queue", () => {
    expect(getScrollQueueIndex(3, 3, false)).toBeNull();
  });

  it("wraps after one pass when repeated playback is enabled", () => {
    expect(getScrollQueueIndex(3, 3, true)).toBe(0);
  });
});

describe("AnimatedScrollViewports title text", () => {
  it("decodes HTML entities before rendering metadata titles", () => {
    expect(
      getViewportTitleText(
        "https://example.com/post",
        "Spencer&#39;s &amp; Codex &quot;notes&quot;",
      ),
    ).toBe('Spencer\'s & Codex "notes"');

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

describe("viewport frames", () => {
  function viewport(
    phase: ActiveViewport["phase"] = "animating",
  ): ActiveViewport {
    return {
      id: "viewport",
      animation: makeAnimation(),
      rect: { x: 100, y: 200, width: 640, height: 360 },
      phase,
      phaseStartTime: 1000,
      animationStartTime: 1000,
      durationMs: 650,
      backgroundSeed: 7,
    };
  }

  it("calculates fades independently of playback speed", () => {
    const v = viewport("fade-in");
    const timeline = buildViewportAnimationTimeline(v.animation);
    expect(getViewportFrame(v, timeline, 1200, 4).opacity).toBe(0.5);
    expect(
      getViewportFrame({ ...v, phase: "fade-out" }, timeline, 1300, 4).opacity,
    ).toBe(0.5);
  });

  it("keeps scrolling and the thumb on the same timeline", () => {
    const v = viewport();
    v.animation = makeAnimation({ resizeEvents: [], zoomEvents: [] });
    const timeline = buildViewportAnimationTimeline(v.animation);
    const frame = getViewportFrame(v, timeline, 1325, 1);
    expect(frame.scrollY).toBeCloseTo(0.675);
    expect(frame.bgHeight).toBeCloseTo(1872);
    expect(frame.scrolledContentTransform).toBe(
      `translate(0 ${-frame.scrollY * (frame.bgHeight - frame.visualHeight)})`,
    );
    expect(frame.thumbY).toBeCloseTo(204 + frame.scrollY * (352 - 13));
    expect(frame.zoomTransform).toBeUndefined();
  });

  it("centers resized windows and applies zoom around the viewport center", () => {
    const v = viewport();
    const frame = getViewportFrame(
      v,
      buildViewportAnimationTimeline(v.animation),
      1300,
      1,
    );
    expect(frame.visualWidth).toBe(560);
    expect(frame.visualHeight).toBe(315);
    expect(frame.visualX).toBe(140);
    expect(frame.visualY).toBe(222.5);
    expect(frame.isActivelyResizing).toBe(true);
    expect(frame.zoomTransform).toBe(
      "translate(420, 380) scale(1.15) translate(-420, -380)",
    );
  });

  it("holds the terminal frame after playback completes", () => {
    const v = viewport();
    const timeline = buildViewportAnimationTimeline(v.animation);
    expect(getViewportFrame(v, timeline, 2000, 4)).toEqual(
      getViewportFrame(v, timeline, 3000, 4),
    );
  });
});

describe("continuous viewport sediment", () => {
  function animatingWindow(
    id: string,
    animationStartTime: number,
    durationMs = 1000,
  ): ActiveViewport {
    return {
      id,
      animation: makeAnimation(),
      rect: { x: 0, y: 0, width: 400, height: 300 },
      phase: "animating",
      phaseStartTime: animationStartTime,
      animationStartTime,
      durationMs,
      backgroundSeed: 1,
    };
  }
  const settings = { scrollSpeed: 1, liveScrollWindow: 2 };
  // A 1 s replay at speed 1 plus the hold: the window settles at start + this.
  const REPLAY_MS = 1000 + INSTALLATION_SCROLL_HOLD_MS;

  it("settles a finished window and keeps it far past the old hold-and-fade lifetime", () => {
    let state = [animatingWindow("a", 0)];
    let result = advanceContinuousViewportPhases(state, REPLAY_MS, settings);
    expect(result.viewports[0].phase).toBe("settled");
    expect(result.viewports[0].settledAt).toBe(REPLAY_MS);
    expect(result.changed).toBe(true);

    result = advanceContinuousViewportPhases(
      result.viewports,
      REPLAY_MS + 120_000,
      settings,
    );
    expect(result.viewports).toHaveLength(1);
    expect(result.viewports[0].phase).toBe("settled");
    expect(result.departedIds).toEqual([]);
  });

  it("pushes the oldest settled window out once the count window overflows", () => {
    const state = [
      animatingWindow("a", 0),
      animatingWindow("b", 100),
      animatingWindow("c", 200),
    ];
    const one = advanceContinuousViewportPhases(state, REPLAY_MS, settings);
    const two = advanceContinuousViewportPhases(
      one.viewports,
      REPLAY_MS + 100,
      settings,
    );
    expect(two.viewports.map((v) => v.phase)).toEqual([
      "settled",
      "settled",
      "animating",
    ]);

    const three = advanceContinuousViewportPhases(
      two.viewports,
      REPLAY_MS + 200,
      settings,
    );
    expect(three.viewports.map((v) => [v.id, v.phase])).toEqual([
      ["a", "fade-out"],
      ["b", "settled"],
      ["c", "settled"],
    ]);

    const gone = advanceContinuousViewportPhases(
      three.viewports,
      REPLAY_MS + 200 + INSTALLATION_FADE_MS,
      settings,
    );
    expect(gone.departedIds).toEqual(["a"]);
    expect(gone.viewports.map((v) => v.id)).toEqual(["b", "c"]);
  });

  it("ranks newer settled windows shallower and glides depth toward the target", () => {
    const state = [
      animatingWindow("old", 0),
      animatingWindow("new", 500),
    ];
    const snapped = advanceContinuousViewportPhases(
      state,
      REPLAY_MS + 500,
      { scrollSpeed: 1, liveScrollWindow: 4 },
    );
    expect(snapped.depths.get("new")).toBeCloseTo(1 / 4);
    expect(snapped.depths.get("old")).toBeCloseTo(2 / 4);

    // With a real time step the depth eases instead of snapping.
    const fresh = [animatingWindow("a", 0)];
    const settled = advanceContinuousViewportPhases(fresh, REPLAY_MS, {
      scrollSpeed: 1,
      liveScrollWindow: 4,
    });
    const eased = advanceContinuousViewportPhases(
      settled.viewports,
      REPLAY_MS + 100,
      { scrollSpeed: 1, liveScrollWindow: 4 },
      100,
    );
    expect(eased.depths.get("a")).toBeGreaterThan(0);
    expect(eased.depths.get("a")).toBeLessThan(1 / 4);
  });

  it("fades a finished window at once when the window is zero", () => {
    const result = advanceContinuousViewportPhases(
      [animatingWindow("a", 0)],
      REPLAY_MS,
      { scrollSpeed: 1, liveScrollWindow: 0 },
    );
    expect(result.viewports[0].phase).toBe("fade-out");
  });

  it("does not count settled windows toward the admission cap", () => {
    const viewports: ActiveViewport[] = [
      { ...animatingWindow("a", 0), phase: "settled", settledAt: 5 },
      { ...animatingWindow("b", 0), phase: "settled", settledAt: 6 },
      animatingWindow("c", 0),
      { ...animatingWindow("d", 0), phase: "fade-in" },
    ];
    expect(countAdmittedViewports(viewports)).toBe(2);
  });

  it("renders a settled window at its depth-derived opacity and fades from there", () => {
    const base = animatingWindow("a", 0);
    const timeline = buildViewportAnimationTimeline(base.animation);
    const settled: ActiveViewport = {
      ...base,
      phase: "settled",
      phaseStartTime: 5000,
      settledAt: 5000,
      depth: 0.5,
    };
    const frame = getViewportFrame(settled, timeline, 9000, 1, true, 0.3);
    expect(frame.opacity).toBeCloseTo(settledViewportOpacity(0.5, 0.3), 2);
    expect(frame.settledDepth).toBe(0.5);
    expect(frame.settledSaturation).toBeLessThan(1);

    const fading: ActiveViewport = {
      ...settled,
      phase: "fade-out",
      phaseStartTime: 9000,
    };
    const half = getViewportFrame(
      fading,
      timeline,
      9000 + INSTALLATION_FADE_MS / 2,
      1,
      true,
      0.3,
    );
    expect(half.opacity).toBeCloseTo(settledViewportOpacity(0.5, 0.3) / 2, 2);
  });
});
