/**
 * How much a page matters. Reach, not visits: you do not visit a URL, you
 * visit a place, so a busy host lifts its own quiet pages.
 *
 * Plot size and brightness both read this, and 05_build_map.py mirrors it —
 * the layout must reserve exactly the ground the viewer builds on.
 */

const HOST_FLOOR = 0.7;
/** too small to move a page across a tier */
const VISIT_NUDGE = 0.02;

export interface Refs {
  /** high percentile of per-page reach, so one outlier cannot flatten the map */
  reach: number;
  /** peak visits, for the tiebreak only */
  visits: number;
}

export function prominence(
  pageReach: number, hostReach: number, visits: number, ref: Refs,
): number {
  const lg = Math.log1p(ref.reach) || 1;
  const own = Math.min(1, Math.log1p(pageReach) / lg);
  const host = Math.min(1, Math.log1p(hostReach) / lg);
  const base = Math.max(own, host * HOST_FLOOR);
  return Math.min(1, base + VISIT_NUDGE * (Math.log1p(visits) / (Math.log1p(ref.visits) || 1)));
}

/**
 * Footprint in cells. Cells are ~1.4x taller than wide, so 2x1 reads square
 * and 1x2 as a tower; the hash keeps a page's shape stable across bakes.
 *
 * Thresholds are percentiles of the real distribution, not round numbers —
 * guessed ones put 12,304 pages in a single tier.
 */
const SHAPES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[1, 1]],
  [[2, 1], [1, 2]],
  [[2, 2], [3, 1]],
  [[3, 2], [4, 1]],
  [[4, 2]],
];

export function footprint(p: number, seed: number): readonly [number, number] {
  const tier = p >= 0.999 ? 4 : p >= 0.711 ? 3 : p >= 0.707 ? 2 : p >= 0.459 ? 1 : 0;
  const set = SHAPES[tier];
  return set[Math.abs(seed * 2654435761) % set.length];
}

/** Plot area in cells, for reserving ground before anything is drawn. */
export function plotArea(p: number, seed: number): number {
  const [w, h] = footprint(p, seed);
  return w * h;
}
