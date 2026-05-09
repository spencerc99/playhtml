// ABOUTME: Bins events into time buckets and ranks sustained activity windows
// ABOUTME: Used by the dev panel to find time spans worth showcasing as artifacts

import type { CollectionEvent } from "../types";

export interface HotspotBucket {
  /** Start of the bucket window, in ms since epoch. */
  startMs: number;
  /** End of the bucket window (exclusive), in ms since epoch. */
  endMs: number;
  /** Total events that fell in this bucket after type filtering. */
  eventCount: number;
  /** Distinct participant ids (`pid`) seen in this bucket. */
  uniquePids: number;
  /** Distinct browser sessions (`sid`) seen in this bucket. */
  uniqueSids: number;
  /** Distinct domains seen in this bucket. */
  uniqueDomains: number;
  /** Per-event-type count breakdown (cursor sub-event or top-level type). */
  typeBreakdown: Record<string, number>;
}

export interface HotspotOptions {
  /** Bucket size in ms. */
  bucketMs: number;
  /**
   * Optional event-type allowlist. Matches against the cursor sub-event
   * (`event.data.event` for cursor events) or the top-level `event.type`
   * for everything else. If empty/undefined, all events count.
   */
  allowedTypes?: Set<string>;
  /** Optional restriction to events within this absolute-time range. */
  rangeMs?: { startMs: number; endMs: number };
}

const eventCategory = (e: CollectionEvent): string => {
  if (e.type === "cursor") {
    return e.data?.event ?? "move";
  }
  return e.type;
};

/**
 * Distinct event categories present in the dataset, useful for populating
 * a filter UI. Sorted for stable display.
 */
export const collectEventCategories = (
  events: CollectionEvent[],
): string[] => {
  const set = new Set<string>();
  for (const e of events) set.add(eventCategory(e));
  return Array.from(set).sort();
};

/**
 * Bin events into fixed-width time windows. Buckets are aligned to absolute
 * epoch boundaries (e.g. for a 1h bucket, every bucket starts on the hour)
 * so the same bucket grid is reproducible across reloads.
 *
 * Empty buckets between the first and last populated bucket are emitted with
 * zero counts — this gives downstream consumers (the activity strip) a
 * continuous time axis without per-render gap-filling.
 */
export const computeHotspots = (
  events: CollectionEvent[],
  { bucketMs, allowedTypes, rangeMs }: HotspotOptions,
): HotspotBucket[] => {
  if (!events.length || bucketMs <= 0) return [];

  const byBucket = new Map<
    number,
    {
      pids: Set<string>;
      sids: Set<string>;
      domains: Set<string>;
      types: Map<string, number>;
      count: number;
    }
  >();

  let minBucket = Infinity;
  let maxBucket = -Infinity;

  for (const e of events) {
    if (rangeMs && (e.ts < rangeMs.startMs || e.ts >= rangeMs.endMs)) continue;
    const cat = eventCategory(e);
    if (allowedTypes && allowedTypes.size > 0 && !allowedTypes.has(cat))
      continue;

    const bucketStart = Math.floor(e.ts / bucketMs) * bucketMs;
    if (bucketStart < minBucket) minBucket = bucketStart;
    if (bucketStart > maxBucket) maxBucket = bucketStart;

    let bucket = byBucket.get(bucketStart);
    if (!bucket) {
      bucket = {
        pids: new Set(),
        sids: new Set(),
        domains: new Set(),
        types: new Map(),
        count: 0,
      };
      byBucket.set(bucketStart, bucket);
    }
    bucket.count++;
    if (e.meta?.pid) bucket.pids.add(e.meta.pid);
    if (e.meta?.sid) bucket.sids.add(e.meta.sid);
    if (e.domain) bucket.domains.add(e.domain);
    bucket.types.set(cat, (bucket.types.get(cat) ?? 0) + 1);
  }

  if (!isFinite(minBucket)) return [];

  const out: HotspotBucket[] = [];
  for (let start = minBucket; start <= maxBucket; start += bucketMs) {
    const b = byBucket.get(start);
    out.push({
      startMs: start,
      endMs: start + bucketMs,
      eventCount: b?.count ?? 0,
      uniquePids: b?.pids.size ?? 0,
      uniqueSids: b?.sids.size ?? 0,
      uniqueDomains: b?.domains.size ?? 0,
      typeBreakdown: b ? Object.fromEntries(b.types) : {},
    });
  }
  return out;
};

/**
 * Pick a bucket size that gives the activity strip ~targetBars columns
 * across the visible time span. Snaps to "nice" intervals (1m / 5m / 15m /
 * 1h / 6h / 1d) so timestamps land on round numbers.
 */
const NICE_BUCKETS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
];
export const pickStripBucketMs = (
  spanMs: number,
  targetBars = 160,
): number => {
  if (spanMs <= 0) return NICE_BUCKETS_MS[0];
  const ideal = spanMs / targetBars;
  for (const b of NICE_BUCKETS_MS) {
    if (b >= ideal) return b;
  }
  return NICE_BUCKETS_MS[NICE_BUCKETS_MS.length - 1];
};

