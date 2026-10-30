// ABOUTME: Two-finger pinch and twist on the pieces in hand: spread to grow, turn to rotate, slide to move.
// ABOUTME: Pure geometry, measured from where both fingers first landed, so a pinch never drifts.

import { boxCenter, type Point } from "./collageGeometry";
import {
  MIN_GROUP_FACTOR,
  angleAbout,
  groupBounds,
  rotateGroup,
  scaleGroup,
  translateGroup,
  type FlippableBox,
} from "./groupGeometry";

/** Where the two fingers are, in frame units. */
export interface FingerPair {
  a: Point;
  b: Point;
}

/** Fingers closer than this when they land give no steady reading of spread or turn. */
const MIN_SPREAD = 1;

function midpoint(pair: FingerPair): Point {
  return { x: (pair.a.x + pair.b.x) / 2, y: (pair.a.y + pair.b.y) / 2 };
}

function spread(pair: FingerPair): number {
  return Math.hypot(pair.b.x - pair.a.x, pair.b.y - pair.a.y);
}

/** How much the fingers have spread and turned since they landed. */
export function pinchChange(
  start: FingerPair,
  now: FingerPair,
): { factor: number; degrees: number; shift: Point } {
  const startSpread = Math.max(MIN_SPREAD, spread(start));
  const factor = Math.max(MIN_GROUP_FACTOR, spread(now) / startSpread);
  const degrees =
    angleAbout(now.a, now.b) - angleAbout(start.a, start.b);
  const from = midpoint(start);
  const to = midpoint(now);
  return { factor, degrees, shift: { x: to.x - from.x, y: to.y - from.y } };
}

/**
 * The pieces as the pinch leaves them: grown by the change in spread and
 * turned by the change in angle, both about the middle of the pieces as they
 * were, then carried along with the point between the fingers.
 */
export function pinchedPieces<T extends FlippableBox>(
  before: readonly T[],
  start: FingerPair,
  now: FingerPair,
): T[] {
  if (before.length === 0) return [];
  const center = boxCenter(groupBounds(before));
  const { factor, degrees, shift } = pinchChange(start, now);
  const grown = scaleGroup(before, { anchor: center, x: factor, y: factor });
  const turned = rotateGroup(grown, center, degrees);
  return translateGroup(turned, shift.x, shift.y);
}
