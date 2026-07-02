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
  /** Connect-the-dots legibility: require each trail's arrival point (the
   * next dot) to land at least this far from the current dot, so sequential
   * dots don't bunch up. Origins still connect nearest-first — the relay
   * always picks up right where it left off. If no unused trail's endpoint
   * clears the floor, the closest-origin one is used rather than stalling.
   * 0 disables. */
  minDotDistancePx: number;
  /** No dot may land within this distance of ANY earlier dot, regardless of
   * sequence — overlapping junctions read as a single dot. 0 disables. */
  minDotSeparationPx: number;
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

  // The seed contributes the first TWO dots (its origin and its end), so its
  // net displacement must clear the same floors every later hop does.
  const seedFloor = Math.max(
    options.minDotDistancePx,
    options.minDotSeparationPx,
  );
  const seedPool = candidates
    .map((_, index) => index)
    .filter((index) => {
      if (seedFloor <= 0) return true;
      const points = candidates[index].variedPoints;
      const origin = points[0];
      const end = points[points.length - 1];
      return Math.hypot(end.x - origin.x, end.y - origin.y) >= seedFloor;
    });
  const seedIndex =
    seedPool.length > 0
      ? seedPool[Math.floor(options.random() * seedPool.length)]
      : Math.floor(options.random() * candidates.length);
  const unused = new Set(candidates.map((_, index) => index));
  unused.delete(seedIndex);

  const chain = [candidates[seedIndex]];
  let totalDistance = pathLength(candidates[seedIndex].variedPoints);
  let currentEnd =
    candidates[seedIndex].variedPoints[
      candidates[seedIndex].variedPoints.length - 1
    ];
  const dots = [candidates[seedIndex].variedPoints[0], currentEnd];

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

    // A candidate must ARRIVE far enough from the current dot (its endpoint
    // becomes the next dot) and clear of EVERY earlier dot, while its origin
    // stays nearest-first so the relay picks up where it left off. If
    // nothing clears the floors, fall back to the closest-origin candidate
    // rather than stalling the chain.
    const eligible = byDistance.filter((entry) => {
      const points = candidates[entry.index].variedPoints;
      const end = points[points.length - 1];
      if (
        options.minDotDistancePx > 0 &&
        Math.hypot(end.x - currentEnd.x, end.y - currentEnd.y) <
          options.minDotDistancePx
      ) {
        return false;
      }
      if (options.minDotSeparationPx > 0) {
        for (const dot of dots) {
          if (
            Math.hypot(end.x - dot.x, end.y - dot.y) <
            options.minDotSeparationPx
          ) {
            return false;
          }
        }
      }
      return true;
    });
    const pool =
      eligible.length > 0
        ? eligible.slice(0, options.kNearest)
        : byDistance.slice(0, 1);
    const picked = pool[Math.floor(options.random() * pool.length)].index;
    unused.delete(picked);

    const next = candidates[picked];
    chain.push(next);
    totalDistance += pathLength(next.variedPoints);
    currentEnd = next.variedPoints[next.variedPoints.length - 1];
    dots.push(currentEnd);
  }

  return chain;
}
