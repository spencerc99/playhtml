// ABOUTME: Verifies commute cursor movement, bounds, and proximity interactions.
// ABOUTME: Covers geometry used by clicking, joystick walking, seating, and doors.

import { describe, expect, it } from "vitest";
import {
  COMMUTE_JOIN_ENTRY_POSITION,
  findNearbyCommuteSeat,
  findNewCommuteRiders,
  getCommutePointFromClient,
  getCommutePointFromZone,
  getMyCommuteRiderStart,
  getCommuteRiderStart,
  getSharedCommutePosition,
  getStandingPosition,
  isNearCommuteDoor,
  moveCommuteAvatar,
  moveCommuteAvatarToward,
  shouldExitCommuteThroughDoor,
  type CommuteSeatGeometry,
} from "./commuteMobile";

const SEATS: CommuteSeatGeometry[] = [
  { id: 0, x: 44, y: 32, row: "top" },
  { id: 1, x: 100, y: 284, row: "bottom" },
];

describe("mobile commute geometry", () => {
  it("finds remote riders who appeared after the initial roster", () => {
    const previousRiderIds = new Set(["me", "rider-a"]);

    expect(
      findNewCommuteRiders(previousRiderIds, [
        { pid: "me", isMe: true },
        { pid: "rider-a", isMe: false },
        { pid: "rider-b", isMe: false },
      ]),
    ).toEqual(["rider-b"]);
    expect(previousRiderIds).toEqual(new Set(["me", "rider-a"]));
  });

  it("waits for the local rider identity before choosing an entry point", () => {
    expect(
      getMyCommuteRiderStart([{ pid: "rider-a", isMe: false }]),
    ).toBeNull();
    expect(
      getMyCommuteRiderStart([
        { pid: "rider-a", isMe: false },
        { pid: "me", isMe: true },
      ]),
    ).toEqual(getCommuteRiderStart("me"));
  });

  it("accepts bounded shared positions and rejects malformed presence", () => {
    expect(getSharedCommutePosition({ x: 500, y: 200 })).toEqual({
      x: 500,
      y: 200,
    });
    expect(getSharedCommutePosition({ x: 9_999, y: -20 })).toEqual({
      x: 1062,
      y: 32,
    });
    expect(getSharedCommutePosition({ x: "500", y: 200 })).toBeNull();
  });

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

  it("walks toward a clicked destination without overshooting it", () => {
    expect(
      moveCommuteAvatarToward({ x: 100, y: 100 }, { x: 130, y: 100 }, 10),
    ).toEqual({ position: { x: 110, y: 100 }, arrived: false });
    expect(
      moveCommuteAvatarToward({ x: 125, y: 100 }, { x: 130, y: 100 }, 10),
    ).toEqual({ position: { x: 130, y: 100 }, arrived: true });
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

  it("exits only while walking upward into an open destination door", () => {
    const doors = [{ x: 276 }, { x: 696 }];
    const doorway = { x: 330, y: 80 };

    expect(
      shouldExitCommuteThroughDoor(doorway, { x: 0, y: -1 }, doors, true),
    ).toBe(true);
    expect(
      shouldExitCommuteThroughDoor(doorway, { x: 0, y: 1 }, doors, true),
    ).toBe(false);
    expect(
      shouldExitCommuteThroughDoor(doorway, { x: 0, y: -1 }, doors, false),
    ).toBe(false);
  });

  it("places a standing rider on the aisle side of either seat row", () => {
    expect(getStandingPosition(SEATS[0])).toEqual({ x: 69, y: 94 });
    expect(getStandingPosition(SEATS[1])).toEqual({ x: 125, y: 270 });
  });

  it("maps desktop clicks and shared cursor zones into carriage coordinates", () => {
    expect(
      getCommutePointFromClient(
        { x: 375, y: 140 },
        { left: 100, top: 50, width: 550, height: 180 },
      ),
    ).toEqual({ x: 550, y: 180 });
    expect(getCommutePointFromZone(0.5, 0.5)).toEqual({ x: 550, y: 180 });
    expect(getCommutePointFromZone(-1, 2)).toEqual({ x: 38, y: 316 });
  });

  it("gives every rider a stable visible position before they move", () => {
    const first = getCommuteRiderStart("rider-without-cursor-data");
    const second = getCommuteRiderStart("another-rider");

    expect(getCommuteRiderStart("rider-without-cursor-data")).toEqual(first);
    expect(first).not.toEqual(second);
    expect(first.x).toBeGreaterThanOrEqual(38);
    expect(first.x).toBeLessThanOrEqual(1062);
    expect(first.y).toBeGreaterThanOrEqual(32);
    expect(first.y).toBeLessThanOrEqual(316);
  });
});
