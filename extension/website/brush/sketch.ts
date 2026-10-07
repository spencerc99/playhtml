// ABOUTME: p5.brush sketch that replays cursor trails as accumulating ink — each frame
// ABOUTME: draws only the new segment of every active trail, and never clears the canvas.

import p5 from "p5";
import * as brush from "p5.brush";
import { Trail } from "../shared/types";
import { effectiveWeight, strokeWidthPx, BRUSH_SCALE } from "./brushCatalog";
import { renderSettledSprite } from "./rippleOverlay";

export type ClickStyle = "ripple" | "spray" | "hatch" | "blot";
export type PressureMode = "constant" | "speed";

/** Settings the sketch reads every frame, so the panel can retune live. */
export interface BrushSettings {
  trailBrush: string;
  clickStyle: ClickStyle;
  strokeWeight: number;
  speed: number;
  maxConcurrentTrails: number;
  pressureMode: PressureMode;
  /** Draw the newest stretch of each stroke at full strength on the overlay. */
  wetHead: boolean;
}

/** Perf numbers the sketch publishes every frame for the readout. */
export interface BrushStats {
  fps: number;
  drawMs: number;
  pointsDrawn: number;
  activeTrails: number;
  finishedTrails: number;
  totalTrails: number;
  /** The weight actually handed to brush.set(), after per-brush normalisation. */
  appliedWeight: number;
  /** Rough on-screen stroke width in CSS pixels, for tuning against the SVG. */
  strokeWidthPx: number;
  /** Cost of repainting the wet-head buffer this frame, in ms. */
  wetMs: number;
}

export interface BrushSketch {
  remove: () => void;
  /** Wipe the accumulated ink and replay from the top. */
  restart: () => void;
  /** Download the current canvas as a PNG. */
  savePng: () => void;
  /**
   * Stamp a settled click ripple into the ink buffer, so strokes drawn after it
   * cover it the way later marks cover earlier ones on paper.
   */
  bakeRipple: (x: number, y: number, color: string) => void;
}

const BACKGROUND = "#faf7f2";
const ACCENTS = ["#4a9a8a", "#c4724e", "#5b8db8", "#d4b85c"];

/** Trails shorter than this contribute no visible ink. */
const MIN_POINTS = 2;
/** Gap between one trail's start and the next, in replayed ms. */
const TRAIL_STAGGER_MS = 900;
/** Smoothing factor for the displayed fps and frame cost. */
const STAT_SMOOTHING = 0.9;
/** Cursor speed (px/ms) at which pressure bottoms out in speed mode. */
const FAST_PX_PER_MS = 2.5;
/**
 * Real captured trails idle for minutes between bursts of movement. Collapsing
 * any gap longer than this keeps a trail's internal rhythm while cutting the
 * dead air that would otherwise dominate the replay.
 */
const MAX_GAP_MS = 600;
/**
 * Minimum path length, in px, committed to the brush in one go. p5.brush stamps
 * its tip along a plot at a fixed spacing; feeding it sub-spacing slivers every
 * frame quantises the line into separate blobs. Ink is therefore buffered to at
 * least this much while the cursor head keeps moving smoothly on its own layer.
 */
const MIN_CHUNK_PX = 6;
/**
 * How much of the freshly-made stroke stays "wet": drawn on the overlay at full
 * strength instead of being committed to the pastel buffer. As the head moves
 * on, the trailing end of this window dries — it is committed exactly once, so
 * nothing is ever laid down twice.
 */
const WET_WINDOW_MS = 450;
/** Wet ink is pressed a little harder, so fresh marks read denser than dry. */
const WET_PRESSURE_GAIN = 1.35;

interface ReplayPoint {
  x: number;
  y: number;
  /** Offset on the compressed replay clock. */
  ts: number;
  /** The original capture timestamp, used to place clicks. */
  srcTs: number;
  /** CSS cursor the participant had here, for the cursor glyph. */
  cursor?: string;
}

/** The newest stretch of an active stroke, drawn at full strength on top. */
interface WetSegment {
  points: ReplayPoint[];
  color: string;
}

