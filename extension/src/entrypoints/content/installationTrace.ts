// ABOUTME: Draws browsing as the portrait draws it — freehand ink strokes and click ripples.
// ABOUTME: Mirrors the screens' stroke geometry and ripple math so a machine and the wall match.

import { getStroke } from "perfect-freehand";

export interface TracePoint {
  x: number;
  y: number;
  t: number;
}

/**
 * The portrait's freehand settings: a body of uniform width with tapered ends,
 * and near-zero streamline so the ink stays under the cursor instead of lagging.
 */
const FREEHAND = {
  thinning: 0,
  smoothing: 0.5,
  streamline: 0.05,
  simulatePressure: false,
};
const END_TAPER = 20;
/** Matches the screens' stroke width. */
const STROKE_SIZE = 5;

/** Opacity of a stroke while it is being drawn, and once it has settled. */
export const LIVE_ALPHA = 0.72;
export const SETTLED_ALPHA = 0.36;
/** Earlier browsing on this site, held under everything else. */
export const PREVIOUS_ALPHA = 0.16;

/** A pause this long ends the current stroke. */
export const STROKE_GAP_MS = 1200;
/**
 * Ink lives in document space, so a scroll while the cursor sits still would
 * otherwise draw a long diagonal slash. The screens split a trail on the same
 * jump; this is the fraction of the viewport height that counts as one.
 */
export const JUMP_SPLIT_FRACTION = 0.5;
/** Outline cost grows with a stroke's length, so long strokes are split. */
const MAX_STROKE_POINTS = 260;
/** A settled stroke eases to the dim rather than snapping. */
const DIM_FADE_MS = 1200;
/** How long finished ink stays before it departs, and how long departing takes. */
const HOLD_MS = 45_000;
const DEPART_MS = 3000;
/** Bound on retained ink, oldest first. */
const MAX_STROKES = 48;

/**
 * The screens' click settings (CLICK_DEFAULTS). The live portrait shrinks the
 * radius because thousands of people's clicks land in one frame; on one
 * machine's own page there is room for the full mark.
 */
const RIPPLE = {
  minRadius: 12,
  maxRadius: 80,
  coreRadius: 3,
  minDuration: 500,
  maxDuration: 2500,
  expansionDuration: 2400,
  strokeWidth: 4,
  opacity: 0.6,
  numRings: 3,
  ringDelayMs: 160,
  animationStopPoint: 0.45,
};
const MAX_HOLD_MULTIPLIER = 3;
/** Retained click marks, oldest first. */
const MAX_RIPPLES = 80;

export interface Ripple {
  x: number;
  y: number;
  startTime: number;
  /** ms held down, when the click was a hold. */
  holdDuration?: number;
  /** Per-click variation, as the screens do it. */
  radiusFactor: number;
  durationFactor: number;
}

export interface RippleRing {
  radius: number;
  alpha: number;
}

/**
 * Rings for a ripple at `now`, mirroring the screens' geometry: each ring
 * expands from the click point at one velocity and freezes at its own radius,
 * so a click reads as a small core inside wider marks.
 */
export function rippleRings(ripple: Ripple, now: number): RippleRing[] {
  const holdMultiplier = ripple.holdDuration
    ? Math.min(MAX_HOLD_MULTIPLIER, 1 + ripple.holdDuration / 1000)
    : 1;
  const totalDuration =
    (RIPPLE.minDuration +
      ripple.durationFactor * (RIPPLE.maxDuration - RIPPLE.minDuration)) *
    holdMultiplier;
  const expansionDuration = RIPPLE.expansionDuration * holdMultiplier;
  const completedAt =
    ripple.startTime +
    Math.max(
      totalDuration,
      (RIPPLE.numRings - 1) * RIPPLE.ringDelayMs + expansionDuration,
    );
  if (now <= ripple.startTime) return [];
  // Once the rings stop expanding the mark stays, so a click is still there to
  // see later — the same way the screens keep click residue.
  const settledFor = now - completedAt;
  const alpha =
    settledFor <= 0
      ? RIPPLE.opacity
      : restingAlpha(settledFor, RIPPLE.opacity, RIPPLE.opacity * 0.5);
  if (alpha <= 0.01) return [];

  const maxRadius =
    (RIPPLE.minRadius +
      ripple.radiusFactor * (RIPPLE.maxRadius - RIPPLE.minRadius)) *
    holdMultiplier;
  const outerTarget = maxRadius * RIPPLE.animationStopPoint;
  const core = Math.max(
    1,
    Math.min(
      RIPPLE.coreRadius + (ripple.radiusFactor - 0.5) * 4,
      outerTarget,
    ),
  );
  const velocity = outerTarget / expansionDuration;

  const rings: RippleRing[] = [];
  for (let index = 0; index < RIPPLE.numRings; index += 1) {
    const target =
      core + (outerTarget - core) * (index / (RIPPLE.numRings - 1));
    const started = now - (ripple.startTime + index * RIPPLE.ringDelayMs);
    if (started <= 0) continue;
    const duration = Math.max(1, target / velocity);
    rings.push({ radius: target * Math.min(1, started / duration), alpha });
  }
  return rings;
}

