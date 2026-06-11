// ABOUTME: Pure helpers for planning and drawing animated cursor trail frames.
// ABOUTME: Keeps hot animation-loop calculations testable and allocation-light.

import { getStroke } from "perfect-freehand";

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

  // Clamp to valid bounds — callers occasionally pass indices derived from a
  // separate progress basis that can run past the array (e.g. a snapshotted
  // trail whose point count differs from the progress assumption).
  const lo = Math.max(0, startIndex);
  const hi = Math.min(endIndex, points.length - 1);
  if (lo > hi) return "";

  let path = `M ${points[lo].x} ${points[lo].y}`;
  for (let i = lo + 1; i <= hi; i++) {
    path += ` L ${points[i].x} ${points[i].y}`;
  }

  if (interpolatedHead) {
    path += ` L ${interpolatedHead.x} ${interpolatedHead.y}`;
  }

  return path;
}

// Tuned for replayed cursor movement: the body stays a uniform width
// (velocity-based thinning swings too wildly on real cursor data), with
// explicit tapers at the ends for the hand-drawn feel. Low streamline keeps
// the live head close to the cursor icon instead of lagging behind it.
const FREEHAND_OPTIONS = {
  thinning: 0,
  smoothing: 0.5,
  streamline: 0.25,
  simulatePressure: false,
  start: { taper: 20 },
  end: { taper: 20 },
};

// Converts a perfect-freehand outline polygon into a closed SVG path,
// smoothing between outline points with quadratic midpoint curves.
function getSvgPathFromStroke(outline: number[][]): string {
  if (outline.length < 3) return "";

  let path = `M ${outline[0][0].toFixed(2)} ${outline[0][1].toFixed(2)} Q`;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    path += ` ${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)}`;
  }

  return path + " Z";
}

// Builds a filled freehand-stroke outline for a window of trail points. The
// stroke width is baked into the geometry, so the result must be rendered
// with fill rather than stroke. While the trail is still drawing
// (isComplete: false) the head is left untapered so it tracks the cursor.
export function buildFreehandPathSegment(
  points: Array<{ x: number; y: number }>,
  startIndex: number,
  endIndex: number,
  size: number,
  isComplete: boolean,
  interpolatedHead?: { x: number; y: number },
): string {
  if (points.length === 0 || startIndex > endIndex) return "";

  const inputPoints: Array<{ x: number; y: number }> = [];
  for (let i = startIndex; i <= endIndex; i++) {
    inputPoints.push(points[i]);
  }
  if (interpolatedHead) {
    inputPoints.push(interpolatedHead);
  }

  const outline = getStroke(inputPoints, {
    ...FREEHAND_OPTIONS,
    size,
    last: isComplete,
  });

  return getSvgPathFromStroke(outline);
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
