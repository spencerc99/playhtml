// ABOUTME: Pure helpers for planning and drawing animated cursor trail frames.
// ABOUTME: Keeps hot animation-loop calculations testable and allocation-light.

export interface FinishedTrailOrderEntry {
  originalIndex: number;
  finishedAtMs: number;
}

export interface FinishedTrailRenderRange {
  start: number;
  end: number;
  finishedCount: number;
}

export function buildStraightPathSegment(
  points: Array<{ x: number; y: number }>,
  startIndex: number,
  endIndex: number,
  interpolatedHead?: { x: number; y: number },
): string {
  if (points.length === 0 || startIndex > endIndex) return "";

  let path = `M ${points[startIndex].x} ${points[startIndex].y}`;
  for (let i = startIndex + 1; i <= endIndex; i++) {
    path += ` L ${points[i].x} ${points[i].y}`;
  }

  if (interpolatedHead) {
    path += ` L ${interpolatedHead.x} ${interpolatedHead.y}`;
  }

  return path;
}

export function getFinishedTrailRenderRange(
  sortedFinishOrder: FinishedTrailOrderEntry[],
  elapsedTimeMs: number,
  windowSize: number,
  evictionFadeMs: number,
): FinishedTrailRenderRange {
  const finishedCount = getFinishedCount(sortedFinishOrder, elapsedTimeMs);
  if (finishedCount === 0) {
    return { start: 0, end: 0, finishedCount };
  }

  const excessCount = Math.max(0, finishedCount - windowSize);
  if (excessCount === 0) {
    return { start: 0, end: finishedCount, finishedCount };
  }

  const evictionCutoffMs = elapsedTimeMs - evictionFadeMs;
  let start = 0;
  while (
    start < excessCount &&
    sortedFinishOrder[start + windowSize].finishedAtMs <= evictionCutoffMs
  ) {
    start++;
  }

  return { start, end: finishedCount, finishedCount };
}

function getFinishedCount(
  sortedFinishOrder: FinishedTrailOrderEntry[],
  elapsedTimeMs: number,
): number {
  let low = 0;
  let high = sortedFinishOrder.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sortedFinishOrder[mid].finishedAtMs <= elapsedTimeMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/** Absolute timing for one live trail: when it started and how long it draws. */
export interface LiveTrailTiming {
  startMs: number;
  durationMs: number;
}

export interface LiveTrailWindow {
  /** Indices currently animating (start <= now < start+duration). */
  drawing: number[];
  /** Finished indices still visible (within windowSize, modulo eviction fade). */
  finished: number[];
}

/**
 * Pure live-trail windowing under a monotonic clock.
 *
 * Trails are timed by ABSOLUTE startMs (drift-free as old events fall off the
 * upstream cap). A trail draws once over its duration, then is "finished" and
 * stays visible until more than `windowSize` trails have finished AND the
 * eviction fade has elapsed — matching the looping animator's eviction
 * semantics on a non-looping clock.
 */
export function computeLiveTrailWindow(
  trails: LiveTrailTiming[],
  nowMs: number,
  windowSize: number,
  evictionFadeMs: number,
): LiveTrailWindow {
  const drawing: number[] = [];
  const finishedEntries: { index: number; finishedAtMs: number }[] = [];

  for (let i = 0; i < trails.length; i++) {
    const { startMs, durationMs } = trails[i];
    if (startMs > nowMs) continue; // not started yet
    const finishedAtMs = startMs + durationMs;
    if (finishedAtMs > nowMs) {
      drawing.push(i);
    } else {
      finishedEntries.push({ index: i, finishedAtMs });
    }
  }

  finishedEntries.sort((a, b) => a.finishedAtMs - b.finishedAtMs);
  const finishedCount = finishedEntries.length;
  const excess = Math.max(0, finishedCount - windowSize);

  const finished: number[] = [];
  for (let pos = 0; pos < finishedCount; pos++) {
    if (pos < excess) {
      const displacer = finishedEntries[pos + windowSize];
      const evictedAtMs = displacer ? displacer.finishedAtMs : nowMs;
      if (nowMs - evictedAtMs >= evictionFadeMs) continue; // fully evicted
    }
    finished.push(finishedEntries[pos].index);
  }

  return { drawing, finished };
}
