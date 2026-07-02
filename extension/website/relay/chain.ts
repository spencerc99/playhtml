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
  /** Connect-the-dots legibility: require the next origin to be at least this
   * far from the current endpoint, so consecutive dots don't bunch up. If no
   * unused trail's origin clears the floor, the single closest one is used
   * rather than stalling the chain. 0 disables. */
  minHopDistancePx: number;
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

    // Consecutive dots shouldn't bunch up: only consider origins that clear
    // the minimum hop distance. If nothing clears it (e.g. a sparse pool),
    // fall back to the single closest rather than stalling the chain.
    const eligible =
      options.minHopDistancePx > 0
        ? byDistance.filter((entry) => entry.distance >= options.minHopDistancePx)
        : byDistance;
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
  }

  return chain;
}
