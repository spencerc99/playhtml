// ABOUTME: Pure targeting logic for two-cursor interaction emotes.
// ABOUTME: nearestPeer picks a target by proximity; detectMutualHighFive pairs high-fives.

export interface CursorPoint {
  x: number;
  y: number;
}

export const DEFAULT_TARGET_RADIUS_PX = 400;
export const HIGHFIVE_WINDOW_MS = 1000;

export function nearestPeer(
  me: CursorPoint,
  peers: Map<string, CursorPoint | null>,
  radiusPx: number,
): string | null {
  let bestId: string | null = null;
  let bestDist = radiusPx;
  for (const [id, cursor] of peers) {
    if (!cursor) continue;
    const dx = cursor.x - me.x;
    const dy = cursor.y - me.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= bestDist) {
      bestDist = dist;
      bestId = id;
    }
  }
  return bestId;
}

export function detectMutualHighFive(
  myTs: number,
  peerTs: number | undefined,
  windowMs: number,
): boolean {
  if (peerTs === undefined) return false;
  return Math.abs(peerTs - myTs) <= windowMs;
}
