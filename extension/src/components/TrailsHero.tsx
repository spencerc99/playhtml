// ABOUTME: Animated cursor trails hero for the setup page welcome screen
// ABOUTME: Pre-generates many batches of trails and relies on AnimatedTrails eviction for fade-out

import React, { useMemo } from "react";
import { AnimatedTrails } from "../../../website/internet-series/movement/components/AnimatedTrails";
import { RISO_COLORS } from "../../../website/internet-series/movement/utils/eventUtils";
import type { TrailState } from "../../../website/internet-series/movement/types";

// Time between each batch of trails spawning (ms, in animation time)
const BATCH_INTERVAL_MS = 7000;

// How many cursors per batch
const CURSOR_COUNT = 4;

// How many batches to pre-generate (enough for a long session)
const BATCH_COUNT = 60;

// Smooth bezier-like path through random waypoints
function generateWaypoints(
  w: number,
  h: number,
  count: number,
  seed: number,
): Array<{ x: number; y: number }> {
  const rng = (n: number) => {
    const x = Math.sin(seed * 9301 + n * 49297 + 233) * 803.7;
    return x - Math.floor(x);
  };

  // Allow waypoints to extend past the viewport edges so trails drift off-screen
  const overflowX = w * 0.15;
  const overflowY = h * 0.15;
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: -overflowX + rng(i * 2) * (w + overflowX * 2),
      y: -overflowY + rng(i * 2 + 1) * (h + overflowY * 2),
    });
  }
  return points;
}

// Interpolate a smooth path through waypoints via Catmull-Rom spline
function interpolatePath(
  waypoints: Array<{ x: number; y: number }>,
  steps: number,
): Array<{ x: number; y: number }> {
  if (waypoints.length < 2) return waypoints;
  const result: Array<{ x: number; y: number }> = [];
  const segSteps = Math.floor(steps / (waypoints.length - 1));
  for (let i = 0; i < waypoints.length - 1; i++) {
    const p0 = waypoints[Math.max(0, i - 1)];
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    const p3 = waypoints[Math.min(waypoints.length - 1, i + 2)];
    for (let t = 0; t < segSteps; t++) {
      const s = t / segSteps;
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * s +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s * s +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s * s * s);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * s +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s * s +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s * s * s);
      result.push({ x, y });
    }
  }
  result.push(waypoints[waypoints.length - 1]);
  return result;
}

function generateAllTrails(w: number, h: number): TrailState[] {
  const states: TrailState[] = [];

  for (let batch = 0; batch < BATCH_COUNT; batch++) {
    const batchBase = batch * BATCH_INTERVAL_MS;

    for (let i = 0; i < CURSOR_COUNT; i++) {
      const seed = batch * 100 + i;
      const colorRng = Math.sin(seed * 7919 + 1301) * 10000;
      const color = RISO_COLORS[Math.abs(Math.floor(colorRng)) % RISO_COLORS.length];

      // Stagger start times within the batch
      const startOffsetMs = batchBase + (i / CURSOR_COUNT) * BATCH_INTERVAL_MS * 0.4;
      const durationMs = BATCH_INTERVAL_MS * (0.5 + 0.3 * ((seed % 7) / 7));

      const waypointCount = 4 + (seed % 4);
      const waypoints = generateWaypoints(w, h, waypointCount, seed);
      const smoothPoints = interpolatePath(waypoints, 120);

      const tsPoints = smoothPoints.map((p, idx) => ({
        ...p,
        ts: startOffsetMs + (idx / smoothPoints.length) * durationMs,
      }));

      states.push({
        trail: {
          points: tsPoints,
          color,
          opacity: 0.65,
          startTime: startOffsetMs,
          endTime: startOffsetMs + durationMs,
          clicks: [],
        },
        startOffsetMs,
        durationMs,
        variedPoints: smoothPoints,
        clicksWithProgress: [],
      });
    }
  }

  return states;
}

interface Props {
  width: number;
  height: number;
}

const TOTAL_DURATION_MS = BATCH_COUNT * BATCH_INTERVAL_MS;

export function TrailsHero({ width, height }: Props) {
  const trailStates = useMemo(
    () => (width > 0 && height > 0 ? generateAllTrails(width, height) : []),
    [width, height],
  );

  if (trailStates.length === 0) return null;

  return (
    <AnimatedTrails
      trailStates={trailStates}
      timeRange={{ min: 0, max: TOTAL_DURATION_MS, duration: TOTAL_DURATION_MS }}
      showClickRipples={false}
      windowSize={CURSOR_COUNT}
      settings={{
        strokeWidth: 5,
        pointSize: 0,
        trailOpacity: 0.2,
        animationSpeed: 0.5,
        clickMinRadius: 6,
        clickMaxRadius: 18,
        clickMinDuration: 300,
        clickMaxDuration: 800,
        clickExpansionDuration: 250,
        clickStrokeWidth: 1.5,
        clickOpacity: 0.4,
        clickNumRings: 2,
        clickRingDelayMs: 120,
        clickAnimationStopPoint: 0.9,
      }}
    />
  );
}