/** True once a click mark has faded out entirely. */
export function rippleDone(ripple: Ripple, now: number): boolean {
  return now > ripple.startTime && rippleRings(ripple, now).length === 0;
}

/** True while a click mark is still changing on screen. */
export function rippleAnimating(ripple: Ripple, now: number): boolean {
  const holdMultiplier = ripple.holdDuration
    ? Math.min(MAX_HOLD_MULTIPLIER, 1 + ripple.holdDuration / 1000)
    : 1;
  const totalDuration =
    (RIPPLE.minDuration +
      ripple.durationFactor * (RIPPLE.maxDuration - RIPPLE.minDuration)) *
    holdMultiplier;
  const completedAt =
    ripple.startTime +
    Math.max(
      totalDuration,
      (RIPPLE.numRings - 1) * RIPPLE.ringDelayMs +
        RIPPLE.expansionDuration * holdMultiplier,
    );
  const settledFor = now - completedAt;
  return settledFor < DIM_FADE_MS || settledFor >= HOLD_MS;
}

/**
 * Builds the filled outline for a run of points. Width is baked into the
 * geometry, so the result is filled, never stroked — that is what gives the
 * screens' trails their ink-like edges.
 */
export function freehandPath(
  points: readonly TracePoint[],
  complete: boolean,
): Path2D | null {
  if (points.length < 2) return null;
  const outline = getStroke(
    points.map((point) => [point.x, point.y]),
    {
      ...FREEHAND,
      size: STROKE_SIZE,
      last: complete,
      start: { taper: END_TAPER },
      end: complete ? { taper: END_TAPER } : { taper: 0, cap: true },
    },
  );
  if (outline.length < 3) return null;

  const path = new Path2D();
  path.moveTo(outline[0][0], outline[0][1]);
  for (let index = 0; index < outline.length; index += 1) {
    const [x0, y0] = outline[index];
    const [x1, y1] = outline[(index + 1) % outline.length];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

/**
 * The lifecycle every finished mark follows: ease from its live weight to a
 * resting one, hold there so the page keeps what happened on it, then depart.
 */
function restingAlpha(sinceEndedMs: number, live: number, rest: number): number {
  if (sinceEndedMs <= 0) return live;
  if (sinceEndedMs < DIM_FADE_MS) {
    return live + (rest - live) * (sinceEndedMs / DIM_FADE_MS);
  }
  const departing = sinceEndedMs - HOLD_MS;
  if (departing <= 0) return rest;
  if (departing >= DEPART_MS) return 0;
  return rest * (1 - departing / DEPART_MS);
}

/** Opacity of a finished stroke, from the live weight down to gone. */
export function settledAlpha(sinceEndedMs: number): number {
  return restingAlpha(sinceEndedMs, LIVE_ALPHA, SETTLED_ALPHA);
}

interface Stroke {
  points: TracePoint[];
  endedAt: number | null;
  path: Path2D | null;
}

export interface TraceField {
  /** Point in document space; `maxJump` splits the stroke across a scroll. */
  addPoint(x: number, y: number, now: number, maxJump?: number): void;
  addClick(
    x: number,
    y: number,
    holdDuration: number | undefined,
    now: number,
  ): void;
  /** Earlier browsing on this domain, in viewport space. */
  setPrevious(strokes: TracePoint[][]): void;
  /** Live point count in the active stroke — reported on the frame host. */
  liveCount(): number;
  previousCount(): number;
  clear(): void;
  /**
   * Paints one frame, with the document-space ink shifted by the page's current
   * scroll so marks stay on the content they were drawn over. Returns the delay
   * in ms until the picture next changes: 0 while something is animating, a
   * positive number when only a scheduled fade is pending, and null when the
   * canvas can be left as it is.
   */
  draw(
    context: CanvasRenderingContext2D,
    color: string,
    view: { width: number; height: number; scrollX: number; scrollY: number },
    now: number,
  ): number | null;
}

export function createTraceField(): TraceField {
  let strokes: Stroke[] = [];
  let previous: { points: TracePoint[]; path: Path2D | null }[] = [];
  let ripples: Ripple[] = [];

  const active = (): Stroke | null => {
    const last = strokes[strokes.length - 1];
    return last && last.endedAt === null ? last : null;
  };

  const endStroke = (stroke: Stroke, now: number) => {
    stroke.endedAt = now;
    stroke.path = freehandPath(stroke.points, true);
  };

  return {
    addPoint(x, y, now, maxJump) {
      let stroke = active();
      if (stroke) {
        const last = stroke.points[stroke.points.length - 1];
        const jumped =
          maxJump !== undefined && Math.abs(y - last.y) > maxJump;
        if (
          now - last.t > STROKE_GAP_MS ||
          jumped ||
          stroke.points.length >= MAX_STROKE_POINTS
        ) {
          endStroke(stroke, now);
          // A stroke split by length stays visually joined by carrying its last
          // point; one split by a scroll jump must not, or the slash comes back.
          strokes.push({
            points: jumped ? [] : [last],
            endedAt: null,
            path: null,
          });
          stroke = active();
        }
      } else {
        strokes.push({ points: [], endedAt: null, path: null });
        stroke = active();
      }
      stroke!.points.push({ x, y, t: now });
      if (strokes.length > MAX_STROKES) strokes = strokes.slice(-MAX_STROKES);
    },
    addClick(x, y, holdDuration, now) {
      ripples.push({
        x,
        y,
        startTime: now,
        holdDuration,
        radiusFactor: Math.random(),
        durationFactor: Math.random(),
      });
      if (ripples.length > MAX_RIPPLES) ripples = ripples.slice(-MAX_RIPPLES);
    },
    setPrevious(next) {
      previous = next.map((points) => ({
        points,
        path: freehandPath(points, true),
      }));
    },
    liveCount() {
      return active()?.points.length ?? 0;
    },
    previousCount() {
      return previous.length;
    },
    clear() {
      strokes = [];
      previous = [];
      ripples = [];
    },
    draw(context, color, view, now) {
      context.clearRect(0, 0, view.width, view.height);
      context.save();
      context.translate(-view.scrollX, -view.scrollY);
      context.fillStyle = color;
      context.strokeStyle = color;

      for (const trace of previous) {
        if (!trace.path) continue;
        context.globalAlpha = PREVIOUS_ALPHA;
        context.fill(trace.path);
      }

      let animating = false;
      let nextChange: number | null = null;
      const noteChange = (delay: number) => {
        nextChange = nextChange === null ? delay : Math.min(nextChange, delay);
      };

      const live = active();
      if (live && now - live.points[live.points.length - 1].t > STROKE_GAP_MS) {
        endStroke(live, live.points[live.points.length - 1].t + STROKE_GAP_MS);
      }

      const kept: Stroke[] = [];
      for (const stroke of strokes) {
        if (stroke.endedAt === null) {
          const path = freehandPath(stroke.points, false);
          if (path) {
            context.globalAlpha = LIVE_ALPHA;
            context.fill(path);
          }
          kept.push(stroke);
          // A live stroke ends on its own once movement stops.
          noteChange(
            Math.max(
              0,
              stroke.points[stroke.points.length - 1].t + STROKE_GAP_MS - now,
            ),
          );
          continue;
        }
        const age = now - stroke.endedAt;
        const alpha = settledAlpha(age);
        if (alpha <= 0.01) continue;
        if (stroke.path) {
          context.globalAlpha = alpha;
          context.fill(stroke.path);
        }
        kept.push(stroke);
        if (age < DIM_FADE_MS) animating = true;
        else if (age < HOLD_MS) noteChange(HOLD_MS - age);
        else animating = true;
      }
      strokes = kept;

      const keptRipples: Ripple[] = [];
      context.lineWidth = RIPPLE.strokeWidth;
      for (const ripple of ripples) {
        const rings = rippleRings(ripple, now);
        if (rings.length === 0 && now > ripple.startTime) continue;
        keptRipples.push(ripple);
        if (rippleAnimating(ripple, now)) animating = true;
        for (const ring of rings) {
          if (ring.radius <= 0.5) continue;
          context.globalAlpha = ring.alpha;
          context.beginPath();
          context.arc(ripple.x, ripple.y, ring.radius, 0, Math.PI * 2);
          context.stroke();
        }
      }
      ripples = keptRipples;

      context.globalAlpha = 1;
      context.restore();
      if (animating) return 0;
      return nextChange;
    },
  };
}
