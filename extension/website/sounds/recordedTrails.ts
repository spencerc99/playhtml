// ABOUTME: The recorded-trail format the density harness replays, and how to derive it
// ABOUTME: One stroke per entry — an id, a colour and a list of timed points

import {
  MAX_INTERPOLATION_GAP_MS,
  SampleEvent,
  buildMoveTracks,
} from "./SamplePlayback";

/** One sampled cursor position, in normalized 0-1 canvas coordinates. */
export interface RecordedPoint {
  x: number;
  y: number;
  /** Milliseconds from the start of this trail. */
  t: number;
}

/**
 * One continuous cursor stroke, replayable on its own clock.
 *
 * Deliberately the smallest thing that can be looped: a stroke rather than a
 * whole participant's session, because the harness needs to place many of them
 * at once at arbitrary offsets, and a session with ten-minute gaps in it would
 * be mostly silence wherever it landed.
 */
export interface RecordedTrail {
  id: string;
  color: string;
  points: RecordedPoint[];
  /** The CSS cursor keyword in force, which picks the voice's instrument. */
  cursor?: string;
}

/** What a saved recording file holds. */
export interface TrailRecording {
  v: 1;
  trails: RecordedTrail[];
}

/** Colours cycled across recorded strokes, so they stay tellable apart. */
const TRAIL_COLORS = [
  "#4a9a8a",
  "#c4724e",
  "#5b8db8",
  "#d4b85c",
  "#8a6fa8",
  "#6f8a4a",
];

/**
 * Shortest stroke worth keeping. Two points a quarter-second apart is a
 * teleport, not a gesture, and a library full of them replays as clicks rather
 * than as lines.
 */
const MIN_POINTS = 6;
const MIN_DURATION_MS = 1500;

/**
 * Split recorded browsing into individual strokes.
 *
 * Cursor archival sampling is sparse and stops entirely while a participant
 * reads, so a participant's track is really a series of separate gestures with
 * long dead air between them. Anything past `MAX_INTERPOLATION_GAP_MS` is a
 * break rather than a slow stretch — the same threshold the replay refuses to
 * interpolate across — so that is where a stroke ends.
 */
export function recordTrailsFromEvents(events: SampleEvent[]): RecordedTrail[] {
  const trails: RecordedTrail[] = [];
  let colorIndex = 0;
  for (const track of buildMoveTracks(events).values()) {
    let stroke: RecordedPoint[] = [];
    let cursor: string | undefined;
    let strokeStart = 0;

    const close = () => {
      const span = stroke.length > 0 ? stroke[stroke.length - 1].t : 0;
      if (stroke.length >= MIN_POINTS && span >= MIN_DURATION_MS) {
        trails.push({
          id: `${track.pid}-${trails.length}`,
          color: TRAIL_COLORS[colorIndex % TRAIL_COLORS.length],
          points: stroke,
          cursor,
        });
        colorIndex++;
      }
      stroke = [];
      cursor = undefined;
    };

    for (const point of track.points) {
      if (stroke.length === 0) {
        strokeStart = point.t;
      } else if (point.t - (strokeStart + stroke[stroke.length - 1].t) > MAX_INTERPOLATION_GAP_MS) {
        close();
        strokeStart = point.t;
      }
      // Re-based to the stroke's own clock, so a trail can be placed at any
      // offset the harness likes without carrying the sample's timeline.
      stroke.push({
        x: point.x,
        y: point.y,
        t: Math.round(point.t - strokeStart),
      });
      cursor = cursor ?? point.cursor;
    }
    close();
  }
  return trails;
}

/** How long a trail runs, in ms. */
export const trailDurationMs = (trail: RecordedTrail): number =>
  trail.points.length === 0 ? 0 : trail.points[trail.points.length - 1].t;

/**
 * The trail's position at `timeMs`, lerped between the two bracketing samples,
 * or null when the clock sits outside the stroke.
 *
 * Interpolated rather than stepped for the same reason the sample replay is:
 * the sound engine derives velocity from per-frame position deltas, and a
 * teleport between two sparse samples reads as one enormous spike followed by
 * nothing — which is not what any real cursor does, and distorts every
 * velocity-driven parameter in the engine.
 */
export function positionAt(
  trail: RecordedTrail,
  timeMs: number,
): { x: number; y: number } | null {
  const points = trail.points;
  if (points.length === 0) return null;
  if (timeMs < points[0].t || timeMs > points[points.length - 1].t) return null;
  let index = 0;
  while (index < points.length - 1 && points[index + 1].t <= timeMs) index++;
  const current = points[index];
  const next = points[index + 1];
  if (!next) return { x: current.x, y: current.y };
  const span = next.t - current.t;
  const progress = span <= 0 ? 0 : (timeMs - current.t) / span;
  return {
    x: current.x + (next.x - current.x) * progress,
    y: current.y + (next.y - current.y) * progress,
  };
}

export const serializeRecording = (
  trails: RecordedTrail[],
): TrailRecording => ({ v: 1, trails });

/**
 * Read a recording back, keeping only what is actually replayable. A hand-made
 * or hand-edited file is the normal case here, so this drops bad entries rather
 * than throwing the whole file away.
 */
export function parseRecording(raw: unknown): RecordedTrail[] {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null
      ? (raw as { trails?: unknown }).trails
      : null;
  if (!Array.isArray(source)) return [];
  const trails: RecordedTrail[] = [];
  for (const entry of source) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Partial<RecordedTrail>;
    if (!Array.isArray(candidate.points)) continue;
    const points: RecordedPoint[] = [];
    for (const point of candidate.points) {
      if (typeof point !== "object" || point === null) continue;
      const { x, y, t } = point as Partial<RecordedPoint>;
      if (typeof x !== "number" || typeof y !== "number") continue;
      if (typeof t !== "number" || !Number.isFinite(t)) continue;
      points.push({ x, y, t });
    }
    if (points.length < 2) continue;
    // A file written by hand may not have sorted its points; the lerp above
    // walks them in order and would otherwise silently replay a scribble.
    points.sort((a, b) => a.t - b.t);
    const start = points[0].t;
    trails.push({
      id: typeof candidate.id === "string" ? candidate.id : `trail-${trails.length}`,
      color:
        typeof candidate.color === "string"
          ? candidate.color
          : TRAIL_COLORS[trails.length % TRAIL_COLORS.length],
      points: points.map((point) => ({ ...point, t: point.t - start })),
      cursor: typeof candidate.cursor === "string" ? candidate.cursor : undefined,
    });
  }
  return trails;
}
