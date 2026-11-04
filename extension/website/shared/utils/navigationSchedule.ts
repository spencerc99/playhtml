// ABOUTME: Maps navigation moments in the event data onto playback-clock offsets
// ABOUTME: so the navigation accent sounds in every view, not just the animated radial one

import { CollectionEvent } from "../types";

/** One navigation moment, positioned on the playback timeline. */
export interface ScheduledNavigation {
  /** Offset from the start of the playback cycle, in ms. */
  atMs: number;
  /** Source timestamp, kept for debugging and dedupe. */
  ts: number;
  /** Who navigated — one person's hops stay distinguishable. */
  pid: string;
}

/**
 * A real navigation event and an inferred one describing the same hop should
 * sound once, not twice. Datasets often carry both a navigation event and the
 * cursor events that straddle it.
 */
const INFERENCE_DEDUPE_MS = 3000;

/** Page identity for a cursor event, preferring the normalized form. */
function pageKey(event: CollectionEvent): string {
  return event.normalizedUrl || event.meta?.url || "";
}

/**
 * Build the navigation schedule for a dataset.
 *
 * Real `navigation` events are the primary source. Where a dataset has none or
 * few — the cursor collector samples far more densely than the navigation one —
 * a hop is also inferred from two consecutive cursor events by the same person
 * on different pages. Inferred moments are dropped when a real navigation for
 * that person already sits within a few seconds, so a dataset carrying both
 * sounds once per hop.
 *
 * @param events All collection events for the current dataset.
 * @param timeRangeMin Timestamp that playback offset 0 corresponds to. Pass 0
 *   when no cursor or keyboard viz is active to establish one — the range is
 *   then derived from the navigation moments themselves and their span scaled
 *   to fill the cycle, so the accent still tracks playback.
 * @param cycleDurationMs Length of one playback cycle; moments past it are dropped.
 */
export function buildNavigationSchedule(
  events: CollectionEvent[],
  timeRangeMin: number,
  cycleDurationMs: number,
): ScheduledNavigation[] {
  if (cycleDurationMs <= 0) return [];

  const real: ScheduledNavigation[] = [];
  for (const event of events) {
    if (event.type !== "navigation") continue;
    const pid = event.meta?.pid ?? "";
    real.push({ atMs: event.ts, ts: event.ts, pid });
  }

  // Index real navigations per person so the dedupe below is a lookup rather
  // than a scan of every navigation for every candidate.
  const realByPid = new Map<string, number[]>();
  for (const nav of real) {
    const list = realByPid.get(nav.pid);
    if (list) list.push(nav.ts);
    else realByPid.set(nav.pid, [nav.ts]);
  }
  for (const list of realByPid.values()) list.sort((a, b) => a - b);

  const hasRealNear = (pid: string, ts: number): boolean => {
    const list = realByPid.get(pid);
    if (!list) return false;
    for (const candidate of list) {
      if (Math.abs(candidate - ts) <= INFERENCE_DEDUPE_MS) return true;
      if (candidate > ts + INFERENCE_DEDUPE_MS) break;
    }
    return false;
  };

  // Infer hops from consecutive cursor events that change page.
  const cursorByPid = new Map<string, CollectionEvent[]>();
  for (const event of events) {
    if (event.type !== "cursor") continue;
    const pid = event.meta?.pid ?? "";
    const list = cursorByPid.get(pid);
    if (list) list.push(event);
    else cursorByPid.set(pid, [event]);
  }

  const inferred: ScheduledNavigation[] = [];
  for (const [pid, cursorEvents] of cursorByPid) {
    cursorEvents.sort((a, b) => a.ts - b.ts);
    let prevKey = pageKey(cursorEvents[0]);
    for (let i = 1; i < cursorEvents.length; i++) {
      const key = pageKey(cursorEvents[i]);
      if (!key || key === prevKey) {
        if (key) prevKey = key;
        continue;
      }
      prevKey = key;
      const ts = cursorEvents[i].ts;
      if (hasRealNear(pid, ts)) continue;
      inferred.push({ atMs: ts, ts, pid });
    }
  }

  const moments = [...real, ...inferred].sort((a, b) => a.ts - b.ts);
  if (moments.length === 0) return [];

  if (timeRangeMin > 0) {
    return moments
      .map((nav) => ({ ...nav, atMs: nav.ts - timeRangeMin }))
      .filter((nav) => nav.atMs >= 0 && nav.atMs < cycleDurationMs);
  }

  // No cursor or keyboard viz is active, so nothing else has established what
  // playback offset 0 means. Anchor on the first moment and scale the span to
  // fill the cycle, so the hops stay in their real relative rhythm and the run
  // lasts exactly one loop.
  const first = moments[0].ts;
  const span = moments[moments.length - 1].ts - first;
  if (span <= 0) return [{ ...moments[0], atMs: 0 }];

  // Leave a little room at the end so the final moment isn't landing exactly
  // on the wrap, where it would race the loop reset.
  const scale = (cycleDurationMs * 0.95) / span;
  return moments.map((nav) => ({ ...nav, atMs: (nav.ts - first) * scale }));
}

/**
 * Indices of the moments crossed between two playback positions.
 *
 * Playback loops, so `to` may be behind `from`. That wrap is a real replay of
 * the cycle rather than a seek, so it is covered as two spans: the tail of the
 * cycle and the head of the next.
 */
export function navigationsCrossed(
  schedule: ScheduledNavigation[],
  fromMs: number,
  toMs: number,
  cycleDurationMs: number,
): ScheduledNavigation[] {
  if (schedule.length === 0 || cycleDurationMs <= 0) return [];

  const inSpan = (start: number, end: number) =>
    schedule.filter((nav) => nav.atMs > start && nav.atMs <= end);

  if (toMs >= fromMs) return inSpan(fromMs, toMs);
  return [
    ...inSpan(fromMs, cycleDurationMs),
    ...inSpan(-1, toMs),
  ];
}
