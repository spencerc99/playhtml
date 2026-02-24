// ABOUTME: Hook for processing cursor events into animated trails
// ABOUTME: Extracts cursor-specific logic from movement.tsx for cleaner separation of concerns

import { useMemo, useCallback } from "react";
import { CollectionEvent, Trail, TrailState } from "../types";
import { applyStyleVariations } from "../utils/styleUtils";
import {
  RISO_COLORS,
  TRAIL_TIME_THRESHOLD,
  getColorForParticipant,
  extractDomain,
} from "../utils/eventUtils";

// Settings interface for cursor trails
export interface CursorTrailSettings {
  trailOpacity: number;
  randomizeColors: boolean;
  domainFilter: string;
  eventFilter: {
    move: boolean;
    click: boolean;
    hold: boolean;
    cursor_change: boolean;
  };
  trailStyle: "straight" | "smooth" | "organic" | "chaotic";
  chaosIntensity: number;
  trailAnimationMode: "natural" | "stagger";
  maxConcurrentTrails: number;
  overlapFactor: number;
  minGapBetweenTrails: number;
  // When true, cursor positions are placed in document space using captured scroll offsets,
  // so movements across a long scrollable page are shown relative to the full document.
  documentSpace: boolean;
}

// Trail schedule item for animation timing
interface TrailScheduleItem {
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  adjustedClicks: Array<{
    x: number;
    y: number;
    ts: number;
    button?: number;
    duration?: number;
  }>;
}

export interface UseCursorTrailsResult {
  trails: Trail[];
  trailStates: TrailState[];
  trailSchedule: TrailScheduleItem[];
  timeBounds: { min: number; max: number };
  cycleDuration: number;
  // In document space mode, the logical canvas dimensions differ from the viewport size
  documentCanvasSize: { width: number; height: number } | null;
}

/**
 * Hook for processing cursor events into animated trail states
 *
 * @param events - All collection events (will be filtered to cursor type)
 * @param viewportSize - Current viewport dimensions for coordinate scaling
 * @param settings - Cursor trail settings
 * @returns Trail states ready for rendering, plus time bounds for coordination
 */
