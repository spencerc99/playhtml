// ABOUTME: Spatiotemporal touch detection between cursor trails for the touches page
// ABOUTME: Finds moments when two cursors occupied the same spot at the same real time

import { Trail } from "../shared/types";

export interface CursorTouch {
  /** Real timestamp (ms) of the touch. */
  ts: number;
  x: number;
  y: number;
  colorA: string;
  colorB: string;
  /** Indices into the trails array. */
  trailA: number;
  trailB: number;
}

export interface TimeSegment {
  realStart: number;
  realEnd: number;
  /** Offset of this segment on the compressed playback timeline. */
  playStart: number;
}

const SAMPLE_MS = 100;
const PAIR_COOLDOWN_MS = 5000;
const MIN_OVERLAP_MS = 200;
/** A cursor only counts as "live" at a moment if its bracketing samples are
 * this close together. The collector records points only while the cursor
 * moves, so wide brackets mean it was parked or gone — interpolating across
 * them produces phantom touches from idle cursors. */
const LIVE_BRACKET_MS = 1200;

function participantOf(trail: Trail): string {
  return trail.id.split("|")[0];
}

/** Interpolated cursor position of a trail at a real timestamp, plus whether
 * the cursor was actually in motion there (tight sample bracket). */
export function motionAt(
  trail: Trail,
  ts: number,
): { x: number; y: number; live: boolean } {
  const points = trail.points;
  if (ts <= points[0].ts) return { ...points[0], live: false };
  if (ts >= points[points.length - 1].ts) {
    return { ...points[points.length - 1], live: false };
  }
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].ts <= ts) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.ts - a.ts;
  const t = span <= 0 ? 0 : (ts - a.ts) / span;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    live: span <= LIVE_BRACKET_MS,
  };
}

/** Interpolated cursor position of a trail at a real timestamp. */
export function positionAt(
  trail: Trail,
  ts: number,
): { x: number; y: number } {
  return motionAt(trail, ts);
}

/** Every moment two cursors from different trails came within radiusPx of
 * each other at the same real time. Pairs are found with a start-time sweep
 * so only time-overlapping trails are compared, then sampled at SAMPLE_MS
 * across their shared interval with a per-pair cooldown between touches. */
export function detectTouches(
  trails: Trail[],
  radiusPx: number,
  requireDifferentParticipant: boolean,
): CursorTouch[] {
  const touches: CursorTouch[] = [];

  const order = trails
    .map((_, index) => index)
    .sort((a, b) => trails[a].startTime - trails[b].startTime);
  const active: number[] = [];

  for (const index of order) {
    const trail = trails[index];
    for (let i = active.length - 1; i >= 0; i--) {
      if (trails[active[i]].endTime < trail.startTime) active.splice(i, 1);
    }

    for (const otherIndex of active) {
      const other = trails[otherIndex];
      if (
        requireDifferentParticipant &&
        participantOf(other) === participantOf(trail)
      ) {
        continue;
      }

      const overlapStart = Math.max(trail.startTime, other.startTime);
      const overlapEnd = Math.min(trail.endTime, other.endTime);
      if (overlapEnd - overlapStart < MIN_OVERLAP_MS) continue;

      let lastTouchTs = -Infinity;
      for (let ts = overlapStart; ts <= overlapEnd; ts += SAMPLE_MS) {
        if (ts - lastTouchTs < PAIR_COOLDOWN_MS) continue;
        const posA = motionAt(other, ts);
        const posB = motionAt(trail, ts);
        if (!posA.live || !posB.live) continue;
        if (Math.hypot(posA.x - posB.x, posA.y - posB.y) <= radiusPx) {
          touches.push({
            ts,
            x: (posA.x + posB.x) / 2,
            y: (posA.y + posB.y) / 2,
            colorA: other.color,
            colorB: trail.color,
            trailA: otherIndex,
            trailB: index,
          });
          lastTouchTs = ts;
        }
      }
    }

    active.push(index);
  }

  touches.sort((a, b) => a.ts - b.ts);
  return touches;
}

/** Compress the real timeline down to the stretches where at least two
 * trails were alive at once (padded), stitched together back to back —
 * touches can only happen there, and everything between is dead air. */
export function buildCoPresenceTimeline(
  trails: Trail[],
  padMs: number,
): { segments: TimeSegment[]; totalMs: number } {
  const boundaries: Array<{ ts: number; delta: number }> = [];
  for (const trail of trails) {
    boundaries.push({ ts: trail.startTime, delta: 1 });
    boundaries.push({ ts: trail.endTime, delta: -1 });
  }
  boundaries.sort((a, b) => a.ts - b.ts);

  const raw: Array<{ start: number; end: number }> = [];
  let count = 0;
  let openStart: number | null = null;
  for (const boundary of boundaries) {
    count += boundary.delta;
    if (count >= 2 && openStart === null) openStart = boundary.ts;
    if (count < 2 && openStart !== null) {
      raw.push({ start: openStart - padMs, end: boundary.ts + padMs });
      openStart = null;
    }
  }

  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of raw) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  let playStart = 0;
  const segments = merged.map((interval) => {
    const segment: TimeSegment = {
      realStart: interval.start,
      realEnd: interval.end,
      playStart,
    };
    playStart += interval.end - interval.start;
    return segment;
  });

  return { segments, totalMs: playStart };
}

/** Map a compressed-playback offset back to a real timestamp. */
export function playToReal(segments: TimeSegment[], playMs: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].playStart <= playMs) lo = mid;
    else hi = mid - 1;
  }
  const segment = segments[lo];
  return segment.realStart + (playMs - segment.playStart);
}

/** Map a real timestamp to its compressed-playback offset (timestamps inside
 * a gap clamp to the next segment's start). */
export function realToPlay(segments: TimeSegment[], realTs: number): number {
  for (const segment of segments) {
    if (realTs < segment.realStart) return segment.playStart;
    if (realTs <= segment.realEnd) {
      return segment.playStart + (realTs - segment.realStart);
    }
  }
  const last = segments[segments.length - 1];
  return last ? last.playStart + (last.realEnd - last.realStart) : 0;
}
