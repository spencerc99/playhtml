// ABOUTME: Tests click spawning and lifecycle timing for the live cursor-trail renderer.
// ABOUTME: Covers one-shot effects and clock pauses while the document is hidden.
// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TrailState } from "../../types";
import type { SoundEngine } from "../../sound/SoundEngine";
import { DEFAULT_SETTINGS } from "../settingsDefaults";
import {
  advanceDrawState,
  advanceSettlingState,
  applySedimentWindow,
  createLiveSoundFrame,
  createLiveTrailDrawState,
  getActiveTrailOpacity,
  getBaseHaloOpacity,
  getDrawClockTime,
  getLiveDrawDuration,
  getLiveInkOutline,
  getLiveTrailOpacity,
  getSettledInkBlend,
  LiveTrails,
  shouldDepartTrail,
  type LiveTrailDrawState,
} from "../LiveTrails";
import {
  DEFAULT_SEDIMENT_SETTINGS,
  lightInkEdgeStrength,
  PAPER_COLOR,
  shadeOfColor,
} from "../../utils/liveTrailSediment";
import { DEFAULT_CINEMATIC_CONFIG } from "../../utils/cinematicCamera";
import { COMPLETED_OPACITY } from "../trailPrimitives";
import {
  DEPART_FADE_MS,
  getTrailVisibility,
  RETURN_FADE_MS,
  startTrailVisibilityTransition,
} from "../trailVisibility";
import {
  collectDueClickEffects,
  retainClickEffectsForActiveTrails,
} from "../clickEffects";

describe("advanceDrawState", () => {
  it("continues a settled trail from its already-drawn portion when it grows", () => {
    const draw = {
      seenAt: 0,
      total: 2,
      variedTotal: 5,
      drawProgress: 1,
      grewAt: 1000,
      caughtUpAt: 5000,
      settled: true,
      settledAt: 9000,
      dimmedAt: 9000,
      activeFromVariedPoint: null,
      activeDimmedAt: null,
      finishedAt: 8000,
      depth: 0.4,
      departs: true,
      inkArea: 120,
    };

    advanceDrawState(draw, 4, 10, 10_000, 4000);

    expect(draw).toEqual({
      seenAt: 8222.222222222223,
      total: 4,
      variedTotal: 10,
      drawProgress: 4 / 9,
      grewAt: 10_000,
      caughtUpAt: null,
      settled: false,
      settledAt: null,
      dimmedAt: 9000,
      activeFromVariedPoint: 4,
      activeDimmedAt: null,
      finishedAt: 8000,
      depth: 0.4,
      departs: false,
      inkArea: 120,
    });

    expect(getLiveTrailOpacity(draw, 11_000)).toBe(COMPLETED_OPACITY);
    expect(getActiveTrailOpacity(draw, 11_000)).toBe(1);
  });

  it("preserves the current draw head when an unfinished trail grows", () => {
    const draw = {
      seenAt: 0,
      total: 6,
      variedTotal: 11,
      drawProgress: 0.5,
      grewAt: 1000,
      caughtUpAt: null,
      settled: false,
      settledAt: null,
      dimmedAt: null,
      activeFromVariedPoint: null,
      activeDimmedAt: null,
    };

    advanceDrawState(draw, 11, 21, 10_000, 4000);

    expect(draw.seenAt).toBe(9000);
    expect(draw.variedTotal).toBe(21);
  });
});

describe("getLiveDrawDuration", () => {
  it("slows a spatially long trail to at most 600 pixels per second", () => {
    const state = trailState();
    state.durationMs = 600;
    state.variedPoints = [
      { x: 0, y: 0 },
      { x: 1200, y: 0 },
    ];

    expect(getLiveDrawDuration(state)).toBe(2000);
  });

  it("gives every rendered segment enough time to remain perceptible", () => {
    const state = trailState();
    state.durationMs = 600;
    state.variedPoints = Array.from({ length: 101 }, (_, index) => ({
      x: index,
      y: 0,
    }));

    expect(getLiveDrawDuration(state)).toBe(3200);
  });

  it("does not cap the perceptible segment duration for very long trails", () => {
    const state = trailState();
    state.durationMs = 600;
    state.variedPoints = Array.from({ length: 1001 }, (_, index) => ({
      x: index,
      y: 0,
    }));

    expect(getLiveDrawDuration(state)).toBe(32000);
  });
});

