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

export const SET_THRESHOLD = 3;

export function isFullyTorn(s: Strip): boolean {
  return s.ripsRequired !== null && s.rips.length >= s.ripsRequired;
}
