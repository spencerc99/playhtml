// ABOUTME: Paints production-style click ripples onto a 2D canvas layered over the brush ink.
// ABOUTME: Drives the real @movement ripple geometry so the marks match what the site already draws.

import { ClickEffect } from "../shared/types";
import { CLICK_DEFAULTS } from "../shared/components/clickDefaults";
import {
  getRippleGeometry,
  RippleSettings,
} from "../shared/components/ClickRipple";

/** The production ripple settings, used unchanged so the look matches. */
export const RIPPLE_SETTINGS: RippleSettings = { ...CLICK_DEFAULTS };

/** A click waiting to be drawn, or already settling into residue. */
export interface RippleMark {
  effect: ClickEffect;
  geometry: ReturnType<typeof getRippleGeometry>;
}

/**
 * Build the effect record the production geometry expects. `radiusFactor` and
 * `durationFactor` are the per-click variation the real renderer takes from the
 * event; they are derived from the position here so a given click always looks
 * the same, which keeps the comparison sheet deterministic.
 */
export function makeRippleMark(
  id: string,
  x: number,
  y: number,
  color: string,
  startTime: number,
  settings: RippleSettings = RIPPLE_SETTINGS,
): RippleMark {
  const jitter = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
  const effect: ClickEffect = {
    id,
    x,
    y,
    color,
    radiusFactor: jitter % 1,
    durationFactor: (jitter * 1.7) % 1,
    startTime,
    trailIndex: 0,
  };
  return { effect, geometry: getRippleGeometry(effect, settings) };
}

/**
 * Draw one mark at time `now`, exactly as `clickCanvasRenderer` does: rings
 * expanding on a cubic ease-out to their own frozen target radius, multiplied
 * into whatever is underneath so overlapping marks deepen instead of flattening.
 */
export function paintRipple(
  ctx: CanvasRenderingContext2D,
  mark: RippleMark,
  now: number,
  settings: RippleSettings = RIPPLE_SETTINGS,
  opacityScale = 1,
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(
    0,
    Math.min(1, settings.clickOpacity * opacityScale),
  );
  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = mark.effect.color;
  ctx.lineWidth = settings.clickStrokeWidth;

  for (const ring of mark.geometry.rings) {
    const elapsed = now - ring.ringStartTime;
    if (elapsed <= 0) continue;
    const progress = Math.min(1, elapsed / ring.ringDuration);
    const radius = ring.ringTargetRadius * (1 - Math.pow(1 - progress, 3));
    if (radius <= 0) continue;
    ctx.beginPath();
    ctx.arc(mark.effect.x, mark.effect.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/** True once every ring has finished expanding and the mark is pure residue. */
export function isRippleSettled(mark: RippleMark, now: number): boolean {
  return now >= mark.geometry.lifecycle.completedAt;
}

/** The moment a mark is fully settled, useful for drawing a static sheet. */
export function settledAt(mark: RippleMark): number {
  return mark.geometry.lifecycle.completedAt;
}

/**
 * Render one settled ripple to its own small transparent canvas, so it can be
 * blitted into the ink buffer and sit in time order under later strokes.
 * Returns the sprite and where its top-left corner belongs.
 */
export function renderSettledSprite(
  x: number,
  y: number,
  color: string,
  settings: RippleSettings = RIPPLE_SETTINGS,
): { canvas: HTMLCanvasElement; left: number; top: number } | null {
  const probe = makeRippleMark("sprite", x, y, color, 0, settings);
  const radius = Math.max(
    ...probe.geometry.rings.map((r) => r.ringTargetRadius),
  );
  const pad = settings.clickStrokeWidth + 2;
  const size = Math.ceil((radius + pad) * 2);
  if (!Number.isFinite(size) || size <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Re-make the mark centred in the sprite, so its rings land inside the box.
  const centred = makeRippleMark("sprite", size / 2, size / 2, color, 0, settings);
  // Sprites composite onto a transparent canvas, where "multiply" would erase
  // everything; the blit into the ink buffer carries the darkening instead.
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = Math.max(0, Math.min(1, settings.clickOpacity));
  ctx.strokeStyle = color;
  ctx.lineWidth = settings.clickStrokeWidth;
  for (const ring of centred.geometry.rings) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, ring.ringTargetRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  return { canvas, left: x - size / 2, top: y - size / 2 };
}

export interface RippleLayer {
  /** Start a new ripple at viewport coordinates. */
  add: (x: number, y: number, color: string) => void;
  /** Wipe every mark, settled and in-flight. */
  clear: () => void;
  /** Match the canvas to a new viewport size. Settled ink is not rescaled. */
  resize: () => void;
  /** How many marks are still expanding. */
  activeCount: () => number;
  stop: () => void;
}

/**
 * An accumulating ripple layer over the brush canvas: marks animate while they
 * expand, then bake into a residue canvas that is never cleared, so the cost
 * per frame stays proportional to the ripples still moving rather than to
 * everything ever drawn — the same accumulation model as the ink beneath it.
 */
export function createRippleLayer(
  canvas: HTMLCanvasElement,
  /**
   * Called once a ripple has finished expanding. The caller bakes the settled
   * residue into the ink buffer, which is what puts the mark in time order:
   * a stroke drawn later then covers it, the way it would on paper. Only the
   * in-flight expansion stays on this overlay.
   */
  onSettled?: (x: number, y: number, color: string) => void,
): RippleLayer {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Ripple overlay requires Canvas 2D");

  // Holds settled marks only while the caller has no sink for them.
  const residue = document.createElement("canvas");
  const residueCtx = residue.getContext("2d");
  if (!residueCtx) throw new Error("Ripple overlay requires Canvas 2D");

  let live: RippleMark[] = [];
  let nextId = 0;
  let raf = 0;
  let ratio = 1;

  const sync = () => {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const h = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    residue.width = w;
    residue.height = h;
    // Draw in CSS pixels; the backing store carries the device ratio.
    residueCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  sync();

  /** Was anything drawn last frame that has to be cleaned up this frame? */
  let dirty = false;

  const frame = () => {
    const now = performance.now();

    // Bake anything that finished expanding, then keep only what still moves.
    const stillLive: RippleMark[] = [];
    let settledAny = false;
    for (const mark of live) {
      if (isRippleSettled(mark, now)) {
        if (onSettled) {
          // Handed to the ink buffer, so later strokes draw over it.
          onSettled(mark.effect.x, mark.effect.y, mark.effect.color);
        } else {
          paintRipple(residueCtx, mark, settledAt(mark));
        }
        settledAny = true;
      } else {
        stillLive.push(mark);
      }
    }
    live = stillLive;

    // Nothing is moving and nothing just baked: the visible canvas already
    // shows the right image, so the whole composite is skipped. Without this
    // the layer repaints a full-viewport residue canvas every frame and costs
    // more than the ink it sits over.
    if (live.length === 0 && !settledAny && !dirty) {
      raf = requestAnimationFrame(frame);
      return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(residue, 0, 0);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    for (const mark of live) paintRipple(ctx, mark, now);
    dirty = live.length > 0;

    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    add: (x, y, color) => {
      live.push(makeRippleMark(String(nextId++), x, y, color, performance.now()));
    },
    clear: () => {
      live = [];
      residueCtx.setTransform(1, 0, 0, 1, 0, 0);
      residueCtx.clearRect(0, 0, residue.width, residue.height);
      residueCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    resize: sync,
    activeCount: () => live.length,
    stop: () => cancelAnimationFrame(raf),
  };
}