describe("advanceSettlingState", () => {
  it("waits until a trail has been fully drawn for eight seconds", () => {
    const draw = {
      seenAt: 0,
      total: 20,
      grewAt: 0,
      caughtUpAt: null,
      settled: false,
      settledAt: null,
      dimmedAt: null,
      activeFromVariedPoint: null,
      activeDimmedAt: null,
    };

    advanceSettlingState(draw, false, 20_000);
    advanceSettlingState(draw, true, 30_000);
    expect(draw.settled).toBe(false);

    advanceSettlingState(draw, true, 37_999);
    expect(draw.settled).toBe(false);

    advanceSettlingState(draw, true, 38_000);
    expect(draw.settled).toBe(true);
    expect(draw.settledAt).toBe(38_000);
    expect(draw.dimmedAt).toBe(38_000);
  });

  it("fades only the resumed portion when an active trail settles again", () => {
    const draw = {
      seenAt: 0,
      total: 4,
      grewAt: 0,
      caughtUpAt: 10_000,
      settled: false,
      settledAt: null,
      dimmedAt: 1000,
      activeFromVariedPoint: 1,
      activeDimmedAt: null,
    };

    advanceSettlingState(draw, true, 18_000);

    expect(draw.activeFromVariedPoint).toBe(1);
    expect(draw.activeDimmedAt).toBe(18_000);
    expect(getActiveTrailOpacity(draw, 18_000)).toBe(1);
    expect(getActiveTrailOpacity(draw, 19_200)).toBe(0);
  });
});

function settledDrawAt(
  settledAt: number,
  inkArea = 100,
  finishedAt = settledAt,
): LiveTrailDrawState {
  return {
    ...createLiveTrailDrawState(0, 2, 2),
    drawProgress: 1,
    grewAt: 1000,
    caughtUpAt: 1000,
    settled: true,
    settledAt,
    dimmedAt: settledAt,
    finishedAt,
    inkArea,
  };
}

describe("shouldDepartTrail", () => {
  it("keeps a settled trail until the sediment window pushes it out, however long that takes", () => {
    const draw = settledDrawAt(10_000);
    expect(shouldDepartTrail(draw)).toBe(false);
    draw.departs = true;
    expect(shouldDepartTrail(draw)).toBe(true);
  });

  it("does not depart a trail that has resumed", () => {
    const draw = settledDrawAt(10_000);
    draw.departs = true;
    expect(shouldDepartTrail(draw, true)).toBe(false);
  });

  it("never departs a trail that is still tracing", () => {
    const draw = createLiveTrailDrawState(0, 2, 2);
    draw.departs = true;
    expect(shouldDepartTrail(draw)).toBe(false);
  });
});

describe("applySedimentWindow", () => {
  it("ranks settled trails newest-first by count and flags the overflow", () => {
    const draws = new Map<string, LiveTrailDrawState>([
      ["oldest", settledDrawAt(1_000)],
      ["middle", settledDrawAt(2_000)],
      ["newest", settledDrawAt(3_000)],
      ["tracing", createLiveTrailDrawState(4_000, 2, 2)],
    ]);
    const targets = applySedimentWindow(
      draws,
      new Set(draws.keys()),
      { ...DEFAULT_SEDIMENT_SETTINGS, windowMode: "count", windowCount: 2 },
      1_000_000,
    );

    expect(targets.get("newest")).toBe(0.5);
    expect(targets.get("middle")).toBe(1);
    expect(targets.get("oldest")).toBe(1);
    expect(targets.get("tracing")).toBe(0);
    expect(draws.get("newest")!.departs).toBe(false);
    expect(draws.get("middle")!.departs).toBe(false);
    expect(draws.get("oldest")!.departs).toBe(true);
    expect(draws.get("tracing")!.departs).toBe(false);
  });

  it("fills a coverage window by ink area so sprawling trails push older ink out sooner", () => {
    const draws = new Map<string, LiveTrailDrawState>([
      ["old-small", settledDrawAt(1_000, 100)],
      ["big", settledDrawAt(2_000, 1_500)],
      ["new-small", settledDrawAt(3_000, 200)],
    ]);
    applySedimentWindow(
      draws,
      new Set(draws.keys()),
      { ...DEFAULT_SEDIMENT_SETTINGS, windowMode: "coverage", coverageBudget: 1 },
      1_600,
    );

    expect(draws.get("new-small")!.departs).toBe(false);
    expect(draws.get("big")!.departs).toBe(false);
    expect(draws.get("old-small")!.departs).toBe(true);
  });

  it("evicts in the order people finished drawing, not in settle order", () => {
    // "slow" finished first (its last event is oldest) but took longer to
    // play back, so it settled after "quick". It must still leave first.
    const draws = new Map<string, LiveTrailDrawState>([
      ["slow", settledDrawAt(9_000, 100, 1_000)],
      ["quick", settledDrawAt(5_000, 100, 4_000)],
      ["newest", settledDrawAt(6_000, 100, 6_000)],
    ]);
    applySedimentWindow(
      draws,
      new Set(draws.keys()),
      { ...DEFAULT_SEDIMENT_SETTINGS, windowMode: "count", windowCount: 2 },
      1_000_000,
    );
    expect(draws.get("slow")!.departs).toBe(true);
    expect(draws.get("quick")!.departs).toBe(false);
    expect(draws.get("newest")!.departs).toBe(false);
  });

  it("ignores trails that are no longer kept on screen", () => {
    const draws = new Map<string, LiveTrailDrawState>([
      ["gone", settledDrawAt(5_000)],
      ["kept", settledDrawAt(1_000)],
    ]);
    applySedimentWindow(
      draws,
      new Set(["kept"]),
      { ...DEFAULT_SEDIMENT_SETTINGS, windowMode: "count", windowCount: 1 },
      1_000_000,
    );
    expect(draws.get("kept")!.departs).toBe(false);
  });
});

