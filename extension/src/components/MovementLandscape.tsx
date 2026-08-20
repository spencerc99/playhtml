// ABOUTME: Renders a compact, period-specific replay of real cursor movement.
// ABOUTME: Reuses the portrait trail renderer and its default visual settings.

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatedTrails } from "@movement/components/AnimatedTrails";
import { DEFAULT_SETTINGS } from "@movement/components/settingsDefaults";
import { useCursorTrails } from "@movement/hooks/useCursorTrails";
import type {
  CollectionEvent as MovementEvent,
  TrailState,
} from "@movement/types";
import type { CollectionEvent } from "../collectors/types";

const MIN_TRAIL_PLAYBACK_MS = 3_000;
const MAX_TRAIL_PLAYBACK_MS = 9_000;
const MIN_LANDSCAPE_CYCLE_MS = 6_000;

interface MovementLandscapeProps {
  paths: CollectionEvent[][];
  label: string;
}

function movementEvents(paths: CollectionEvent[][]): MovementEvent[] {
  return paths.flatMap((path, pathIndex) =>
    path.flatMap((event) => {
      const data = event.data as {
        x?: unknown;
        y?: unknown;
        event?: unknown;
      };
      if (
        event.type !== "cursor" ||
        typeof data.x !== "number" ||
        typeof data.y !== "number"
      ) {
        return [];
      }

      return [
        {
          ...event,
          meta: {
            ...event.meta,
            url: `${event.meta.url}#walking-record-path-${pathIndex}`,
          },
          data: {
            ...data,
            x: data.x,
            y: data.y,
          },
        } as MovementEvent,
      ];
    }),
  );
}

export function scheduleLandscapeTrails(
  trailStates: TrailState[],
): TrailState[] {
  if (trailStates.length === 0) return [];

  const durations = trailStates.map((trail) =>
    Math.max(
      MIN_TRAIL_PLAYBACK_MS,
      Math.min(MAX_TRAIL_PLAYBACK_MS, trail.durationMs),
    ),
  );
  const averageDuration =
    durations.reduce((total, duration) => total + duration, 0) /
    durations.length;
  const overlapMultiplier = 1 - DEFAULT_SETTINGS.overlapFactor * 0.8;
  const spacing = Math.max(
    DEFAULT_SETTINGS.minGapBetweenTrails * 1_000,
    (averageDuration / DEFAULT_SETTINGS.maxConcurrentTrails) *
      overlapMultiplier,
  );
  const orderedIndices = trailStates
    .map((trail, index) => ({ index, startOffsetMs: trail.startOffsetMs }))
    .sort((first, second) => first.startOffsetMs - second.startOffsetMs);
  const positionByIndex = new Int32Array(trailStates.length);
  orderedIndices.forEach(({ index }, position) => {
    positionByIndex[index] = position;
  });

  return trailStates.map((trail, index) => ({
    ...trail,
    startOffsetMs: positionByIndex[index] * spacing,
    durationMs: durations[index],
  }));
}

export function cycleLandscapeTrails(trailStates: TrailState[]): {
  trailStates: TrailState[];
  duration: number;
} {
  if (trailStates.length === 0) {
    return { trailStates: [], duration: 1 };
  }

  const orderedStarts = trailStates
    .map((trail) => trail.startOffsetMs)
    .sort((first, second) => first - second);
  const spacing =
    orderedStarts.length > 1
      ? orderedStarts[1] - orderedStarts[0]
      : DEFAULT_SETTINGS.minGapBetweenTrails * 1_000;
  const duration = Math.max(
    MIN_LANDSCAPE_CYCLE_MS,
    orderedStarts.at(-1)! + spacing,
  );
  const wrappedTrails = trailStates.flatMap((trail) =>
    trail.startOffsetMs + trail.durationMs > duration
      ? [
          {
            ...trail,
            startOffsetMs: trail.startOffsetMs - duration,
          },
          trail,
        ]
      : [trail],
  );

  return { trailStates: wrappedTrails, duration };
}

export function MovementLandscape({
  paths,
  label,
}: MovementLandscapeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const filterId = useId().replaceAll(":", "");
  const events = useMemo(() => movementEvents(paths), [paths]);
  const { trailStates } = useCursorTrails(
    events,
    viewportSize,
    DEFAULT_SETTINGS,
  );
  const scheduledTrailStates = useMemo(
    () => scheduleLandscapeTrails(trailStates),
    [trailStates],
  );
  const playback = useMemo(
    () => cycleLandscapeTrails(scheduledTrailStates),
    [scheduledTrailStates],
  );
  const timeRange = useMemo(
    () => ({ min: 0, max: playback.duration, duration: playback.duration }),
    [playback.duration],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const bounds = container.getBoundingClientRect();
      setViewportSize({
        width: Math.max(1, bounds.width),
        height: Math.max(1, bounds.height),
      });
    };
    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (typeof IntersectionObserver === "undefined") {
      setHasEnteredViewport(true);
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
        if (entry.isIntersecting) setHasEnteredViewport(true);
      },
      { rootMargin: "180px 0px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;

    const updatePreference = () => setReducedMotion(query.matches);
    updatePreference();
    query.addEventListener("change", updatePreference);
    return () => query.removeEventListener("change", updatePreference);
  }, []);

  if (paths.length === 0) return null;

  return (
    <div
      className="walking-record__movement-landscape"
      ref={containerRef}
      role="img"
      aria-label={label}
    >
      <svg
        className="walking-record__movement-paper"
        width="100%"
        height="100%"
        aria-hidden="true"
      >
        <defs>
          <filter id={`${filterId}-noise`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="3"
              stitchTiles="stitch"
            />
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 2 -1"
            />
          </filter>
          <filter id={`${filterId}-grain`}>
            <feTurbulence
              type="turbulence"
              baseFrequency="0.5"
              numOctaves="2"
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncA type="discrete" tableValues="0 0.2 0.3 0.4" />
            </feComponentTransfer>
          </filter>
        </defs>
        <rect
          width="100%"
          height="100%"
          filter={`url(#${filterId}-noise)`}
        />
        <rect
          width="100%"
          height="100%"
          filter={`url(#${filterId}-grain)`}
          opacity="0.3"
        />
      </svg>

      {hasEnteredViewport && playback.trailStates.length > 0 && (
        <AnimatedTrails
          trailStates={playback.trailStates}
          timeRange={timeRange}
          showClickRipples
          windowSize={DEFAULT_SETTINGS.maxConcurrentTrails * 2}
          settings={DEFAULT_SETTINGS}
          frozen={reducedMotion || !isVisible}
        />
      )}
    </div>
  );
}
