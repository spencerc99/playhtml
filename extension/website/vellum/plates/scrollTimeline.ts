// ABOUTME: Extracts a sorted (ts, scrollY) timeline from a sheet's viewport events and interpolates scroll position.
// ABOUTME: Shared by PagePlate (iframe translateY) and ScrollPlate (viewport-frame band) so both track scroll identically.
import type { CollectionEvent } from "../../shared/types";

export interface ScrollTimelinePoint {
  ts: number;
  scrollY: number;
}

interface ViewportEventData {
  event?: string;
  scrollY?: number;
}

/** Sorted list of {ts, scrollY} samples pulled from a sheet's viewport
 * events. `scrollY` is the normalized 0–1 scroll position the ViewportCollector
 * records (see extension/website/shared/hooks/useViewportScroll.ts, which
 * compares scrollY deltas against a 0.05 = 5% "visible change" threshold —
 * confirming the field is normalized, not a pixel offset). */
export function buildScrollTimeline(
  viewportEvents: CollectionEvent[],
): ScrollTimelinePoint[] {
  const points: ScrollTimelinePoint[] = [];
  for (const event of viewportEvents) {
    const data = event.data as unknown as ViewportEventData;
    if (data?.event !== "scroll" || typeof data.scrollY !== "number") continue;
    points.push({ ts: event.ts, scrollY: data.scrollY });
  }
  points.sort((a, b) => a.ts - b.ts);
  return points;
}

/** Linear interpolation of scrollY at `ts`. Steps to the first/last sample
 * when `ts` falls outside the timeline's range; returns 0 for an empty
 * timeline (a page with no recorded scrolling stays pinned to the top). */
export function scrollYAt(timeline: ScrollTimelinePoint[], ts: number): number {
  if (timeline.length === 0) return 0;
  if (ts <= timeline[0].ts) return timeline[0].scrollY;
  const last = timeline[timeline.length - 1];
  if (ts >= last.ts) return last.scrollY;

  // Binary search for the bracketing pair (timeline is sorted ascending).
  let lo = 0;
  let hi = timeline.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].ts <= ts) lo = mid;
    else hi = mid;
  }
  const a = timeline[lo];
  const b = timeline[hi];
  const span = b.ts - a.ts;
  const frac = span <= 0 ? 0 : (ts - a.ts) / span;
  return a.scrollY + (b.scrollY - a.scrollY) * frac;
}

/** Overall scroll range (max − min scrollY) across the timeline — mirrors
 * PagePreview's `scrollRange` input, which drives how tall the ghosted page
 * is rendered (more scroll range → taller synthetic page). */
export function scrollRangeOf(timeline: ScrollTimelinePoint[]): number {
  if (timeline.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const point of timeline) {
    if (point.scrollY < min) min = point.scrollY;
    if (point.scrollY > max) max = point.scrollY;
  }
  return max - min;
}

/** Maps sheet-local playback progress `t` (0–1) onto the sheet's own
 * [startTs, endTs] event-time range. */
export function sheetLocalTs(startTs: number, endTs: number, t: number): number {
  return startTs + t * (endTs - startTs);
}