export function useCursorTrails(
  events: CollectionEvent[],
  viewportSize: { width: number; height: number },
  settings: CursorTrailSettings
): UseCursorTrailsResult {
  // Filter to cursor events only
  const cursorEvents = useMemo(() => {
    return events.filter((e) => e.type === "cursor");
  }, [events]);

  // Build trails from cursor events
  const trailsResult = useMemo(() => {
    if (cursorEvents.length === 0 || viewportSize.width === 0) {
      return { trails: [] as Trail[], documentCanvasSize: null };
    }

    // Apply domain filter
    const filteredEvents = settings.domainFilter
      ? cursorEvents.filter((event) => {
          const eventDomain = extractDomain(event.meta.url || "");
          return eventDomain === settings.domainFilter;
        })
      : cursorEvents;

    // In document space mode, compute the document bounding box so the overlay
    // knows how tall/wide to make itself to cover all trail positions.
    let maxDocX = 0;
    let maxDocY = 0;
    if (settings.documentSpace) {
      filteredEvents.forEach((event) => {
        if (
          !event.data ||
          typeof event.data.x !== "number" ||
          typeof event.data.y !== "number"
        )
          return;
        const vw = event.meta.vw || viewportSize.width;
        const vh = event.meta.vh || viewportSize.height;
        const scrollX = (event.data as { scrollX?: number }).scrollX ?? 0;
        const scrollY = (event.data as { scrollY?: number }).scrollY ?? 0;
        const docX = event.data.x * vw + scrollX;
        const docY = event.data.y * vh + scrollY;
        if (docX > maxDocX) maxDocX = docX;
        if (docY > maxDocY) maxDocY = docY;
      });
    }

    const participantColors = new Map<string, string>();
    const trails: Trail[] = [];
    const eventsByParticipantAndUrl = new Map<string, CollectionEvent[]>();

    // Group events by participant + URL
    filteredEvents.forEach((event) => {
      if (
        !event.data ||
        typeof event.data.x !== "number" ||
        typeof event.data.y !== "number"
      ) {
        return;
      }

      const pid = event.meta.pid;
      const url = event.meta.url || "";
      const key = `${pid}|${url}`;

      if (!eventsByParticipantAndUrl.has(key)) {
        eventsByParticipantAndUrl.set(key, []);
      }
      eventsByParticipantAndUrl.get(key)!.push(event);
    });

    let trailColorIndex = 0;
    eventsByParticipantAndUrl.forEach((groupEvents) => {
      groupEvents.sort((a, b) => a.ts - b.ts);

      const pid = groupEvents[0].meta.pid;

      // Determine color based on settings
      let color: string;
      if (settings.randomizeColors) {
        color = RISO_COLORS[trailColorIndex % RISO_COLORS.length];
        trailColorIndex++;
      } else {
        if (!participantColors.has(pid)) {
          participantColors.set(pid, getColorForParticipant(pid));
        }
        color = participantColors.get(pid)!;
      }

      let currentTrail: Array<{
        x: number;
        y: number;
        ts: number;
        cursor?: string;
      }> = [];
      let currentClicks: Array<{
        x: number;
        y: number;
        ts: number;
        button?: number;
        duration?: number;
      }> = [];
      let lastTimestamp = 0;
      // Track last viewport-relative position (normalized 0-1) to detect
      // scroll-only samples where the cursor hasn't actually moved.
      let lastNormX = -1;
      let lastNormY = -1;

      groupEvents.forEach((event) => {
        const eventType = event.data.event || "move";

        // Apply event type filters
        if (eventType === "move" && !settings.eventFilter.move) return;
        if (eventType === "click" && !settings.eventFilter.click) return;
        if (eventType === "hold" && !settings.eventFilter.hold) return;
        if (
          eventType === "cursor_change" &&
          !settings.eventFilter.cursor_change
        )
          return;

        // In document space mode, skip move events that are scroll-induced:
        // the cursor barely moved in viewport-relative terms between samples.
        // Threshold is 5% of viewport — small enough to catch a stationary
        // cursor while scrolling, large enough to keep real cursor movement.
        // Clicks and holds always pass through.
        if (
          settings.documentSpace &&
          eventType === "move" &&
          lastNormX >= 0 &&
          Math.abs(event.data.x - lastNormX) < 0.05 &&
          Math.abs(event.data.y - lastNormY) < 0.05
        ) {
          lastTimestamp = event.ts;
          lastNormX = event.data.x;
          lastNormY = event.data.y;
          return;
        }

        // Convert normalized coordinates (0-1) to pixel coordinates.
        // In document space mode: reconstruct the absolute document position using
        // the scroll offset captured at event time. Coordinates are in document
        // pixels so the overlay can be absolutely positioned over the full page.
        // In viewport space mode: scale normalized coords to current canvas size.
        let x: number;
        let y: number;
        if (settings.documentSpace) {
          const vw = event.meta.vw || viewportSize.width;
          const vh = event.meta.vh || viewportSize.height;
          const scrollX = (event.data as { scrollX?: number }).scrollX ?? 0;
          const scrollY = (event.data as { scrollY?: number }).scrollY ?? 0;
          x = event.data.x * vw + scrollX;
          y = event.data.y * vh + scrollY;
        } else {
          x = event.data.x * viewportSize.width;
          y = event.data.y * viewportSize.height;
        }
        const isClick = eventType === "click";
        const isHold = eventType === "hold";
        const cursorType = event.data.cursor;

        // Start new trail if time gap exceeds threshold, or in document space
        // mode if the spatial jump is too large (e.g. cursor staying put while
        // user rapidly scrolls, producing huge diagonal slashes).
        const lastPoint = currentTrail[currentTrail.length - 1];
        const spatialJumpTooLarge =
          settings.documentSpace &&
          lastPoint !== undefined &&
          Math.abs(y - lastPoint.y) > viewportSize.height * 0.5;

        if (
          currentTrail.length === 0 ||
          event.ts - lastTimestamp > TRAIL_TIME_THRESHOLD ||
          spatialJumpTooLarge
        ) {
          // Push completed trail if it has enough points
          if (currentTrail.length >= 2) {
            const startTime = currentTrail[0].ts;
            const endTime = currentTrail[currentTrail.length - 1].ts;

            trails.push({
              points: [...currentTrail],
              color,
              opacity: settings.trailOpacity,
              startTime,
              endTime,
              clicks: [...currentClicks],
            });
          }
          currentTrail = [{ x, y, ts: event.ts, cursor: cursorType }];
          currentClicks = [];

          if (isClick) {
            currentClicks.push({
              x,
              y,
              ts: event.ts,
              button: event.data.button,
            });
          } else if (isHold) {
            currentClicks.push({
              x,
              y,
              ts: event.ts,
              button: event.data.button,
              duration: event.data.duration,
            });
          }
        } else {
          currentTrail.push({ x, y, ts: event.ts, cursor: cursorType });

          if (isClick) {
            currentClicks.push({
              x,
              y,
              ts: event.ts,
              button: event.data.button,
            });
          } else if (isHold) {
            currentClicks.push({
              x,
              y,
              ts: event.ts,
              button: event.data.button,
              duration: event.data.duration,
            });
          }
        }

        lastTimestamp = event.ts;
        lastNormX = event.data.x;
        lastNormY = event.data.y;
      });

      // Don't forget the last trail
      if (currentTrail.length >= 2) {
        const startTime = currentTrail[0].ts;
        const endTime = currentTrail[currentTrail.length - 1].ts;

        trails.push({
          points: currentTrail,
          color,
          opacity: settings.trailOpacity,
          startTime,
          endTime,
          clicks: [...currentClicks],
        });
      }
    });

    const documentCanvasSize =
      settings.documentSpace && maxDocX > 0 && maxDocY > 0
        ? { width: maxDocX, height: maxDocY }
        : null;

    return { trails, documentCanvasSize };
  }, [
    cursorEvents,
    settings.randomizeColors,
    settings.domainFilter,
    settings.eventFilter,
    settings.trailOpacity,
    settings.documentSpace,
    viewportSize,
  ]);

  const { trails, documentCanvasSize } = trailsResult;

  // Calculate time bounds and trail schedule
  const { timeBounds, cycleDuration, trailSchedule } = useMemo(() => {
    if (trails.length === 0) {
      return {
        timeBounds: { min: 0, max: 0 },
        cycleDuration: 0,
        trailSchedule: [] as TrailScheduleItem[],
      };
    }

    const allTimes = trails.flatMap((t) => [t.startTime, t.endTime]);
    const min = Math.min(...allTimes);
    const max = Math.max(...allTimes);
    const dataDuration = max - min;

    // Calculate scheduling parameters
    const avgDuration =
      trails.reduce((sum, t) => sum + (t.endTime - t.startTime), 0) /
      trails.length;
    const minGapMs = settings.minGapBetweenTrails * 1000;
    const overlapMultiplier = 1 - settings.overlapFactor * 0.8;
    const baseSpacing =
      (avgDuration / settings.maxConcurrentTrails) * overlapMultiplier;
    const actualSpacing = Math.max(minGapMs, baseSpacing);

    const totalTimeNeeded = trails.length * actualSpacing;
    const cycleDuration = Math.max(
      totalTimeNeeded,
      dataDuration > 0 ? dataDuration : 60000
    );

    // Group trails by color for interleaved scheduling
    const trailsByColor = new Map<string, number[]>();
    trails.forEach((trail, index) => {
      if (!trailsByColor.has(trail.color)) {
        trailsByColor.set(trail.color, []);
      }
      trailsByColor.get(trail.color)!.push(index);
    });

    const colorGroups = Array.from(trailsByColor.values());
    const orderedIndices: number[] = [];
    const maxGroupSize = Math.max(...colorGroups.map((g) => g.length));

    // Interleave trails by color for visual variety
    for (let i = 0; i < maxGroupSize; i++) {
      for (const group of colorGroups) {
        if (i < group.length) {
          orderedIndices.push(group[i]);
        }
      }
    }

    // Create schedule for each trail
    const schedule = trails.map((trail, originalIndex) => {
      if (settings.trailAnimationMode === "natural") {
        return {
          index: originalIndex,
          startTime: trail.startTime,
          endTime: trail.endTime,
          duration: trail.endTime - trail.startTime,
          adjustedClicks: trail.clicks,
        };
      } else {
        // Stagger mode - choreograph trail timing
        const trailDuration = trail.endTime - trail.startTime;
        const scheduledPosition = orderedIndices.indexOf(originalIndex);
        const startOffset =
          (scheduledPosition * actualSpacing) % cycleDuration;
        const timeOffset = min + startOffset - trail.startTime;

        const adjustedClicks = trail.clicks.map((click) => ({
          ...click,
          ts: click.ts + timeOffset,
        }));

        return {
          index: originalIndex,
          startTime: min + startOffset,
          endTime: min + startOffset + trailDuration,
          duration: trailDuration,
          adjustedClicks,
        };
      }
    });

    return {
      timeBounds: { min, max },
      cycleDuration,
      trailSchedule: schedule,
    };
  }, [
    trails,
    settings.trailAnimationMode,
    settings.maxConcurrentTrails,
    settings.overlapFactor,
    settings.minGapBetweenTrails,
  ]);

  // Apply style variations callback
  const applyStyleVariationsLocal = useCallback(
    (
      points: Array<{ x: number; y: number }>,
      style: string,
      seed: number,
      chaosIntensity: number = 1.0
    ): Array<{ x: number; y: number }> => {
      return applyStyleVariations(points, style, seed, chaosIntensity);
    },
    []
  );

  // Generate trail states with visual variations
  const trailStates = useMemo((): TrailState[] => {
    if (trails.length === 0) return [];

    return trails.map((trail, index) => {
      const schedule = trailSchedule[index];
      if (!schedule) {
        return {
          trail,
          startOffsetMs: 0,
          durationMs: trail.endTime - trail.startTime,
          variedPoints: trail.points,
          clicksWithProgress: [],
        };
      }

      const startOffsetMs = schedule.startTime - timeBounds.min;
      const durationMs = schedule.duration;

      // Apply style variations for organic/chaotic effects
      const seed = trail.points[0]?.x + trail.points[0]?.y || 0;
      const variedPoints = applyStyleVariationsLocal(
        trail.points,
        settings.trailStyle,
        seed,
        settings.chaosIntensity || 1.0
      );

      // Calculate click progress along the trail
      const clicksWithProgress = trail.clicks.map((click) => {
        let clickPointIndex = 0;
        let minTimeDiff = Math.abs(trail.points[0]?.ts - click.ts);

        for (let i = 1; i < trail.points.length; i++) {
          const timeDiff = Math.abs(trail.points[i].ts - click.ts);
          if (timeDiff < minTimeDiff) {
            minTimeDiff = timeDiff;
            clickPointIndex = i;
          }
        }

        const progress =
          trail.points.length > 1
            ? clickPointIndex / (trail.points.length - 1)
            : 0;

        return {
          x: click.x,
          y: click.y,
          ts: click.ts,
          progress,
          duration: click.duration,
        };
      });

      return {
        trail,
        startOffsetMs,
        durationMs,
        variedPoints,
        clicksWithProgress,
      };
    });
  }, [
    trails,
    trailSchedule,
    timeBounds.min,
    settings.trailStyle,
    settings.chaosIntensity,
    applyStyleVariationsLocal,
  ]);

  return {
    trails,
    trailStates,
    trailSchedule,
    timeBounds,
    cycleDuration,
    documentCanvasSize,
  };
}