/** Fractional index at a given time on the trail's compressed clock. */
function indexAtTime(points: ReplayPoint[], ts: number): number {
  if (ts <= points[0].ts) return 0;
  const last = points.length - 1;
  if (ts >= points[last].ts) return last;
  for (let i = 1; i <= last; i++) {
    if (points[i].ts >= ts) {
      const a = points[i - 1];
      const span = Math.max(1, points[i].ts - a.ts);
      return i - 1 + (ts - a.ts) / span;
    }
  }
  return last;
}

/** The live head of an active trail, handed to the cursor layer each frame. */
export interface CursorHead {
  x: number;
  y: number;
  color: string;
  cursor?: string;
}

/** Interpolate the point at a fractional index along the path. */
function pointAt(points: ReplayPoint[], at: number): ReplayPoint {
  const i = Math.floor(at);
  if (i >= points.length - 1) return points[points.length - 1];
  const f = at - i;
  if (f <= 0) return points[i];
  const a = points[i];
  const b = points[i + 1];
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    ts: a.ts + (b.ts - a.ts) * f,
    srcTs: a.srcTs,
    cursor: a.cursor,
  };
}

/** Path length between two fractional indices. */
function pathLengthBetween(
  points: ReplayPoint[],
  from: number,
  to: number,
): number {
  if (to <= from) return 0;
  let total = 0;
  let prev = pointAt(points, from);
  for (let i = Math.ceil(from); i <= Math.floor(to); i++) {
    total += Math.hypot(points[i].x - prev.x, points[i].y - prev.y);
    prev = points[i];
  }
  const end = pointAt(points, to);
  total += Math.hypot(end.x - prev.x, end.y - prev.y);
  return total;
}

/** The real points between two fractional indices, with interpolated ends. */
function pointsBetween(
  points: ReplayPoint[],
  from: number,
  to: number,
): ReplayPoint[] {
  const out: ReplayPoint[] = [pointAt(points, from)];
  for (let i = Math.ceil(from); i <= Math.floor(to); i++) {
    if (i > from) out.push(points[i]);
  }
  const end = pointAt(points, to);
  const last = out[out.length - 1];
  if (end.x !== last.x || end.y !== last.y) out.push(end);
  return out;
}

interface ReplayClick {
  x: number;
  y: number;
  ts: number;
}

/** One trail laid out on the shared replay clock, with its draw cursor. */
interface ReplayTrail {
  points: ReplayPoint[];
  clicks: ReplayClick[];
  color: string;
  /** Offset on the replay timeline where this trail begins. */
  startMs: number;
  /** Offset where its last point lands. */
  endMs: number;
  /**
   * Fractional index of the head already committed to the canvas. Fractional
   * because the head interpolates between points, so ink can stop part-way
   * along a segment and resume from exactly there.
   */
  drawnUpTo: number;
  /** Index of the next click still waiting for its moment. */
  clicksDropped: number;
}

/**
 * Place an original timestamp on the trail's compressed clock, by locating the
 * last point that had already happened by then.
 */
function compressedTimeFor(points: ReplayPoint[], srcTs: number): number {
  if (srcTs <= points[0].srcTs) return 0;
  const last = points[points.length - 1];
  if (srcTs >= last.srcTs) return last.ts;
  for (let i = 1; i < points.length; i++) {
    if (points[i].srcTs >= srcTs) return points[i - 1].ts;
  }
  return last.ts;
}

/**
 * Lay trails out on one replay timeline. Each trail keeps its own internal
 * timing (so a slow drift stays slow relative to a fast flick) but starts on a
 * stagger, which keeps a bounded number of trails inking at once.
 */
