// ABOUTME: Checks how large a published picture is made for the piece it fills.
// ABOUTME: Covers density, crops, size steps and the cap.

import { describe, expect, it } from "vitest";
import { neededLongestSide } from "../entrypoints/scraps/publishPieceImages";

const FULL = { x: 0, y: 0, width: 1, height: 1 };

describe("neededLongestSide", () => {
  it("is twice the piece's longest side, rounded up to a step", () => {
    expect(neededLongestSide({ width: 300, height: 200, crop: FULL })).toBe(
      640,
    );
  });

  it("counts the whole picture when the piece shows only part of it", () => {
    const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
    expect(neededLongestSide({ width: 300, height: 200, crop })).toBe(1280);
  });

  it("stays between one step and the cap", () => {
    expect(neededLongestSide({ width: 10, height: 8, crop: FULL })).toBe(128);
    expect(neededLongestSide({ width: 4000, height: 900, crop: FULL })).toBe(
      2048,
    );
  });
});
