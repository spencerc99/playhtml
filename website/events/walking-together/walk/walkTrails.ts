// ABOUTME: Turns joined walkers' navigation events into URL-stop trails for the page background.
// ABOUTME: Pure helpers: walker data, step extraction, stop placement, and TrailState building.

import type { CollectionEvent, TrailState } from "@movement/types";
import { applyStyleVariations } from "@movement/utils/styleUtils";
import { densifyGrowingTrail } from "@movement/hooks/useCursorTrails";

/** Someone who joined the walk. Keyed by pid in page data, so joining twice
 * (or from two tabs) overwrites instead of duplicating. */
export interface Walker {
  pid: string;
  name: string;
  color: string;
  joinedAt: number;
}

export type Walkers = Record<string, Walker>;

export interface WalkersData {
  walkers: Walkers;
}

/** One page a walker landed on. `url` is origin + path, no query or hash. */
export interface WalkStep {
  url: string;
  label: string;
  ts: number;
}

/** Most stops one walker's trail keeps, so a long walk stays legible. */
export const MAX_STEPS_PER_WALKER = 24;

/** origin + path with no query, hash, or trailing slash on a bare path. */
export function stepUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${url.host.replace(/^www\./, "")}${path}`;
  } catch {
    return null;
  }
}

/** A short label for a stop: host and path, middle-trimmed when long. */
export function stepLabel(url: string, max = 34): string {
  if (url.length <= max) return url;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  return `${url.slice(0, head)}…${url.slice(url.length - (keep - head))}`;
}

function eventTs(ts: number | string): number {
  return typeof ts === "number" ? ts : Date.parse(ts);
}

/**
 * Each walker's pages since they joined, oldest first. Only "the page came into
 * view" navigation events count (focus, popstate), repeats of the page they're
 * already on collapse, and the event page itself is skipped so going back to
 * check the chat doesn't read as a stop.
 */
export function stepsByWalker(
  events: CollectionEvent[],
  walkers: Walkers,
  isEventPage: (url: string) => boolean,
): Record<string, WalkStep[]> {
  const sorted = events
    .filter(
      (e) =>
        e.type === "navigation" &&
        (e.data?.event === "focus" || e.data?.event === "popstate") &&
        !!walkers[e.meta?.pid],
    )
    .map((e) => ({ e, ts: eventTs(e.ts) }))
    .filter(({ e, ts }) => Number.isFinite(ts) && ts >= walkers[e.meta.pid].joinedAt)
    .sort((a, b) => a.ts - b.ts);

  const seen = new Set<string>();
  const result: Record<string, WalkStep[]> = {};
  for (const { e, ts } of sorted) {
    // The stream replays and the backfill overlaps it; ids dedupe both.
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const url = stepUrl(e.meta.url);
    if (!url || isEventPage(e.meta.url)) continue;
    const steps = (result[e.meta.pid] ??= []);
    if (steps[steps.length - 1]?.url === url) continue;
    steps.push({ url, label: stepLabel(url), ts });
  }
  for (const pid of Object.keys(result)) {
    result[pid] = result[pid].slice(-MAX_STEPS_PER_WALKER);
  }
  return result;
}

function hash(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * Where a URL sits on the page, as a 0..1 fraction of the page. Everyone sees
 * the same URL in the same place, so walkers who visit the same page cross
 * there. Stops keep to the side bands so the chat in the middle stays readable;
 * trails still pass behind it on their way across.
 */
export function stopPoint(url: string): { x: number; y: number } {
  const u = hash(url, 1);
  const v = hash(url, 2);
  const side = hash(url.split("/")[0], 3) < 0.5 ? "left" : "right";
  const x = side === "left" ? 0.04 + u * 0.24 : 0.72 + u * 0.24;
  return { x, y: 0.1 + v * 0.8 };
}

/** Points between two stops along a gentle bend, so a hop reads as a walk
 * rather than a ruler line. Depends only on the two URLs, so a growing trail
 * never reshapes the part already drawn. */
function bend(
  a: { x: number; y: number },
  b: { x: number; y: number },
  key: string,
  steps = 6,
): Array<{ x: number; y: number }> {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const offset = (hash(key, 4) - 0.5) * 0.5 * length;
  const cx = (a.x + b.x) / 2 + (-dy / length) * offset;
  const cy = (a.y + b.y) / 2 + (dx / length) * offset;
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x,
      y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * b.y,
    });
  }
  return points;
}

/**
 * A walker's trail in the same TrailState shape the live cursor trails use, so
 * LiveTrails draws, grows, and settles it exactly like the portrait does. The
 * points are page pixels.
 */
export function walkerTrailState(
  walker: Walker,
  steps: WalkStep[],
  size: { width: number; height: number },
  trailStyle = "chaotic",
): TrailState | null {
  if (steps.length < 2 || size.width <= 0 || size.height <= 0) return null;
  const px = (p: { x: number; y: number }) => ({
    x: p.x * size.width,
    y: p.y * size.height,
  });
  const points: Array<{ x: number; y: number; ts: number }> = [];
  // Index into `points` where each stop lands, so a click ripple marks it.
  const stopIndices: number[] = [];
  steps.forEach((step, i) => {
    const here = px(stopPoint(step.url));
    if (i === 0) {
      points.push({ ...here, ts: step.ts });
      stopIndices.push(0);
      return;
    }
    const prev = steps[i - 1];
    const from = px(stopPoint(prev.url));
    const between = bend(from, here, `${prev.url}>${step.url}`);
    between.forEach((p, j) =>
      points.push({
        ...p,
        ts: prev.ts + ((step.ts - prev.ts) * (j + 1)) / between.length,
      }),
    );
    stopIndices.push(points.length - 1);
  });
  const first = points[0];
  const seed = first.x + first.y;
  const vary = (upTo: number) =>
    densifyGrowingTrail(
      applyStyleVariations(points.slice(0, upTo), trailStyle, seed),
    );
  const variedPoints = vary(points.length);
  // LiveTrails maps progress onto the varied points, so each stop's ripple
  // needs its place in that list. Styling and densifying a prefix yields a
  // prefix of the full result, which is what keeps a growing trail stable.
  const variedStopProgress = stopIndices.map(
    (index) => (vary(index + 1).length - 1) / (variedPoints.length - 1),
  );
  return {
    trail: {
      id: `walk-${walker.pid}`,
      pid: walker.pid,
      points,
      color: walker.color,
      opacity: 1,
      startTime: points[0].ts,
      endTime: points[points.length - 1].ts,
      clicks: stopIndices.map((index) => ({
        x: points[index].x,
        y: points[index].y,
        ts: points[index].ts,
      })),
    },
    startOffsetMs: 0,
    durationMs: Math.max(1, points[points.length - 1].ts - points[0].ts),
    variedPoints,
    // Each site the walker landed on gets a click ripple as the trail reaches
    // it, the same mark the portrait leaves where someone clicked.
    clicksWithProgress: stopIndices.map((index, i) => ({
      x: points[index].x,
      y: points[index].y,
      ts: points[index].ts,
      progress: variedStopProgress[i],
    })),
  };
}