function buildReplay(trails: Trail[], maxConcurrent: number): ReplayTrail[] {
  const usable = trails.filter((t) => t.points.length >= MIN_POINTS);
  const replay: ReplayTrail[] = [];

  // Each lane is one concurrent slot: a trail starts when its lane's previous
  // trail has finished (minus a stagger, so they overlap rather than march).
  const laneFreeAt = new Array<number>(maxConcurrent).fill(0);

  usable.forEach((trail, index) => {
    // Re-time the trail onto a compressed clock, capping idle gaps. `srcTs`
    // keeps the original moment so clicks can be placed against it.
    const points: ReplayPoint[] = [];
    let elapsed = 0;
    trail.points.forEach((p, i) => {
      if (i > 0) {
        elapsed += Math.min(MAX_GAP_MS, p.ts - trail.points[i - 1].ts);
      }
      points.push({
        x: p.x,
        y: p.y,
        ts: elapsed,
        srcTs: p.ts,
        cursor: p.cursor,
      });
    });
    const duration = points[points.length - 1].ts;

    // Fill the lane that frees up soonest.
    let lane = 0;
    for (let i = 1; i < maxConcurrent; i++) {
      if (laneFreeAt[i] < laneFreeAt[lane]) lane = i;
    }
    const startMs = Math.max(0, laneFreeAt[lane] - TRAIL_STAGGER_MS);
    laneFreeAt[lane] = startMs + duration + TRAIL_STAGGER_MS;

    replay.push({
      points,
      clicks: trail.clicks
        .map((c) => ({ x: c.x, y: c.y, ts: compressedTimeFor(points, c.ts) }))
        .sort((a, b) => a.ts - b.ts),
      color: trail.color || ACCENTS[index % ACCENTS.length],
      startMs,
      endMs: startMs + duration,
      drawnUpTo: 0,
      clicksDropped: 0,
    });
  });

  return replay;
}

/** Pressure from local cursor speed: slow strokes press harder. */
function pressureFor(
  mode: PressureMode,
  from: ReplayPoint,
  to: ReplayPoint,
): number {
  if (mode === "constant") return 1;
  const dt = Math.max(1, to.ts - from.ts);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const speed = dist / dt;
  // 1.4 at a standstill down to 0.35 at FAST_PX_PER_MS and beyond.
  const t = Math.min(1, speed / FAST_PX_PER_MS);
  return 1.4 - t * 1.05;
}

