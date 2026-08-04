// ABOUTME: Canvas ink of a sheet's cursor trails and click/hold rings, progressively revealed during playback.
// ABOUTME: Segments and clicks are memoized per sheet+frame; the draw effect runs on every playback tick with no state churn.
import { useEffect, useMemo, useRef } from "react";
import type { CollectionEvent } from "../../shared/types";
import { TRAIL_TIME_THRESHOLD } from "../../shared/utils/eventUtils";
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

function drawSmoothPath(ctx: CanvasRenderingContext2D, points: TrailPoint[]): void {
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

function drawPolyline(ctx: CanvasRenderingContext2D, points: TrailPoint[]): void {
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
}

export function TrailsPlate({ sheet, frame, t, settings }: PlateProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const { segments, clicks } = useMemo(
    () => buildTrailData(sheet.cursorEvents, frame),
    [sheet.cursorEvents, frame.width, frame.height],
  );
  const ink = useMemo(
    () => resolveInk(sheet, settings),
    [sheet, settings.inkMode, settings.monoColor],
  );

  // Size/DPR setup only needs to happen when the frame itself changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = frame.width * dpr;
    canvas.height = frame.height * dpr;
    canvas.style.width = `${frame.width}px`;
    canvas.style.height = `${frame.height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [frame.width, frame.height]);

  // Actual drawing runs on every playback tick — pure canvas work, no React
  // state writes, so this stays cheap even at animation frame rate.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, frame.width, frame.height);

    const currentTs = sheetLocalTs(sheet.startTs, sheet.endTs, t);
    const range = Math.max(1, sheet.endTs - sheet.startTs);
    const windowMs = range * 0.15;

    ctx.lineWidth = settings.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = ink;
    ctx.globalAlpha = settings.trailOpacity;

    for (const segment of segments) {
      const visible =
        settings.trailsDrawMode === "reveal"
          ? segment.filter((p) => p.ts <= currentTs)
          : segment.filter((p) => p.ts <= currentTs && p.ts >= currentTs - windowMs);
      if (visible.length < 2) continue;
      ctx.beginPath();
      if (settings.smoothing) drawSmoothPath(ctx, visible);
      else drawPolyline(ctx, visible);
      ctx.stroke();
    }

    if (settings.showClicks) {
      for (const click of clicks) {
        if (click.ts > currentTs) continue;
        let alpha = settings.trailOpacity * 0.9;
        if (settings.trailsDrawMode === "window") {
          const age = currentTs - click.ts;
          if (age > windowMs) continue;
          alpha *= 1 - age / windowMs;
        }
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(click.x, click.y, settings.clickRadius * click.radiusMultiplier, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = settings.trailOpacity;
    }
  }, [
    segments,
    clicks,
    ink,
    t,
    frame.width,
    frame.height,
    sheet.startTs,
    sheet.endTs,
    settings.strokeWidth,
    settings.trailOpacity,
    settings.smoothing,
    settings.trailsDrawMode,
    settings.showClicks,
    settings.clickRadius,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: frame.width,
        height: frame.height,
        mixBlendMode: settings.blendMode,
        pointerEvents: "none",
      }}
    />
  );
}
