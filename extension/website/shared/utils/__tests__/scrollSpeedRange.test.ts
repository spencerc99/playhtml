// ABOUTME: Tests that a shared-link scroll speed is clamped to the slider range
// ABOUTME: of the page it lands on (live scrolling vs recorded installation timeline).

import { describe, expect, it } from "vitest";
import { clampScrollSpeed, scrollSpeedRange } from "../settingsSpec";

describe("clampScrollSpeed", () => {
  it("caps live scrolling at the 2x slider max", () => {
    expect(scrollSpeedRange(false)).toEqual({ min: 0.1, max: 2 });
    expect(clampScrollSpeed(10, false)).toBe(2);
    expect(clampScrollSpeed(0.35, false)).toBe(0.35);
  });

  it("allows up to 10x on the recorded installation timeline", () => {
    expect(clampScrollSpeed(10, true)).toBe(10);
    expect(clampScrollSpeed(25, true)).toBe(10);
  });

  it("raises values below the slider minimum", () => {
    expect(clampScrollSpeed(0, false)).toBe(0.1);
    expect(clampScrollSpeed(-3, true)).toBe(0.1);
  });
});
