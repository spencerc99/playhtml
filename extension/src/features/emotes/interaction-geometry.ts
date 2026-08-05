// ABOUTME: Pure geometry helpers for two-cursor interaction emotes — angle, distance, clamped travel.
// ABOUTME: No DOM; consumed by InteractionRenderer to compute WAAPI transforms between sender and target.

export interface Point {
  x: number;
  y: number;
}

/** Angle in degrees from `from` to `to`, using standard screen coordinates (y grows downward). */
export function angleDeg(from: Point, to: Point): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

export function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** A point `dist` px from `from` along the angle toward `to`, capped at `maxDist` and at the actual gap. */
export function travelToward(from: Point, to: Point, dist: number, maxDist: number): Point {
  const gap = distance(from, to);
  const travel = Math.min(dist, maxDist, gap);
  const rad = Math.atan2(to.y - from.y, to.x - from.x);
  return { x: from.x + Math.cos(rad) * travel, y: from.y + Math.sin(rad) * travel };
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
