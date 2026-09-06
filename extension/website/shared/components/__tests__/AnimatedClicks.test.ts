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
  };
}

describe("AnimatedClicks residue", () => {
  it("fades older residue while keeping recent clicks at full opacity", () => {
    expect(getClickResidueOpacity(0, 100)).toBeCloseTo(0.03);
    expect(getClickResidueOpacity(49, 100)).toBeGreaterThan(0.03);
    expect(getClickResidueOpacity(75, 100)).toBe(1);
    expect(getClickResidueOpacity(99, 100)).toBe(1);
  });

  it("keeps substantially more completed ripples before eviction", () => {
    expect(MAX_VISIBLE_CLICK_EFFECTS).toBeGreaterThanOrEqual(4000);
  });

  it("replaces a replayed click without clearing unrelated marks", () => {
    const current = [makeEffect("click-a", 1), makeEffect("click-b", 1)];
    const next = mergeClickEffects(current, [makeEffect("click-a", 2)]);

    expect(next.map((effect) => effect.id)).toEqual([
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
