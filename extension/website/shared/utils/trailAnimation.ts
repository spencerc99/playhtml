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
