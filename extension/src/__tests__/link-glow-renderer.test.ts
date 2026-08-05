// ABOUTME: Tests how Wikipedia link-click counts translate into visible patina intensity.
// ABOUTME: Verifies the first click leaves a distinct mark without flattening later growth.

import { describe, expect, it } from "vitest";
import { computeIntensity } from "../features/link-glow-renderer";

describe("computeIntensity", () => {
  it("gives the first click visible intensity even when another link has heavy traffic", () => {
    expect(computeIntensity(1, 100)).toBeGreaterThanOrEqual(0.12);
  });

  it("continues increasing as a link accumulates clicks", () => {
    const firstClick = computeIntensity(1, 100);
    const tenClicks = computeIntensity(10, 100);
    const hundredClicks = computeIntensity(100, 100);

    expect(tenClicks).toBeGreaterThan(firstClick);
    expect(hundredClicks).toBeGreaterThan(tenClicks);
  });

  it("does not render links with no clicks", () => {
    expect(computeIntensity(0, 100)).toBe(0);
  });
});