describe("settled ink appearance", () => {
  it("eases the settled opacity toward the depth-derived target", () => {
    const draw = settledDrawAt(10_000);
    expect(getLiveTrailOpacity(draw, 10_000, 0.3)).toBe(1);
    expect(getLiveTrailOpacity(draw, 10_600, 0.3)).toBeCloseTo(0.65);
    expect(getLiveTrailOpacity(draw, 20_000, 0.3)).toBeCloseTo(0.3);
  });

  it("drops the paper halo as a trail dims into sediment", () => {
    const draw = settledDrawAt(10_000);
    expect(getBaseHaloOpacity(createLiveTrailDrawState(0, 2, 2), 5_000)).toBe(1);
    expect(getBaseHaloOpacity(draw, 10_600)).toBeCloseTo(0.5);
    expect(getBaseHaloOpacity(draw, 12_000)).toBe(0);
  });
});

describe("getSettledInkBlend", () => {
  it("never multiplies while a trail is still tracing", () => {
    const draw = createLiveTrailDrawState(0, 2, 2);
    expect(getSettledInkBlend(draw, 5_000, true)).toBe("normal");
  });

  it("never multiplies during the dim, and multiplies once dimmed", () => {
    const draw = settledDrawAt(10_000);
    expect(getSettledInkBlend(draw, 10_000, true)).toBe("normal");
    expect(getSettledInkBlend(draw, 11_100, true)).toBe("normal");
    expect(getSettledInkBlend(draw, 11_200, true)).toBe("multiply");
    expect(getSettledInkBlend(draw, 30_000, true)).toBe("multiply");
  });

  it("stays normal when the sediment style does not multiply", () => {
    const draw = settledDrawAt(10_000);
    expect(getSettledInkBlend(draw, 30_000, false)).toBe("normal");
  });

  it("keeps a resumed trail's base at whatever its own dim says", () => {
    const draw = settledDrawAt(10_000);
    draw.activeFromVariedPoint = 3;
    draw.settled = false;
    expect(getSettledInkBlend(draw, 30_000, true)).toBe("multiply");
  });
});

describe("getLiveInkOutline", () => {
  const yellow = "rgb(255, 232, 0)";
  const blue = "rgb(0, 120, 191)";

  it("gives settled ink no edge at all", () => {
    expect(getLiveInkOutline("none", 0, yellow, 6)).toBeNull();
    expect(getLiveInkOutline("paper", 0, yellow, 6)).toBeNull();
    expect(getLiveInkOutline("shade", 0, blue, 6)).toBeNull();
    expect(getLiveInkOutline("weight", 0, blue, 6)).toBeNull();
  });

  it("edges light live ink and leaves dark live ink bare without emphasis", () => {
    const light = getLiveInkOutline("none", 1, yellow, 6);
    expect(light).not.toBeNull();
    expect(light?.opacity).toBeCloseTo(0.55 * 0.7284, 2);
    expect(light?.width).toBeCloseTo(6 * 0.9);
    expect(light?.color).not.toBe(yellow);
    expect(getLiveInkOutline("none", 1, blue, 6)).toBeNull();
    expect(getLiveInkOutline("weight", 1, blue, 6)).toBeNull();
  });

  it("scales the light edge with how live the ink still is", () => {
    const full = getLiveInkOutline("weight", 1, yellow, 6);
    const half = getLiveInkOutline("weight", 0.5, yellow, 6);
    expect(half?.opacity).toBeCloseTo((full?.opacity ?? 0) / 2);
  });

  it("lets the paper gutter win, for light and dark ink alike", () => {
    const light = getLiveInkOutline("paper", 1, yellow, 6);
    const dark = getLiveInkOutline("paper", 1, blue, 6);
    expect(light?.color).toBe(PAPER_COLOR);
    expect(dark?.color).toBe(PAPER_COLOR);
    expect(light?.opacity).toBeCloseTo(0.85);
    expect(light?.width).toBeCloseTo(6 * 1.3);
  });

  it("takes the larger opacity under the shade emphasis", () => {
    const light = getLiveInkOutline("shade", 1, yellow, 6);
    const dark = getLiveInkOutline("shade", 1, blue, 6);
    expect(light?.opacity).toBeCloseTo(0.55);
    expect(dark?.opacity).toBeCloseTo(0.55);
    expect(light?.color).toBe(shadeOfColor(yellow, 0.35 + 0.25 * lightInkEdgeStrength(yellow)));
    expect(dark?.color).toBe(shadeOfColor(blue, 0.35));
  });

  it("keeps the edge at least a legible width for hairline strokes", () => {
    expect(getLiveInkOutline("none", 1, yellow, 1)?.width).toBe(3);
    expect(getLiveInkOutline("paper", 1, yellow, 1)?.width).toBe(4);
  });
});

