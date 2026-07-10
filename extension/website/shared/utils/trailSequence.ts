// ABOUTME: Schedules pre-derived trails to play one after another (or overlapping)
// ABOUTME: Paces each trail by its on-screen path length for uniform drawing speed

import { TrailState } from "../types";

export interface TrailSequenceItem {
  trail: TrailState["trail"];
  variedPoints: Array<{ x: number; y: number }>;
  clicksWithProgress: TrailState["clicksWithProgress"];
}

export interface TrailSequenceOptions {
  /** Drawing speed used to derive each trail's playback duration. */
  pxPerSecond: number;
  minDurationMs: number;
  maxDurationMs: number;
  /** Pause between one trail finishing and the next starting. */
  gapMs: number;
  /** 0-1: fraction of a trail's duration the next trail starts early into.
   * 0 plays strictly one at a time; higher values run several at once. */
  overlap: number;
  /** Rest at the end of the sequence before the animation loops. */
  restMs: number;
}

export function pathLength(points: Array<{ x: number; y: number }>): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  }
  return length;
}

export function scheduleTrailSequence(
  items: TrailSequenceItem[],
  options: TrailSequenceOptions,
): { trailStates: TrailState[]; totalDurationMs: number } {
  let nextStartMs = 0;
  let endMs = 0;

  const trailStates = items.map((item) => {
    const lengthPx = pathLength(item.variedPoints);
    const durationMs = Math.min(
      options.maxDurationMs,
      Math.max(options.minDurationMs, (lengthPx / options.pxPerSecond) * 1000),
    );
    const startOffsetMs = nextStartMs;
    nextStartMs =
      startOffsetMs + durationMs * (1 - options.overlap) + options.gapMs;
    endMs = Math.max(endMs, startOffsetMs + durationMs);

    return {
      trail: item.trail,
      startOffsetMs,
      durationMs,
      variedPoints: item.variedPoints,
      clicksWithProgress: item.clicksWithProgress,
    };
  });

  return { trailStates, totalDurationMs: endMs + options.restMs };
}
