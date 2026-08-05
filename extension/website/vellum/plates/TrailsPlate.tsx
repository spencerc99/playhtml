// ABOUTME: SVG ink of a sheet's cursor trails and click/hold marks — filled perfect-freehand outlines with tapered ends,
// ABOUTME: matching the movement visualizations' cursor-trail look. Segments/clicks are memoized per sheet+frame; each tick only rebuilds path strings for the visible window.
import { useMemo } from "react";
import type { CollectionEvent } from "../../shared/types";
import { TRAIL_TIME_THRESHOLD } from "../../shared/utils/eventUtils";
import { CLICK_DEFAULTS } from "@movement/components/clickDefaults";
import {
  buildFreehandPathSegment,
  buildStraightPathSegment,
} from "@movement/utils/trailAnimation";
import type { PlateProps } from "../types";
import { resolveInk } from "./ink";
import { sheetLocalTs } from "./scrollTimeline";

interface TrailPoint {
  x: number;
  y: number;
  ts: number;
}

interface ClickMark {
  x: number;
  y: number;
  ts: number;
  /** Radius multiplier: 1 for a click, 1.6 for a hold. */
  radiusMultiplier: number;
}

interface CursorEventData {
  x?: number;
  y?: number;
  event?: string;
}

function buildTrailData(
  cursorEvents: CollectionEvent[],
  frame: { width: number; height: number },
): { segments: TrailPoint[][]; clicks: ClickMark[] } {
  const sorted = [...cursorEvents].sort((a, b) => a.ts - b.ts);
  const segments: TrailPoint[][] = [];
  const clicks: ClickMark[] = [];
  let current: TrailPoint[] = [];

  for (const event of sorted) {
    const data = event.data as unknown as CursorEventData;
    if (typeof data?.x !== "number" || typeof data?.y !== "number") continue;
    const point: TrailPoint = {
      x: data.x * frame.width,
      y: data.y * frame.height,
      ts: event.ts,
    };

    if (
      current.length > 0 &&
      event.ts - current[current.length - 1].ts > TRAIL_TIME_THRESHOLD
    ) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(point);

    if (data.event === "click" || data.event === "hold") {
      clicks.push({
        x: point.x,
        y: point.y,
        ts: event.ts,
        radiusMultiplier: data.event === "hold" ? 1.6 : 1,
      });
    }
  }
  if (current.length > 1) segments.push(current);

  return { segments, clicks };
}

// The resting click mark reuses the ripple's own size/opacity relationships
// instead of inventing new ones: the core dot is a fixed small fraction of
// the ring's resting radius (independent of the min/max radius range, same
// as ClickRipple's real core), and the ring is dimmer than the dot by the
// same clickOpacity weighting ClickRipple draws its rings at.
const CLICK_CORE_RATIO =
  CLICK_DEFAULTS.clickCoreRadius /
  (CLICK_DEFAULTS.clickMaxRadius * CLICK_DEFAULTS.clickAnimationStopPoint);

export function TrailsPlate({ sheet, frame, t, settings }: PlateProps) {
  const { segments, clicks } = useMemo(
    () => buildTrailData(sheet.cursorEvents, frame),
    [sheet.cursorEvents, frame.width, frame.height],
  );
  const ink = useMemo(
    () => resolveInk(sheet, settings),
    [sheet, settings.inkMode, settings.monoColor],
  );

  const currentTs = sheetLocalTs(sheet.startTs, sheet.endTs, t);
  const range = Math.max(1, sheet.endTs - sheet.startTs);
  const windowMs = range * 0.15;
  const freehandSize = settings.strokeWidth * 2;

  return (
    <svg
      width={frame.width}
      height={frame.height}
      style={{
        position: "absolute",
        inset: 0,
        mixBlendMode: settings.blendMode,
        pointerEvents: "none",
      }}
    >
      {segments.map((segment, i) => {
        const visible =
          settings.trailsDrawMode === "reveal"
            ? segment.filter((p) => p.ts <= currentTs)
            : segment.filter(
                (p) => p.ts <= currentTs && p.ts >= currentTs - windowMs,
              );
        if (visible.length < 2) return null;

        // The head is still "inside" this segment (actively drawing) until
        // currentTs passes the segment's own last timestamp — checked against
        // the full segment, not the (possibly window-trimmed) visible slice,
        // so ends taper like a finished stroke once the segment is done
        // regardless of draw mode.
        const isComplete = currentTs >= segment[segment.length - 1].ts;

        if (settings.smoothing) {
          const pathData = buildFreehandPathSegment(
            visible,
            0,
            visible.length - 1,
            freehandSize,
            isComplete,
          );
          if (!pathData) return null;
          return (
            <path
              key={i}
              d={pathData}
              fill={ink}
              fillOpacity={settings.trailOpacity}
            />
          );
        }

        const pathData = buildStraightPathSegment(visible, 0, visible.length - 1);
        if (!pathData) return null;
        return (
          <path
            key={i}
            d={pathData}
            fill="none"
            stroke={ink}
            strokeWidth={settings.strokeWidth}
            strokeOpacity={settings.trailOpacity}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}

      {settings.showClicks
        ? clicks.map((click, i) => {
            if (click.ts > currentTs) return null;
            let alpha = settings.trailOpacity * 0.9;
            if (settings.trailsDrawMode === "window") {
              const age = currentTs - click.ts;
              if (age > windowMs) return null;
              alpha *= 1 - age / windowMs;
            }

            const ringRadius = settings.clickRadius * click.radiusMultiplier;
            const coreRadius = Math.max(1, ringRadius * CLICK_CORE_RATIO);

            return (
              <g key={i}>
                <circle
                  cx={click.x}
                  cy={click.y}
                  r={ringRadius}
                  fill="none"
                  stroke={ink}
                  strokeWidth={CLICK_DEFAULTS.clickStrokeWidth}
                  opacity={alpha * CLICK_DEFAULTS.clickOpacity}
                />
                <circle
                  cx={click.x}
                  cy={click.y}
                  r={coreRadius}
                  fill={ink}
                  opacity={alpha}
                />
              </g>
            );
          })
        : null}
    </svg>
  );
}
