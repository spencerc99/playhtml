// ABOUTME: Tests click ripple sizing for holds and concentric ring density.
// ABOUTME: Verifies configured radius limits remain absolute after hold scaling.
import { describe, expect, it } from "vitest";
import {
  getHoldMultiplier,
  getRippleMaxRadius,
  getRippleRingCount,
} from "../ClickRipple";

const radiusSettings = {
  clickMinRadius: 12,
  clickMaxRadius: 55,
};

describe("ClickRipple sizing", () => {
  it("caps long-hold scaling and the final radius", () => {
    expect(getHoldMultiplier(10_000)).toBe(3);
    expect(getRippleMaxRadius(1, 10_000, radiusSettings)).toBe(55);
    expect(getRippleMaxRadius(0.5, 2_000, radiusSettings)).toBe(55);
  });

  it("preserves ordinary click radius variation below the cap", () => {
    expect(getRippleMaxRadius(0, undefined, radiusSettings)).toBe(12);
    expect(getRippleMaxRadius(0.5, undefined, radiusSettings)).toBe(33.5);
  });

  it("varies concentric rings independently from two to the configured maximum", () => {
    const ringSettings = { clickNumRings: 6 };

    expect(getRippleRingCount(0, ringSettings)).toBe(2);
    expect(getRippleRingCount(0.2, ringSettings)).toBe(3);
    expect(getRippleRingCount(0.5, ringSettings)).toBe(4);
    expect(getRippleRingCount(0.8, ringSettings)).toBe(6);
    expect(getRippleRingCount(1, ringSettings)).toBe(6);
  });
});
