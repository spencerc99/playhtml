// ABOUTME: Shared types for quarantine tape — the strip records and DTOs exchanged with the worker.
// ABOUTME: A strip is the unit; a verdict is the set of strips for a URL.

export type Wall = "top" | "right" | "bottom" | "left";
export type TapeType = "slop" | "spam";

export interface EdgePoint {
  wall: Wall;
  t: number; // 0..1 along the wall
}

export interface RipMark {
  by: string;
  at: number;
  pos: number; // 0..1 along the strip
}

/** A strip as the worker returns it (and as the client renders it). */
export interface Strip {
  id: string;
  type: TapeType;
  a: EdgePoint;
  b: EdgePoint;
  seed: number;
  createdBy: string;
  createdAt: string;
  rips: RipMark[];
  ripsRequired: number | null;
}

/**
 * A mark on a single image, keyed by its src. Same shape as a strip minus the
 * wall geometry — an image tape is an X across the element's bounds, positioned
 * from the live element at render time, not stored coordinates.
 */
export interface ElementMark {
  id: string;
  src: string;
  type: TapeType;
  seed: number;
  createdBy: string;
  createdAt: string;
  rips: RipMark[];
  ripsRequired: number | null;
}

export const SET_THRESHOLD = 3;

/** True for a strip OR an element mark — both carry rips + ripsRequired. */
export function isFullyTorn(s: { rips: RipMark[]; ripsRequired: number | null }): boolean {
  return s.ripsRequired !== null && s.rips.length >= s.ripsRequired;
}
