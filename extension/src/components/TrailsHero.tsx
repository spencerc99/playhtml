// ABOUTME: Animated cursor trails hero for the setup page welcome screen
// ABOUTME: Generates synthetic looping trails with smooth paths, fading previous cycles out via CSS

import React, { useEffect, useRef, useState } from "react";
import { AnimatedTrails } from "../../../website/internet-series/movement/components/AnimatedTrails";
import { RISO_COLORS } from "../../../website/internet-series/movement/utils/eventUtils";
import type { TrailState } from "../../../website/internet-series/movement/types";

// Duration of one full animation cycle (ms)
const CYCLE_MS = 7000;

// Pause after trails finish drawing before starting the fade-out
const LINGER_MS = 3000;

// CSS fade-out duration for the previous cycle
const FADE_MS = 3000;

// How many cursors per cycle
const CURSOR_COUNT = 4;

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

// Interpolate a smooth path through waypoints with many intermediate points
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
      // Catmull-Rom spline
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

function generateTrailStates(w: number, h: number, epoch: number): TrailState[] {
  const states: TrailState[] = [];

  for (let i = 0; i < CURSOR_COUNT; i++) {
    const seed = epoch * 100 + i;
    const color = RISO_COLORS[(seed + i) % RISO_COLORS.length];

    // Stagger start times so they don't all appear at once
    const startOffsetMs = (i / CURSOR_COUNT) * CYCLE_MS * 0.4;
    const durationMs = CYCLE_MS * (0.5 + 0.3 * ((seed % 7) / 7));

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

  return states;
}

const TRAIL_SETTINGS = {
  strokeWidth: 5,
  pointSize: 0,
  trailOpacity: 0.35,
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
} as const;

interface FrozenLayer {
  key: number;
  trailStates: TrailState[];
  fading: boolean;
}

interface Props {
  width: number;
  height: number;
}

export function TrailsHero({ width, height }: Props) {
  const [epoch, setEpoch] = useState(0);
  const [currentStates, setCurrentStates] = useState<TrailState[]>([]);
  const [frozenLayers, setFrozenLayers] = useState<FrozenLayer[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const layerTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>[]>>(new Map());
  const prevStatesRef = useRef<TrailState[]>([]);

  useEffect(() => {
    if (width === 0 || height === 0) return;

    const states = generateTrailStates(width, height, epoch);
    setCurrentStates(states);

    // When a new epoch starts, freeze the previous cycle's trails
    if (prevStatesRef.current.length > 0) {
      const frozenKey = epoch - 1;
      const frozenStates = prevStatesRef.current;
      const timers: ReturnType<typeof setTimeout>[] = [];

      setFrozenLayers((prev) => [
        ...prev,
        { key: frozenKey, trailStates: frozenStates, fading: false },
      ]);

      // After linger period, start fading
      timers.push(setTimeout(() => {
        setFrozenLayers((prev) =>
          prev.map((l) => (l.key === frozenKey ? { ...l, fading: true } : l)),
        );
      }, LINGER_MS));

      // After linger + fade, remove the layer entirely
      timers.push(setTimeout(() => {
        setFrozenLayers((prev) => prev.filter((l) => l.key !== frozenKey));
        layerTimersRef.current.delete(frozenKey);
      }, LINGER_MS + FADE_MS));

      layerTimersRef.current.set(frozenKey, timers);
    }

    prevStatesRef.current = states;

    timerRef.current = setTimeout(() => {
      setEpoch((e) => e + 1);
    }, CYCLE_MS);

    return () => {
      clearTimeout(timerRef.current);
    };
  }, [epoch, width, height]);

  // Clean up all layer timers on unmount
  useEffect(() => {
    return () => {
      for (const timers of layerTimersRef.current.values()) {
        timers.forEach(clearTimeout);
      }
    };
  }, []);

  const timeRange = { min: 0, max: CYCLE_MS, duration: CYCLE_MS };

  if (currentStates.length === 0) return null;

  return (
    <>
      {/* Previous cycles: frozen in place, fading out via CSS */}
      {frozenLayers.map((layer) => (
        <div
          key={layer.key}
          style={{
            position: "absolute",
            inset: 0,
            opacity: layer.fading ? 0 : 1,
            transition: `opacity ${FADE_MS}ms ease-out`,
          }}
        >
          <AnimatedTrails
            trailStates={layer.trailStates}
            timeRange={timeRange}
            showClickRipples={false}
            frozen
            windowSize={CURSOR_COUNT}
            settings={TRAIL_SETTINGS}
          />
        </div>
      ))}

      {/* Current active cycle */}
      <AnimatedTrails
        trailStates={currentStates}
        timeRange={timeRange}
        showClickRipples={false}
        windowSize={CURSOR_COUNT}
        settings={TRAIL_SETTINGS}
      />
    </>
  );
}