export interface SustainedWindow {
  startMs: number;
  endMs: number;
  /** Window length in ms — equal to the user's chosen targetWindowMs. */
  durationMs: number;
  /** Sum of unique-people counts across the buckets covered. Used as the
   * primary headline metric for ranking. */
  totalPids: number;
  /** Smallest unique-people count among buckets in the window. High floor =
   * sustained presence rather than a brief spike. */
  minPidsPerBucket: number;
  /** Average unique-people count across buckets, useful for display. */
  meanPidsPerBucket: number;
  /** Total events across the window. */
  eventCount: number;
  /** How many of the window's buckets have at least one event. Used to
   * prefer windows that are densely covered, not mostly idle. */
  occupiedBuckets: number;
  /** Number of buckets in the window. */
  bucketCount: number;
}

/**
 * Rank fixed-length windows by sustained unique-people activity.
 *
 * Slides a `targetWindowMs`-wide window across the bucket grid and scores
 * each position by `minPidsPerBucket × occupied_buckets`. The product
 * rewards windows where unique-people stays high across the *whole* span
 * (sustained) rather than spiking briefly. Returns the top non-overlapping
 * windows so the list isn't dominated by neighbouring offsets of the same
 * peak.
 */
export const rankSustainedWindows = (
  buckets: HotspotBucket[],
  targetWindowMs: number,
  limit = 10,
): SustainedWindow[] => {
  if (buckets.length === 0) return [];
  const bucketMs = buckets[0].endMs - buckets[0].startMs;
  if (bucketMs <= 0) return [];

  const windowSizeBuckets = Math.max(
    1,
    Math.round(targetWindowMs / bucketMs),
  );
  if (buckets.length < windowSizeBuckets) {
    // Span is shorter than the requested window — return the whole thing as
    // a single result rather than nothing.
    const all = buckets;
    const totalPids = all.reduce((s, b) => s + b.uniquePids, 0);
    const minPids = all.reduce(
      (m, b) => Math.min(m, b.uniquePids),
      Infinity,
    );
    return [
      {
        startMs: all[0].startMs,
        endMs: all[all.length - 1].endMs,
        durationMs: all[all.length - 1].endMs - all[0].startMs,
        totalPids,
        minPidsPerBucket: isFinite(minPids) ? minPids : 0,
        meanPidsPerBucket: totalPids / all.length,
        eventCount: all.reduce((s, b) => s + b.eventCount, 0),
        occupiedBuckets: all.filter((b) => b.eventCount > 0).length,
        bucketCount: all.length,
      },
    ];
  }

  const candidates: SustainedWindow[] = [];
  for (let i = 0; i + windowSizeBuckets <= buckets.length; i++) {
    let totalPids = 0;
    let minPids = Infinity;
    let eventCount = 0;
    let occupied = 0;
    for (let j = i; j < i + windowSizeBuckets; j++) {
      const b = buckets[j];
      totalPids += b.uniquePids;
      if (b.uniquePids < minPids) minPids = b.uniquePids;
      eventCount += b.eventCount;
      if (b.eventCount > 0) occupied++;
    }
    candidates.push({
      startMs: buckets[i].startMs,
      endMs: buckets[i + windowSizeBuckets - 1].endMs,
      durationMs: targetWindowMs,
      totalPids,
      minPidsPerBucket: isFinite(minPids) ? minPids : 0,
      meanPidsPerBucket: totalPids / windowSizeBuckets,
      eventCount,
      occupiedBuckets: occupied,
      bucketCount: windowSizeBuckets,
    });
  }

  // Score: floor of unique-people × how many buckets had any activity.
  // Tie-break by total people-bucket-mass so equally-sustained windows
  // with more total reach come out on top.
  const score = (w: SustainedWindow) =>
    w.minPidsPerBucket * w.occupiedBuckets;

  candidates.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sb !== sa) return sb - sa;
    return b.totalPids - a.totalPids;
  });

  // Greedy non-overlap: walk down the ranked list and skip candidates that
  // overlap one already chosen. Keeps the list a set of distinct moments.
  const chosen: SustainedWindow[] = [];
  for (const c of candidates) {
    if (chosen.length >= limit) break;
    const overlaps = chosen.some(
      (x) => c.startMs < x.endMs && c.endMs > x.startMs,
    );
    if (!overlaps) chosen.push(c);
  }
  return chosen;
};

/**
 * Count distinct participants/sessions/domains across the entire event
 * set without bucketing. Used by the Info readout.
 */
export const computeOverallStats = (events: CollectionEvent[]) => {
  const pids = new Set<string>();
  const sids = new Set<string>();
  const domains = new Set<string>();
  for (const e of events) {
    if (e.meta?.pid) pids.add(e.meta.pid);
    if (e.meta?.sid) sids.add(e.meta.sid);
    if (e.domain) domains.add(e.domain);
  }
  return {
    uniquePids: pids.size,
    uniqueSids: sids.size,
    uniqueDomains: domains.size,
  };
};

/**
 * Smooth a per-bucket unique-pids signal into a "sustained-ness" score per
 * bucket. Each bucket's score is the average unique-pids across a small
 * neighbourhood — a brief 1-bucket spike scores near its own value, a
 * sustained run scores near the run's average. Used to drive the activity
 * strip's color saturation.
 */
export const computeSustainScores = (
  buckets: HotspotBucket[],
  windowSize = 5,
): number[] => {
  const half = Math.floor(windowSize / 2);
  return buckets.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(buckets.length - 1, i + half); j++) {
      sum += buckets[j].uniquePids;
      count++;
    }
    return count > 0 ? sum / count : 0;
  });
};