describe("trail visibility transitions", () => {
  it("fades a departing trail over eight seconds", () => {
    const transition = startTrailVisibilityTransition(null, 1000, false);

    expect(transition.durationMs).toBe(DEPART_FADE_MS);
    expect(getTrailVisibility(transition, 1000)).toBe(1);
    expect(getTrailVisibility(transition, 5000)).toBe(0.5);
    expect(getTrailVisibility(transition, 9000)).toBe(0);
  });

  it("eases a returning trail from its current opacity without a jump", () => {
    const departure = startTrailVisibilityTransition(null, 1000, false);
    const visibilityAtReturn = getTrailVisibility(departure, 5000);
    const returning = startTrailVisibilityTransition(departure, 5000, true);

    expect(returning.durationMs).toBe(RETURN_FADE_MS);
    expect(getTrailVisibility(returning, 5000)).toBe(visibilityAtReturn);
    expect(getTrailVisibility(returning, 7000)).toBe(0.75);
    expect(getTrailVisibility(returning, 9000)).toBe(1);
  });
});

function trailState(): TrailState {
  return {
    trail: {
      id: "participant|https://example.com",
      points: [
        { x: 0, y: 0, ts: 0 },
        { x: 100, y: 100, ts: 1000 },
      ],
      color: "#123456",
      opacity: 1,
      startTime: 0,
      endTime: 1000,
      clicks: [],
    },
    startOffsetMs: 0,
    durationMs: 1000,
    variedPoints: [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
    clicksWithProgress: [
      { x: 25, y: 25, ts: 250, progress: 0.25 },
      { x: 75, y: 75, ts: 750, progress: 0.75, duration: 1200 },
    ],
  };
}

describe("collectDueClickEffects", () => {
  it("emits each click once as live playback reaches it", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const spawned = new Set<string>();
    const state = trailState();

    expect(
      collectDueClickEffects(
        state,
        0.2,
        spawned,
        { x: 10, y: 20 },
        "#abcdef",
        1000,
      ),
    ).toEqual([]);

    const firstEffects = collectDueClickEffects(
      state,
      0.5,
      spawned,
      { x: 30, y: 40 },
      "#abcdef",
      1000,
    );
    expect(firstEffects).toEqual([
      expect.objectContaining({
        id: "participant|https://example.com|250|0",
        trailId: "participant|https://example.com",
        x: 30,
        y: 40,
        color: "#abcdef",
        startTime: 1000,
      }),
    ]);

    expect(
      collectDueClickEffects(
        state,
        0.8,
        spawned,
        { x: 70, y: 80 },
        "#abcdef",
        1100,
      ),
    ).toEqual([
      expect.objectContaining({
        id: "participant|https://example.com|750|1",
        x: 70,
        y: 80,
        holdDuration: 1200,
        startTime: 1100,
      }),
    ]);

    expect(
      collectDueClickEffects(
        state,
        1,
        spawned,
        { x: 90, y: 100 },
        "#abcdef",
        1200,
      ),
    ).toEqual([]);

    expect(
      retainClickEffectsForActiveTrails(firstEffects, new Set(["other-trail"])),
    ).toBe(firstEffects);
    expect(
      retainClickEffectsForActiveTrails(
        firstEffects,
        new Set(["participant|https://example.com"]),
      ),
    ).toEqual([]);

    random.mockRestore();
  });
});

