// ABOUTME: Covers strap reach detection and the pump/decay swing physics.
// ABOUTME: Guards that a strap goes dead once a rider stops wiggling.

import { describe, expect, it } from "vitest";
import {
  MAX_SWING,
  STRAP_BAND_Y,
  decaySwing,
  findStrapGrip,
  isSameGrip,
  pumpSwing,
} from "./strapHold";

describe("findStrapGrip", () => {
  it("grabs the band a rider is standing under", () => {
    const grip = findStrapGrip({ x: 400, y: STRAP_BAND_Y[0] });
    expect(grip?.bandIndex).toBe(0);
  });

  it("reaches the lower band too", () => {
    expect(findStrapGrip({ x: 400, y: STRAP_BAND_Y[1] })?.bandIndex).toBe(1);
  });

  it("lets go in the aisle between the bands", () => {
    expect(findStrapGrip({ x: 400, y: 179 })).toBeNull();
  });

  it("finds no strap past the end of the band", () => {
    expect(findStrapGrip({ x: 20, y: STRAP_BAND_Y[0] })).toBeNull();
  });

  it("snaps neighbouring riders to different straps", () => {
    const left = findStrapGrip({ x: 400, y: STRAP_BAND_Y[0] });
    const right = findStrapGrip({ x: 440, y: STRAP_BAND_Y[0] });
    expect(isSameGrip(left, right)).toBe(false);
  });

  it("snaps riders at the same strap to one grip", () => {
    const a = findStrapGrip({ x: 400, y: STRAP_BAND_Y[0] });
    const b = findStrapGrip({ x: 404, y: STRAP_BAND_Y[0] - 4 });
    expect(isSameGrip(a, b)).toBe(true);
  });
});

describe("pumpSwing", () => {
  it("ignores movement that has not reversed direction", () => {
    expect(pumpSwing(4, false, 10)).toBe(4);
  });

  it("adds to the swing when the rider wiggles back", () => {
    expect(pumpSwing(4, true, 10)).toBeGreaterThan(4);
  });

  it("caps how high the swing goes", () => {
    expect(pumpSwing(MAX_SWING, true, 500)).toBe(MAX_SWING);
  });
});

describe("decaySwing", () => {
  it("bleeds the swing away when input stops", () => {
    expect(decaySwing(10, 1000)).toBeLessThan(10);
  });

  it("settles to a dead stop", () => {
    expect(decaySwing(0.04, 1000)).toBe(0);
  });
});
