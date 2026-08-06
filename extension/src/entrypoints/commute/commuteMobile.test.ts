// ABOUTME: Verifies mobile commute movement, bounds, and proximity interactions.
// ABOUTME: Covers the geometry used by joystick walking, seating, and train doors.

import { describe, expect, it } from "vitest";
import {
  findNearbyCommuteSeat,
  getStandingPosition,
  isNearCommuteDoor,
  moveCommuteAvatar,
  type CommuteSeatGeometry,
} from "./commuteMobile";

const SEATS: CommuteSeatGeometry[] = [
  { id: 0, x: 44, y: 32, row: "top" },
  { id: 1, x: 100, y: 284, row: "bottom" },
];

describe("mobile commute geometry", () => {
  it("normalizes diagonal movement and clamps it inside the carriage", () => {
    expect(moveCommuteAvatar({ x: 100, y: 100 }, { x: 1, y: 1 }, 10)).toEqual({
      x: 100 + 10 / Math.sqrt(2),
      y: 100 + 10 / Math.sqrt(2),
    });
    expect(moveCommuteAvatar({ x: 38, y: 32 }, { x: -1, y: -1 }, 10)).toEqual({
      x: 38,
      y: 32,
    });
    expect(moveCommuteAvatar({ x: 1062, y: 316 }, { x: 1, y: 1 }, 10)).toEqual({
      x: 1062,
      y: 316,
    });
  });

  it("ignores joystick drift below the movement threshold", () => {
    const position = { x: 100, y: 100 };
    expect(moveCommuteAvatar(position, { x: 0.1, y: 0.1 })).toBe(position);
  });

  it("selects the closest free seat and ignores occupied seats", () => {
    expect(findNearbyCommuteSeat({ x: 70, y: 54 }, SEATS, new Set())).toEqual(
      SEATS[0],
    );
    expect(
      findNearbyCommuteSeat({ x: 70, y: 54 }, SEATS, new Set([0])),
    ).toBeNull();
  });

  it("recognizes the door threshold only along the top wall", () => {
    const doors = [{ x: 276 }, { x: 696 }];
    expect(isNearCommuteDoor({ x: 330, y: 80 }, doors)).toBe(true);
    expect(isNearCommuteDoor({ x: 330, y: 140 }, doors)).toBe(false);
    expect(isNearCommuteDoor({ x: 600, y: 80 }, doors)).toBe(false);
  });

  it("places a standing rider on the aisle side of either seat row", () => {
    expect(getStandingPosition(SEATS[0])).toEqual({ x: 69, y: 94 });
    expect(getStandingPosition(SEATS[1])).toEqual({ x: 125, y: 270 });
  });
});