describe("getDrawClockTime", () => {
  it("freezes lifecycle time while a pause is active", () => {
    expect(getDrawClockTime(15_000, 2_000, 10_000)).toBe(8_000);
    expect(getDrawClockTime(30_000, 2_000, 10_000)).toBe(8_000);
  });

  it("resumes from the same lifecycle time after accounting for the pause", () => {
    expect(getDrawClockTime(30_000, 22_000, null)).toBe(8_000);
  });
});

describe("createLiveSoundFrame", () => {
  it("maps the live draw head to the current cursor instrument", () => {
    const state = trailState();
    state.trail.points[0].cursor = "pointer";
    state.trail.points[1].cursor = "text";

    expect(
      createLiveSoundFrame(7, state, { x: 75, y: 80 }, 1),
    ).toEqual({
      trailIndex: 7,
      x: 75,
      y: 80,
      prevX: 75,
      prevY: 80,
      cursorType: "text",
      progress: 1,
      color: "#123456",
      isNewlyActive: false,
    });
  });
});

describe("LiveTrails sound", () => {
  it("feeds active live draw heads to the sound engine", async () => {
    const testGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const state = trailState();
    state.trail.points[0].cursor = "pointer";
    const soundEngine = {
      tick: vi.fn(),
      triggerClick: vi.fn(),
      retireTrail: vi.fn(),
    } as unknown as SoundEngine;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(LiveTrails, {
          trailStates: [state],
          soundEngine,
          settings: DEFAULT_SETTINGS,
        }),
      );
    });

    act(() => scheduledFrames.shift()?.(1000));
    act(() => scheduledFrames.shift()?.(1600));

    expect(soundEngine.tick).toHaveBeenLastCalledWith(1600, [
      expect.objectContaining({
        trailIndex: 0,
        cursorType: "pointer",
        progress: 0.6,
      }),
    ]);

    await act(async () => {
      root.render(
        React.createElement(LiveTrails, {
          trailStates: [state],
          frozen: true,
          soundEngine,
          settings: DEFAULT_SETTINGS,
        }),
      );
    });
    act(() => scheduledFrames.shift()?.(1700));

    expect(soundEngine.tick).toHaveBeenLastCalledWith(1700, []);

    await act(async () => root.unmount());
    expect(soundEngine.retireTrail).toHaveBeenCalledWith(0);
    container.remove();
    vi.unstubAllGlobals();
    delete testGlobal.IS_REACT_ACT_ENVIRONMENT;
  });
});

describe("LiveTrails camera", () => {
  it("follows an extending trail without restarting and releases the camera when disabled", async () => {
    const testGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const state = trailState();
    const cinematic = { ...DEFAULT_CINEMATIC_CONFIG, zoom: 0.1 };
    const render = async (enabled: boolean, frozen = false, visible = true) => {
      await act(async () => root.render(React.createElement(LiveTrails, {
        trailStates: [state],
        cinematic: enabled ? cinematic : null,
        settings: DEFAULT_SETTINGS,
        frozen,
        visible,
      })));
    };
    try {
      await render(true);
      act(() => frames.shift()?.(1000));
      act(() => frames.shift()?.(1500));
      const svg = container.querySelector("svg.trails-svg")!;
      const box = () => svg.getAttribute("viewBox")!.split(" ").map(Number);
      expect(box()[2]).toBeCloseTo(window.innerWidth * 0.1);
      const initial = box();
      act(() => frames.shift()?.(1700));
      expect(box()[0]).toBeGreaterThan(initial[0]);
      const beforeGrowth = box();
      state.trail.points.push({ x: 200, y: 200, ts: 2000 });
      state.variedPoints.push({ x: 200, y: 200 });
      state.durationMs = 2000;
      await render(true);
      act(() => frames.shift()?.(1700));
      expect(box()[0]).toBeCloseTo(beforeGrowth[0]);
      act(() => frames.shift()?.(1900));
      expect(box()[0]).toBeGreaterThan(beforeGrowth[0]);
      await render(true, false, false);
      expect(svg.style.visibility).toBe("hidden");
      const hiddenPosition = box()[0];
      act(() => frames.shift()?.(2000));
      expect(box()[0]).toBeGreaterThan(hiddenPosition);
      await render(true);
      expect(svg.style.visibility).toBe("visible");
      expect(box()[0]).toBeGreaterThan(hiddenPosition);
      await render(true, true);
      const paused = svg.getAttribute("viewBox");
      act(() => frames.shift()?.(2100));
      expect(svg.getAttribute("viewBox")).toBe(paused);
      await render(false);
      expect(svg.hasAttribute("viewBox")).toBe(false);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
      delete testGlobal.IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