export function createBrushSketch(
  trails: Trail[],
  settingsRef: { current: BrushSettings },
  container: HTMLElement,
  onStats: (stats: BrushStats) => void,
  onError: (message: string) => void,
  /**
   * Called when a click lands while the "current ripples" style is active. The
   * ripple is animated on a 2D overlay above the ink rather than stamped into
   * the brush buffer, because it has to expand over time and then settle.
   */
  onRippleClick?: (x: number, y: number, color: string) => void,
  /** Called every frame with the live head of each still-drawing trail. */
  onCursors?: (heads: CursorHead[]) => void,
): BrushSketch {
  let restartFn = () => {};
  let saveFn = () => {};
  let disposeInk = () => {};
  let bakeRippleFn = (_x: number, _y: number, _color: string) => {};
  /** Set false on teardown so a queued frame cannot ink a removed buffer. */
  let alive = true;

  const sketch = (p: p5) => {
    brush.instance(p);

    // p5's WEBGL renderer clears the main canvas every frame, which would wipe
    // the accumulated ink. All marks go into this buffer instead, which is
    // cleared only on restart, and the main canvas simply blits it.
    let ink: p5.Graphics;
    /**
     * The still-wet end of every active stroke. Cleared and repainted whenever
     * a head advances, then composited over the dry ink. Same pastel brush as
     * the dry mark, just at full strength — the point is that wet and dry are
     * the same material, one simply has not settled yet.
     */
    let wet: p5.Graphics;
    /**
     * Signature of the wet windows painted into the buffer. Repainting is by
     * far the most expensive thing per frame, so it only happens when the
     * windows have actually moved enough to look different — otherwise the
     * previous buffer is composited again for free.
     */
    let wetSignature = "";
    /** Smoothed cost of the wet repaint, for the readout. */
    let smoothedWetMs = 0;
    let replay: ReplayTrail[] = [];
    let totalMs = 0;
    let clockMs = 0;
    let lastFrameAt = 0;
    let pointsDrawn = 0;
    let smoothedFps = 60;
    let smoothedDrawMs = 0;
    // Rebuilding the layout is only needed when the concurrency changes.
    let laidOutFor = -1;
    let lastErrorMessage: string | null = null;

    /** Surface a draw failure on the page instead of letting it vanish. */
    const reportError = (context: string, err: unknown) => {
      const message = `${context}: ${err instanceof Error ? err.message : String(err)}`;
      if (message === lastErrorMessage) return;
      lastErrorMessage = message;
      console.error("[cursor ink]", message, err);
      onError(message);
    };

    const layout = () => {
      const { maxConcurrentTrails } = settingsRef.current;
      replay = buildReplay(trails, maxConcurrentTrails);
      totalMs = replay.reduce((max, t) => Math.max(max, t.endMs), 0);
      laidOutFor = maxConcurrentTrails;
    };

    const reset = () => {
      layout();
      clockMs = 0;
      pointsDrawn = 0;
      ink.background(BACKGROUND);
    };

    /** Drop one click mark in the style the panel currently asks for. */
    const drawClick = (click: ReplayClick, color: string, weight: number) => {
      const { clickStyle } = settingsRef.current;

      // The production ripple is animated, so it is handed to the 2D overlay in
      // viewport coordinates and never touches the brush buffer.
      if (clickStyle === "ripple") {
        onRippleClick?.(click.x, click.y, color);
        return;
      }

      const cx = toCanvasX(click.x);
      const cy = toCanvasY(click.y);

      // Fill and hatch are sticky global state in p5.brush, so each style
      // clears both before setting only what it needs — otherwise the previous
      // style's fill leaks in and floods the mark. Stroke is left alone here;
      // each branch sets it, and the trail loop re-sets it every chunk.
      brush.noFill();
      brush.noHatch();

      if (clickStyle === "spray") {
        brush.set("spray", color, effectiveWeight("spray", weight) * 1.6);
        // A short scribble under the spray tip reads as a stippled dab.
        brush.beginStroke("curve", cx, cy);
        brush.move(0, 5, 0.9);
        brush.move(Math.PI * 0.8, 6, 0.7);
        brush.endStroke(Math.PI * 1.5, 0.5);
        return;
      }

      if (clickStyle === "hatch") {
        // Hatched by hand with plain strokes. The library's hatch() path wants
        // a "hatch_brush" that 2.2.3 does not actually register, so this draws
        // the fill lines itself and stays on APIs that exist.
        brush.set("2H", color, effectiveWeight("2H", weight) * 0.8);
        const r = 5;
        brush.circle(cx, cy, r, 0.4);
        for (let offset = -r; offset <= r; offset += 2.5) {
          // Chord of the circle at this offset, hatched at 45 degrees.
          const half = Math.sqrt(Math.max(0, r * r - offset * offset));
          if (half < 0.5) continue;
          const ox = offset * Math.SQRT1_2;
          const oy = -offset * Math.SQRT1_2;
          const dx = half * Math.SQRT1_2;
          const dy = half * Math.SQRT1_2;
          brush.line(cx + ox - dx, cy + oy - dy, cx + ox + dx, cy + oy + dy);
        }
        return;
      }

      // blot: watercolor-ish bleeding fill, no outline.
      brush.noStroke();
      brush.fillBleed(0.28, "out");
      brush.fillTexture(0.55, 0.4);
      brush.fill(color, 70);
      brush.circle(cx, cy, 6, 0.6);
      brush.noFill();
      // Hand stroke back, since the trail loop shares this global state.
      brush.stroke(color);
    };

    // p5.brush's beginStroke/move/endStroke do NOT inherit p5's translate, so
    // viewport pixels are converted to WEBGL's center-origin space by hand.
    const toCanvasX = (x: number) => x - p.width / 2;
    const toCanvasY = (y: number) => y - p.height / 2;

    /** The host's size, falling back to the viewport before layout settles. */
    const hostSize = () => ({
      width: container.clientWidth || window.innerWidth,
      height: container.clientHeight || window.innerHeight,
    });

    p.setup = () => {
      const { width, height } = hostSize();
      p.createCanvas(width, height, p.WEBGL);
      // devicePixelRatio beyond 2 costs a lot of fill rate for ink this soft.
      p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
      ink = p.createGraphics(width, height, p.WEBGL);
      ink.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
      // A second buffer on the SAME p5 instance — createGraphics shares the
      // instance, so this costs no extra WebGL context.
      wet = p.createGraphics(width, height, p.WEBGL);
      wet.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
      disposeInk = () => {
        alive = false;
        ink.remove();
        wet.remove();
      };
      // Route every brush call into the accumulation buffer.
      brush.load(ink);
      // Canvas-INDEPENDENT, so a slider value means the same stroke width here
      // as on the comparison sheet. See BRUSH_SCALE for why this must not be
      // derived from the canvas size.
      brush.scaleBrushes(BRUSH_SCALE);
      brush.noField();
      reset();
      lastFrameAt = p.millis();
    };

    p.draw = () => {
      if (!alive) return;
      const now = p.millis();
      const deltaMs = Math.min(100, now - lastFrameAt);
      lastFrameAt = now;

      const settings = settingsRef.current;
      if (settings.maxConcurrentTrails !== laidOutFor) reset();

      const drawStart = performance.now();
      clockMs += deltaMs * settings.speed;

      let active = 0;
      let finished = 0;
      const cursorHeads: CursorHead[] = [];
      const wetSegments: WetSegment[] = [];

      for (const trail of replay) {
        if (clockMs < trail.startMs) continue;
        const local = clockMs - trail.startMs;
        const done = trail.drawnUpTo >= trail.points.length - 1;
        if (done) {
          finished++;
          continue;
        }
        active++;

        // Where the cursor is RIGHT NOW: the head index plus the fraction of
        // the way to the next point, so the head advances continuously with the
        // clock instead of jumping point to point (production computeTrailFrame
        // does the same).
        let head = Math.floor(trail.drawnUpTo);
        while (head < trail.points.length - 1 && trail.points[head + 1].ts <= local) {
          head++;
        }
        let headPos = trail.points[head];
        let exact = head;
        if (head < trail.points.length - 1) {
          const a = trail.points[head];
          const b = trail.points[head + 1];
          const span = Math.max(1, b.ts - a.ts);
          const f = Math.max(0, Math.min(1, (local - a.ts) / span));
          exact = head + f;
          headPos = {
            x: a.x + (b.x - a.x) * f,
            y: a.y + (b.y - a.y) * f,
            ts: local,
            srcTs: a.srcTs,
          };
        }

        // The cursor rides the interpolated head every frame, whether or not
        // ink was committed this frame.
        cursorHeads.push({
          x: headPos.x,
          y: headPos.y,
          color: trail.color,
          cursor: trail.points[head].cursor,
        });

        const atEnd = exact >= trail.points.length - 1;

        // The dry target trails the head by the wet window: everything older
        // than that is committed to the buffer, everything newer stays on the
        // overlay. At the very end the whole remainder dries, so the finished
        // stroke is complete and the wet segment disappears with the cursor.
        let dryTarget = exact;
        if (settings.wetHead && !atEnd) {
          dryTarget = Math.max(
            trail.drawnUpTo,
            indexAtTime(trail.points, local - WET_WINDOW_MS),
          );
          // The still-wet stretch, repainted into the wet buffer below.
          if (dryTarget < exact) {
            wetSegments.push({
              points: pointsBetween(trail.points, dryTarget, exact),
              color: trail.color,
            });
          }
        }

        // Ink only advances once enough path has accumulated: p5.brush stamps
        // its tip along a plot at a fixed spacing, and feeding it sub-spacing
        // slivers every frame quantises into blobs rather than a line. The
        // cursor above keeps moving smoothly regardless of this buffering.
        const pending = pathLengthBetween(trail.points, trail.drawnUpTo, dryTarget);
        if (pending < MIN_CHUNK_PX && !atEnd) continue;

        try {
          brush.noFill();
          brush.noHatch();
          brush.set(
            settings.trailBrush,
            trail.color,
            effectiveWeight(settings.trailBrush, settings.strokeWeight),
          );

          // One continuous plot from the last drawn position to the current
          // interpolated head, so chunk boundaries do not read as seams.
          const chunk = pointsBetween(trail.points, trail.drawnUpTo, dryTarget);
          if (chunk.length >= 2) {
            const first = chunk[0];
            brush.beginStroke("curve", toCanvasX(first.x), toCanvasY(first.y));
            for (let i = 1; i < chunk.length; i++) {
              const a = chunk[i - 1];
              const b = chunk[i];
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const length = Math.hypot(dx, dy);
              if (length < 0.01) continue;
              // p5.brush measures angles anticlockwise from +x, while canvas y
              // grows downward, so the y delta is negated.
              const angle = Math.atan2(-dy, dx);
              const pressure = pressureFor(settings.pressureMode, a, b);
              if (i === chunk.length - 1) {
                brush.move(angle, length, pressure);
                brush.endStroke(angle, pressure);
              } else {
                brush.move(angle, length, pressure);
              }
              pointsDrawn++;
            }
          }
        } catch (err) {
          reportError(`brush "${settings.trailBrush}" failed`, err);
        }

        trail.drawnUpTo = dryTarget;

        // Any click whose moment has passed lands now.
        while (
          trail.clicksDropped < trail.clicks.length &&
          trail.clicks[trail.clicksDropped].ts <= local
        ) {
          // A mark style that trips on the library's state must not take the
          // whole replay down with it — report once and keep the ink flowing.
          try {
            drawClick(trail.clicks[trail.clicksDropped], trail.color, settings.strokeWeight);
          } catch (err) {
            reportError("click mark failed", err);
          }
          trail.clicksDropped++;
        }
      }

      const drawMs = performance.now() - drawStart;

      // Cursors ride above the ink; a finished trail contributes none, so its
      // cursor simply stops being reported and the layer drops it.
      onCursors?.(cursorHeads);

      // Repaint the wet buffer only when a head actually moved. Pastel's
      // scatter is random, so an unconditional repaint would make the wet
      // stroke shimmer; reseeding to a fixed value before each pass makes the
      // same window paint identically every time, and skipping unchanged
      // frames keeps the cost off the budget entirely.
      const wetStart = performance.now();
      // Quantising the head to whole pixels means a repaint happens only when
      // the visible end of a stroke really moves, not on every sub-pixel step.
      const signature = wetSegments
        .map((s) => {
          const head = s.points[s.points.length - 1];
          return `${Math.round(head.x)},${Math.round(head.y)}`;
        })
        .join("|");
      if (settings.wetHead && signature !== wetSignature) {
        wetSignature = signature;
        wet.clear();
        brush.load(wet);
        for (let i = 0; i < wetSegments.length; i++) {
          const segment = wetSegments[i];
          // A per-segment seed keeps each stroke's grain stable across frames
          // while still differing between strokes.
          brush.seed(`wet:${i}`);
          try {
            brush.noFill();
            brush.noHatch();
            brush.set(
              settings.trailBrush,
              segment.color,
              effectiveWeight(settings.trailBrush, settings.strokeWeight),
            );
            const first = segment.points[0];
            brush.beginStroke("curve", toCanvasX(first.x), toCanvasY(first.y));
            for (let j = 1; j < segment.points.length; j++) {
              const a = segment.points[j - 1];
              const b = segment.points[j];
              const length = Math.hypot(b.x - a.x, b.y - a.y);
              if (length < 0.01) continue;
              const angle = Math.atan2(-(b.y - a.y), b.x - a.x);
              // Slightly heavier than the dry pass, so fresh ink reads denser.
              const pressure =
                pressureFor(settings.pressureMode, a, b) * WET_PRESSURE_GAIN;
              if (j === segment.points.length - 1) {
                brush.move(angle, length, pressure);
                brush.endStroke(angle, pressure);
              } else {
                brush.move(angle, length, pressure);
              }
            }
          } catch (err) {
            reportError(`wet head "${settings.trailBrush}" failed`, err);
          }
        }
        brush.load(ink);

      }
      const wetMs = performance.now() - wetStart;

      // Present the accumulated ink. The main canvas is the only thing p5
      // clears; the buffer keeps every mark ever drawn. The background is
      // painted first so a buffer smaller than the canvas (after the window
      // grows) leaves linen rather than an empty rectangle.
      p.background(BACKGROUND);
      p.image(ink, -p.width / 2, -p.height / 2);
      // Wet ink sits above the dry mark; in-flight ripples and cursors are DOM
      // layers stacked above this canvas, so the order is dry → wet → ripples
      // → cursors.
      if (settings.wetHead) p.image(wet, -p.width / 2, -p.height / 2);

      smoothedWetMs = smoothedWetMs * STAT_SMOOTHING + wetMs * (1 - STAT_SMOOTHING);
      smoothedFps = smoothedFps * STAT_SMOOTHING + (1000 / Math.max(1, deltaMs)) * (1 - STAT_SMOOTHING);
      smoothedDrawMs = smoothedDrawMs * STAT_SMOOTHING + drawMs * (1 - STAT_SMOOTHING);

      onStats({
        fps: smoothedFps,
        drawMs: smoothedDrawMs,
        pointsDrawn,
        activeTrails: active,
        finishedTrails: finished,
        totalTrails: replay.length,
        appliedWeight: effectiveWeight(
          settings.trailBrush,
          settings.strokeWeight,
        ),
        strokeWidthPx: strokeWidthPx(
          settings.trailBrush,
          settings.strokeWeight,
        ),
        wetMs: smoothedWetMs,
      });

      // Once every trail has inked out, hold the finished image rather than
      // looping — the whole point is that the marks stay.
      if (totalMs > 0 && clockMs > totalMs + 1000 && active === 0) {
        p.noLoop();
      }
    };

    bakeRippleFn = (x, y, color) => {
      // A ripple can settle before setup has run, or after teardown; either way
      // there is no buffer to stamp it into.
      if (!alive || !ink) return;
      const sprite = renderSettledSprite(x, y, color);
      if (!sprite) return;

      // p5's WEBGL renderer cannot texture a bare HTMLCanvasElement, so the
      // sprite is copied into a p5.Image first. Drawing it into the buffer puts
      // the rings over the ink already there and leaves them to be covered by
      // whatever is drawn next — which is what makes clicks layer in time order.
      const image = p.createImage(sprite.canvas.width, sprite.canvas.height);
      // p5.Image keeps a 2D canvas internally but does not expose it on the
      // type; drawing into it is the cheapest way to get a sprite in.
      // No updatePixels() here: that re-uploads the `pixels` array, which this
      // path never populated, and throws.
      (
        image as unknown as { drawingContext: CanvasRenderingContext2D }
      ).drawingContext.drawImage(sprite.canvas, 0, 0);
      // Center-origin, like every other draw into this WEBGL buffer.
      ink.image(
        image,
        sprite.left - p.width / 2,
        sprite.top - p.height / 2,
      );
    };

    restartFn = () => {
      reset();
      p.loop();
    };
    saveFn = () => p.save(ink, "cursor-ink.png");
  };

  const instance = new p5(sketch, container);

  return {
    // p5's remove() tears down the main canvas but leaves any createGraphics
    // buffer alive, and its draw loop keeps a reference to it. Without the
    // explicit dispose a restarted sketch leaves the previous buffer inking in
    // the background, so every stroke gets laid down more than once.
    remove: () => {
      disposeInk();
      instance.remove();
    },
    restart: () => restartFn(),
    savePng: () => saveFn(),
    bakeRipple: (x, y, color) => bakeRippleFn(x, y, color),
  };
}
