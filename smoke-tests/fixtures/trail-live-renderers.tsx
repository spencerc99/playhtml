// ABOUTME: Builds a deterministic production LiveTrails scene for renderer benchmarks.
// ABOUTME: Exercises path layers, cursor heads, click ripples, fades, and camera viewBoxes.

import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LiveTrails,
  type TrailPathRenderer,
} from "../../extension/website/shared/components/LiveTrails";
import { DEFAULT_SETTINGS } from "../../extension/website/shared/components/settingsDefaults";
import type { TrailState } from "../../extension/website/shared/types";
import type { CinematicConfig } from "../../extension/website/shared/utils/cinematicCamera";

type Workload = "active" | "mixed";

interface BenchmarkApi {
  ready: boolean;
  setFrozen(frozen: boolean): Promise<void>;
  setRenderer(renderer: TrailPathRenderer): Promise<void>;
  sampleFrames(durationMs: number): Promise<number[]>;
}

declare global {
  interface Window {
    trailBenchmark: BenchmarkApi;
  }
}

const WIDTH = 1280;
const HEIGHT = 800;
const TRAIL_COUNT = 50;
const POINT_COUNT = 300;
const COLORS = [
  "#d05a4e",
  "#4b8eae",
  "#758d51",
  "#aa75a2",
  "#edcfc3",
  "#d8e5ec",
];
const CURSORS = ["default", "pointer", "text", "grab", "crosshair", "wait"];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function makeTrails(workload: Workload): TrailState[] {
  return Array.from({ length: TRAIL_COUNT }, (_, trailIndex) => {
    const active = workload === "active" || trailIndex < 2;
    const durationMs = active ? 30_000 : 600;
    const variedPoints = Array.from({ length: POINT_COUNT }, (_, pointIndex) => {
      const phase = pointIndex / (POINT_COUNT - 1);
      return {
        x:
          WIDTH * (0.04 + 0.92 * phase) +
          Math.sin(pointIndex * 0.071 + trailIndex * 1.7) * 36,
        y:
          HEIGHT * (0.08 + (trailIndex % 25) / 29) +
          Math.sin(pointIndex * 0.043 + trailIndex * 0.63) * 42,
      };
    });
    const points = variedPoints.map((point, pointIndex) => ({
      ...point,
      ts: Math.round((durationMs * pointIndex) / (POINT_COUNT - 1)),
      cursor: CURSORS[Math.floor(pointIndex / 70 + trailIndex) % CURSORS.length],
    }));
    const clickCount = active ? 6 : 1;
    const clicksWithProgress = Array.from({ length: clickCount }, (_, clickIndex) => {
      const progress = active
        ? (clickIndex + 0.5 + (trailIndex % clickCount) / clickCount) /
          (clickCount + 1)
        : 0.4;
      const point = variedPoints[Math.round(progress * (POINT_COUNT - 1))];
      return {
        ...point,
        ts: Math.round(durationMs * progress),
        progress,
        duration: clickIndex % 5 === 0 ? 1200 : undefined,
      };
    });

    return {
      trail: {
        id: `trail-${trailIndex}`,
        pid: `participant-${trailIndex}`,
        points,
        color: COLORS[trailIndex % COLORS.length],
        opacity: 1,
        startTime: 0,
        endTime: durationMs,
        clicks: clicksWithProgress.map(({ progress: _progress, ...click }) => click),
      },
      startOffsetMs: 0,
      durationMs,
      variedPoints,
      clicksWithProgress,
    };
  });
}

function BenchmarkScene() {
  const search = useMemo(() => new URLSearchParams(window.location.search), []);
  const workload = search.get("workload") === "mixed" ? "mixed" : "active";
  const cameraEnabled = search.get("camera") === "1";
  const [pathRenderer, setPathRenderer] = useState<TrailPathRenderer>("svg");
  const [frozen, setFrozen] = useState(false);
  const trails = useMemo(() => makeTrails(workload), [workload]);
  const cinematic = useMemo<CinematicConfig | null>(
    () =>
      cameraEnabled
        ? {
            mode: "follow",
            zoom: 0.6,
            transitionMs: 1800,
            centerLerp: 0.08,
            velocityZoomOut: 0.001,
            revealMs: 10_000,
            revealStartZoom: 0.18,
          }
        : null,
    [cameraEnabled],
  );

  useEffect(() => {
    window.trailBenchmark = {
      ready: true,
      async setFrozen(nextFrozen) {
        setFrozen(nextFrozen);
        await nextFrame();
        await nextFrame();
      },
      async setRenderer(nextRenderer) {
        setPathRenderer(nextRenderer);
        await nextFrame();
        await nextFrame();
      },
      sampleFrames(durationMs) {
        return new Promise((resolve) => {
          const intervals: number[] = [];
          const startedAt = performance.now();
          let previous = startedAt;
          const sample = (now: number) => {
            intervals.push(now - previous);
            previous = now;
            if (now - startedAt >= durationMs) resolve(intervals);
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
      },
    };
  }, []);

  return (
    <LiveTrails
      trailStates={trails}
      frozen={frozen}
      cinematic={cinematic}
      showClickRipples
      pathRenderer={pathRenderer}
      settings={DEFAULT_SETTINGS}
    />
  );
}

createRoot(document.getElementById("root")!).render(<BenchmarkScene />);
