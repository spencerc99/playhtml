// ABOUTME: Tests the live cursor field's sediment window and depth-to-appearance mapping.
// ABOUTME: Covers count and coverage windows, opacity easing, paper wash, and depth smoothing.

import { describe, expect, it } from "vitest";
import {
  approachDepth,
  assignSedimentDepths,
  DEFAULT_SEDIMENT_SETTINGS,
  estimateInkArea,
  liveTrailAccumulationLimits,
  parseRgb,
  sedimentOpacity,
  sedimentUsesMultiply,
  sedimentWashAmount,
  washTowardPaper,
} from "../liveTrailSediment";

const count = (windowCount: number) => ({
  ...DEFAULT_SEDIMENT_SETTINGS,
  windowMode: "count" as const,
  windowCount,
});

describe("assignSedimentDepths (count)", () => {
  it("gives the newest settled trail the shallowest depth and departs the overflow", () => {
    const assignments = assignSedimentDepths(
      [
        { id: "a", settledAt: 1, inkArea: 1 },
        { id: "b", settledAt: 3, inkArea: 1 },
        { id: "c", settledAt: 2, inkArea: 1 },
        { id: "d", settledAt: 0, inkArea: 1 },
      ],
      count(3),
      1,
    );
    expect(assignments.get("b")).toEqual({ depth: 1 / 3, departs: false });
    expect(assignments.get("c")).toEqual({ depth: 2 / 3, departs: false });
    expect(assignments.get("a")).toEqual({ depth: 1, departs: false });
    expect(assignments.get("d")).toEqual({ depth: 1, departs: true });
  });

  it("breaks settledAt ties deterministically by id", () => {
    const assignments = assignSedimentDepths(
      [
        { id: "y", settledAt: 5, inkArea: 1 },
        { id: "x", settledAt: 5, inkArea: 1 },
      ],
      count(1),
      1,
    );
    expect(assignments.get("x")!.departs).toBe(false);
    expect(assignments.get("y")!.departs).toBe(true);
  });
});

describe("assignSedimentDepths (coverage)", () => {
  const coverage = {
    ...DEFAULT_SEDIMENT_SETTINGS,
    windowMode: "coverage" as const,
    coverageBudget: 2,
  };

  it("keeps trails until their accumulated ink fills the screen-area budget", () => {
    const assignments = assignSedimentDepths(
      [
        { id: "new", settledAt: 3, inkArea: 60 },
        { id: "mid", settledAt: 2, inkArea: 60 },
        { id: "old", settledAt: 1, inkArea: 60 },
        { id: "older", settledAt: 0, inkArea: 60 },
      ],
      coverage,
      100,
    );
    expect(assignments.get("new")).toEqual({ depth: 0.3, departs: false });
    expect(assignments.get("mid")).toEqual({ depth: 0.6, departs: false });
    expect(assignments.get("old")).toEqual({ depth: 0.9, departs: false });
    expect(assignments.get("older")).toEqual({ depth: 1, departs: false });
  });

  it("departs once the budget was already full before a trail", () => {
    const assignments = assignSedimentDepths(
      [
        { id: "huge", settledAt: 2, inkArea: 500 },
        { id: "old", settledAt: 1, inkArea: 10 },
      ],
      coverage,
      100,
    );
    expect(assignments.get("huge")!.departs).toBe(false);
    expect(assignments.get("old")!.departs).toBe(true);
  });
});

describe("estimateInkArea", () => {
  it("multiplies path length by stroke width", () => {
    expect(
      estimateInkArea(
        [
          { x: 0, y: 0 },
          { x: 3, y: 4 },
          { x: 3, y: 14 },
        ],
        6,
      ),
    ).toBe(90);
  });
});

describe("sedimentOpacity", () => {
  it("runs from the fresh factor down to the floor with an eased tail", () => {
    const settings = { freshOpacity: 0.6, floorOpacity: 0.2 };
    expect(sedimentOpacity(0, settings)).toBeCloseTo(0.6);
    expect(sedimentOpacity(1, settings)).toBeCloseTo(0.2);
    const mid = sedimentOpacity(0.5, settings);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.4);
  });
});

describe("wash", () => {
  it("only the wash styles mix toward paper", () => {
    expect(sedimentWashAmount(1, "opacity")).toBe(0);
    expect(sedimentWashAmount(1, "multiply")).toBe(0);
    expect(sedimentWashAmount(1, "wash")).toBeGreaterThan(0.5);
    expect(sedimentWashAmount(0, "wash")).toBe(0);
    expect(sedimentWashAmount(1, "wash-multiply")).toBeGreaterThan(0.5);
  });

  it("mixes rgb, hex, and hsl colors toward the paper and leaves depth zero untouched", () => {
    expect(washTowardPaper("rgb(0, 120, 191)", 0)).toBe("rgb(0, 120, 191)");
    expect(washTowardPaper("rgb(0, 120, 191)", 1)).toBe("rgb(250, 247, 242)");
    expect(washTowardPaper("#000000", 0.5)).toBe("rgb(125, 124, 121)");
    expect(parseRgb("hsl(0, 100%, 50%)")).toEqual([255, 0, 0]);
    expect(washTowardPaper("not a color", 0.5)).toBe("not a color");
  });

  it("quantizes so nearby amounts share a color string", () => {
    expect(washTowardPaper("#336699", 0.301)).toBe(
      washTowardPaper("#336699", 0.31),
    );
  });
});

describe("sedimentUsesMultiply", () => {
  it("is true for the multiply styles only", () => {
    expect(sedimentUsesMultiply("opacity")).toBe(false);
    expect(sedimentUsesMultiply("wash")).toBe(false);
    expect(sedimentUsesMultiply("multiply")).toBe(true);
    expect(sedimentUsesMultiply("wash-multiply")).toBe(true);
  });
});

describe("approachDepth", () => {
  it("glides toward the target and snaps when within tolerance", () => {
    const step = approachDepth(0, 1, 500, 1000);
    expect(step).toBeGreaterThan(0.35);
    expect(step).toBeLessThan(0.45);
    expect(approachDepth(0.9999, 1, 16, 1000)).toBe(1);
    expect(approachDepth(0.2, 0.8, 0, 1000)).toBe(0.8);
  });
});

describe("liveTrailAccumulationLimits", () => {
  it("retains more history than the window and scales the event budget with it", () => {
    expect(liveTrailAccumulationLimits("count", 80)).toEqual({
      maxGroups: 120,
      maxEvents: 18_000,
    });
    expect(liveTrailAccumulationLimits("count", 10).maxGroups).toBe(60);
    expect(liveTrailAccumulationLimits("coverage", 10).maxGroups).toBe(240);
  });
});
