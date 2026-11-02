// ABOUTME: Reads a finger's travel between press and release as a swipe in one direction, or none.
// ABOUTME: A swipe is quick, long enough, and mostly along one axis, so taps and wobbly drags never count.

export type SwipeDirection = "up" | "down" | "left" | "right";

/** How far a finger has to travel, in CSS pixels, before it is a swipe. */
export const SWIPE_MIN_DISTANCE = 36;

/** A slower movement is a deliberate drag, not a flick. */
export const SWIPE_MAX_DURATION_MS = 700;

/** How much further along the main axis than across it a swipe must go. */
const SWIPE_AXIS_RATIO = 1.5;

export function swipeDirection(
  dx: number,
  dy: number,
  elapsedMs: number,
): SwipeDirection | null {
  if (elapsedMs > SWIPE_MAX_DURATION_MS) return null;
  const across = Math.abs(dx);
  const along = Math.abs(dy);
  if (Math.max(across, along) < SWIPE_MIN_DISTANCE) return null;
  if (along >= across * SWIPE_AXIS_RATIO) return dy < 0 ? "up" : "down";
  if (across >= along * SWIPE_AXIS_RATIO) return dx < 0 ? "left" : "right";
  return null;
}
