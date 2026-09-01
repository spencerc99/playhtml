// ABOUTME: Window bay geometry for the Internet Commute carriage.
// ABOUTME: Defines the five glazed gaps riders can walk into to wipe the glass.

import type { CommutePoint } from "./commuteMobile";

export interface CommuteBay {
  id: string;
  /** Left edge of the walkable gap inside the car. */
  x: number;
  width: number;
  /** Which wall the glass sits in. */
  wall: "top" | "bottom";
}

const BAY_INTERACTION_RADIUS = 46;

/**
 * Three mid-bank slots vacated by seats plus the two lower-wall gaps between
 * the doors and the neighbouring seat banks.
 */
export const COMMUTE_BAYS: CommuteBay[] = [
  { id: "bay-top-156", x: 154, width: 54, wall: "top" },
  { id: "bay-top-532", x: 530, width: 54, wall: "top" },
  { id: "bay-top-952", x: 950, width: 54, wall: "top" },
  { id: "bay-bottom-262", x: 272, width: 138, wall: "bottom" },
  { id: "bay-bottom-694", x: 704, width: 126, wall: "bottom" },
];

/** Where a rider stands when they walk into the bay. */
export function getBayStandingPosition(bay: CommuteBay): CommutePoint {
  return {
    x: bay.x + bay.width / 2,
    y: bay.wall === "top" ? 94 : 266,
  };
}

export function findNearbyCommuteBay(
  position: CommutePoint,
  bays: CommuteBay[] = COMMUTE_BAYS,
): CommuteBay | null {
  let nearest: CommuteBay | null = null;
  let nearestDistance = BAY_INTERACTION_RADIUS;

  for (const bay of bays) {
    const standing = getBayStandingPosition(bay);
    const distance = Math.hypot(
      position.x - standing.x,
      position.y - standing.y,
    );
    if (distance >= nearestDistance) continue;
    nearestDistance = distance;
    nearest = bay;
  }

  return nearest;
}
