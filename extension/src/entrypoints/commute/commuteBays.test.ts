// ABOUTME: Verifies window bay geometry and proximity detection in the carriage.
// ABOUTME: Guards the five glazed gaps riders walk into to wipe the glass.

import { describe, expect, it } from "vitest";
import {
  COMMUTE_BAYS,
  findNearbyCommuteBay,
  getBayStandingPosition,
} from "./commuteBays";

describe("COMMUTE_BAYS", () => {
  it("defines five bays with unique ids", () => {
    expect(COMMUTE_BAYS).toHaveLength(5);
    expect(new Set(COMMUTE_BAYS.map((bay) => bay.id)).size).toBe(5);
  });

  it("splits the bays across both walls", () => {
    expect(COMMUTE_BAYS.filter((bay) => bay.wall === "top")).toHaveLength(3);
    expect(COMMUTE_BAYS.filter((bay) => bay.wall === "bottom")).toHaveLength(2);
  });

  it("keeps every bay inside the carriage", () => {
    for (const bay of COMMUTE_BAYS) {
      expect(bay.x).toBeGreaterThan(0);
      expect(bay.x + bay.width).toBeLessThan(1100);
    }
  });
});

describe("findNearbyCommuteBay", () => {
  it("finds the bay a rider is standing in", () => {
    const bay = COMMUTE_BAYS[0];
    expect(findNearbyCommuteBay(getBayStandingPosition(bay))?.id).toBe(bay.id);
  });

  it("returns null in the middle of the aisle", () => {
    expect(findNearbyCommuteBay({ x: 360, y: 180 })).toBeNull();
  });

  it("prefers the closest bay when two are in range", () => {
    const first = getBayStandingPosition(COMMUTE_BAYS[3]);
    expect(findNearbyCommuteBay({ x: first.x + 8, y: first.y })?.id).toBe(
      COMMUTE_BAYS[3].id,
    );
  });
});
