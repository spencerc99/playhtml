// ABOUTME: Tests continuous decay for rasterized click residue.
// ABOUTME: Verifies fading has no abrupt lifetime or capacity cutoff.
import { describe, expect, it } from "vitest";
import {
  CLICK_RESIDUE_HALF_LIFE_MS,
  getResidueFadeAlpha,
} from "../ClickResidueCanvas";

describe("ClickResidueCanvas fading", () => {
  it("uses a three-minute visual half-life", () => {
    expect(CLICK_RESIDUE_HALF_LIFE_MS).toBe(3 * 60_000);
  });

  it("fades continuously by half-life", () => {
    expect(getResidueFadeAlpha(0)).toBe(0);
    expect(getResidueFadeAlpha(CLICK_RESIDUE_HALF_LIFE_MS)).toBeCloseTo(0.5);
    expect(getResidueFadeAlpha(CLICK_RESIDUE_HALF_LIFE_MS * 2)).toBeCloseTo(
      0.75,
    );
  });

  it("composes short fade ticks into the same long-term decay", () => {
    const tickAlpha = getResidueFadeAlpha(1000);
    const opacityAfterHalfLife =
      Math.pow(1 - tickAlpha, CLICK_RESIDUE_HALF_LIFE_MS / 1000);

    expect(opacityAfterHalfLife).toBeCloseTo(0.5);
  });
});
