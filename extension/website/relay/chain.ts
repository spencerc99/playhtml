// ABOUTME: Greedy end-to-origin chaining of cursor trails for the relay experiment
// ABOUTME: Picks each next trail by sampling among the k origins nearest the current endpoint

import { TrailState } from "../shared/types";
import { pathLength } from "../shared/utils/trailSequence";

export interface ChainOptions {
  /** Stop once the chain holds this many trails. Use Infinity when capping
   * by distance instead. */
  maxTrails: number;
  /** Stop once the chain's total drawn path length reaches this many pixels.
   * Use Infinity when capping by trail count instead. */
  maxDistancePx: number;
  /** Sample uniformly among this many nearest origins instead of always the
   * single nearest — keeps the chain wandering instead of ping-ponging inside
   * an endpoint cluster. */
  kNearest: number;
  /** Exclude trails whose endpoint lies within this fraction of the canvas
   * edge — people leaving toward the tab bar pile endpoints up there. Null
   * disables the filter. */
  edgeMarginFraction: number | null;
  /** Exclude trails whose drawn path length exceeds this many pixels. Use
   * Infinity to disable the filter. */
  maxTrailLengthPx: number;
  /** Connect-the-dots legibility: prefer candidates whose path stays at least
   * this far from every dot the chain has yet to pass through — the origin
   * and endpoint of every trail still unused in the pool (and whose own
   * endpoint doesn't crowd one of those future junctions). 0 disables. */
  dotClearancePx: number;
  canvasSize: { width: number; height: number };
  random: () => number;
}

/** Deterministic PRNG so a given seed always yields the same chain. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many upcoming dots a candidate's path passes through, plus one if its
 * own endpoint would crowd an upcoming dot. `dots` are the origin/endpoint of
 * every OTHER trail still unused after this candidate is picked — the future
 * junctions the chain hasn't reached yet, not ones it already placed. The
 * dot the candidate connects FROM is excluded by the caller building `dots`.
 * Points are stride-sampled so long trails stay cheap to check. */
function countDotViolations(
  points: Array<{ x: number; y: number }>,
  dots: Array<{ x: number; y: number }>,
  clearancePx: number,
): number {
  const stride = Math.max(1, Math.floor(points.length / 100));
  let violations = 0;
  for (const dot of dots) {
    for (let i = 0; i < points.length; i += stride) {
      if (
        Math.hypot(points[i].x - dot.x, points[i].y - dot.y) < clearancePx
      ) {
        violations++;
        break;
      }
    }
  }
  const end = points[points.length - 1];
  for (const dot of dots) {
    if (Math.hypot(end.x - dot.x, end.y - dot.y) < clearancePx) violations++;
  }
  return violations;
}

function endsNearEdge(
  point: { x: number; y: number },
  size: { width: number; height: number },
  marginFraction: number,
): boolean {
  const marginX = size.width * marginFraction;
  const marginY = size.height * marginFraction;
  return (
    point.x < marginX ||
    point.x > size.width - marginX ||
    point.y < marginY ||
    point.y > size.height - marginY
  );
}

/** Orders trails into a relay: starting from a random seed trail, repeatedly
 * appends an unused trail whose origin is near the current endpoint, until
 * maxTrails is reached or the pool runs out. */
export function chainTrailStates(
  states: TrailState[],
  options: ChainOptions,
): TrailState[] {
  const candidates = states.filter((state) => {
    if (state.variedPoints.length < 2) return false;
    if (options.edgeMarginFraction !== null) {
      const last = state.variedPoints[state.variedPoints.length - 1];
      if (endsNearEdge(last, options.canvasSize, options.edgeMarginFraction)) {
        return false;
      }
    }
    if (pathLength(state.variedPoints) > options.maxTrailLengthPx) return false;
    return true;
  });
  if (candidates.length === 0) return [];

  const unused = new Set(candidates.map((_, index) => index));
  const seedIndex = Math.floor(options.random() * candidates.length);
  unused.delete(seedIndex);

  const chain = [candidates[seedIndex]];
  let totalDistance = pathLength(candidates[seedIndex].variedPoints);
  let currentEnd =
    candidates[seedIndex].variedPoints[
      candidates[seedIndex].variedPoints.length - 1
    ];

  while (
    chain.length < options.maxTrails &&
    totalDistance < options.maxDistancePx &&
    unused.size > 0
  ) {
    const byDistance = Array.from(unused)
      .map((index) => {
        const origin = candidates[index].variedPoints[0];
        return {
          index,
          distance: Math.hypot(
            origin.x - currentEnd.x,
            origin.y - currentEnd.y,
          ),
        };
      })
      .sort((a, b) => a.distance - b.distance);

    const k = Math.min(options.kNearest, byDistance.length);
    let pool = byDistance.slice(0, k);
    if (options.dotClearancePx > 0) {
      const scored = pool.map((entry) => {
        // Future junctions: origin + endpoint of every OTHER trail still
        // unused once this candidate is picked — not history, the field of
        // dots the chain still has left to route through.
        const futureDots: Array<{ x: number; y: number }> = [];
        for (const otherIndex of unused) {
          if (otherIndex === entry.index) continue;
          const points = candidates[otherIndex].variedPoints;
          futureDots.push(points[0], points[points.length - 1]);
        }
        return {
          ...entry,
          violations: countDotViolations(
            candidates[entry.index].variedPoints,
            futureDots,
            options.dotClearancePx,
          ),
        };
      });
      const clear = scored.filter((entry) => entry.violations === 0);
      // All k nearest cross upcoming dots: take the least-offending one
      // rather than stalling the chain.
      pool =
        clear.length > 0
          ? clear
          : [scored.reduce((a, b) => (b.violations < a.violations ? b : a))];
    }
    const picked = pool[Math.floor(options.random() * pool.length)].index;
    unused.delete(picked);

    const next = candidates[picked];
    chain.push(next);
    totalDistance += pathLength(next.variedPoints);
    currentEnd = next.variedPoints[next.variedPoints.length - 1];
  }

  return chain;
}
