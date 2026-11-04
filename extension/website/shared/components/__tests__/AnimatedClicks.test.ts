// ABOUTME: Tests continuous click playback residue across cycles and archive batches.
// ABOUTME: Verifies replayed click effects replace prior marks within a fixed bound.
import { describe, expect, it } from "vitest";
import type { VisibleClickEffect } from "../AnimatedClicks";
import {
  getClickResidueOpacity,
  MAX_VISIBLE_CLICK_EFFECTS,
  mergeClickEffects,
} from "../AnimatedClicks";

function makeEffect(sourceId: string, startTime: number): VisibleClickEffect {
  return {
    id: `${sourceId}-${startTime}`,
    sourceId,
    x: startTime,
    y: startTime,
    color: "#111",
    radiusFactor: 0.5,
    durationFactor: 0.5,
    startTime,
    trailIndex: 0,
    completed: true,
  };
}

describe("AnimatedClicks residue", () => {
  it("keeps active ripples fully opaque", () => {
    expect(getClickResidueOpacity(0, MAX_VISIBLE_CLICK_EFFECTS, false)).toBe(1);
  });

  it("keeps the newest completed ripple fully opaque", () => {
    expect(getClickResidueOpacity(99, 100, true)).toBe(1);
    expect(
      getClickResidueOpacity(
        MAX_VISIBLE_CLICK_EFFECTS - 1,
        MAX_VISIBLE_CLICK_EFFECTS,
        true,
      ),
    ).toBe(1);
  });

  it("uses fixed distance from newest rather than current list size", () => {
    expect(getClickResidueOpacity(0, 100, true)).toBeCloseTo(
      getClickResidueOpacity(3900, MAX_VISIBLE_CLICK_EFFECTS, true),
    );
  });

  it("linearly fades completed ripples toward transparency at the cap", () => {
    expect(
      getClickResidueOpacity(0, MAX_VISIBLE_CLICK_EFFECTS, true),
    ).toBeCloseTo(0.03);
    const midpointOpacity = getClickResidueOpacity(
      2000,
      MAX_VISIBLE_CLICK_EFFECTS,
      true,
    );
    expect(midpointOpacity).toBeGreaterThan(0.5);
    expect(midpointOpacity).toBeLessThan(0.52);
  });

  it("keeps substantially more completed ripples before eviction", () => {
    expect(MAX_VISIBLE_CLICK_EFFECTS).toBeGreaterThanOrEqual(4000);
  });

  it("retains earlier generations when a click is replayed", () => {
    const current = [makeEffect("click-a", 1), makeEffect("click-b", 1)];
    const next = mergeClickEffects(current, [makeEffect("click-a", 2)]);

    expect(next.map((effect) => effect.id)).toEqual([
      "click-a-1",
      "click-b-1",
      "click-a-2",
    ]);
  });

  it("keeps archive playback residue bounded", () => {
    const current = Array.from(
      { length: MAX_VISIBLE_CLICK_EFFECTS },
      (_, index) => makeEffect(`previous-${index}`, index),
    );
    const next = mergeClickEffects(current, [makeEffect("incoming", 9999)]);

    expect(next).toHaveLength(MAX_VISIBLE_CLICK_EFFECTS);
    expect(next[0].sourceId).toBe("previous-1");
    expect(next.at(-1)?.sourceId).toBe("incoming");
  });
});
