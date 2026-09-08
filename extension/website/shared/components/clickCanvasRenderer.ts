// ABOUTME: Draws click rings with bounded bitmap caching for settled marks.
// ABOUTME: Preserves ripple geometry, ordered blending, and interpolated residue fades.
import { getRippleGeometry, type RippleSettings } from "./ClickRipple";
import {
  getClickResidueOpacity,
  type VisibleClickEffect,
} from "./clickResidue";

import { ClickMarkCache, type CachedClickMark } from "./clickMarkCache";

const FADE_DURATION_MS = 200;
const FRAME_INTERVAL_MS = 1000 / 30;
// Less than a quarter of an 8-bit alpha step avoids repainting imperceptible fades.
const RESIDUE_OPACITY_STEP = 1 / 1024;
const RESIDUE_TILE_SIZE = 128;

type Geometry = ReturnType<typeof getRippleGeometry>;
interface Mark {
  effect: VisibleClickEffect;
  geometry: Geometry;
  bounds: { left: number; top: number; width: number; height: number };
  completed: boolean;
  opacityFrom: number;
  opacityTarget: number;
  opacityChangedAt: number;
  sprite?: CachedClickMark;
}

function opacityAt(mark: Mark, now: number) {
  const progress = Math.min(
    1,
    Math.max(0, (now - mark.opacityChangedAt) / FADE_DURATION_MS),
  );
  return mark.opacityFrom + (mark.opacityTarget - mark.opacityFrom) * progress;
}

function boundsFor(
  effect: VisibleClickEffect,
  geometry: Geometry,
  settings: RippleSettings,
  pixelRatio: number,
) {
  let outerRadius = 0;
  for (const ring of geometry.rings)
    outerRadius = Math.max(outerRadius, ring.ringTargetRadius);
  const margin = outerRadius + settings.clickStrokeWidth / 2 + 1;
  const left = Math.floor((effect.x - margin) * pixelRatio);
  const top = Math.floor((effect.y - margin) * pixelRatio);
  return {
    left,
    top,
    width: Math.ceil((effect.x + margin) * pixelRatio) - left,
    height: Math.ceil((effect.y + margin) * pixelRatio) - top,
  };
}

export class ClickCanvasRenderer {
  private context: CanvasRenderingContext2D;
  private scratch = document.createElement("canvas");
  private scratchContext: CanvasRenderingContext2D;
  private residue = document.createElement("canvas");
  private residueContext: CanvasRenderingContext2D;
  private residueTiles = new Map<
    number,
    Array<{ mark: Mark; opacity: number }>
  >();
  private residueDirty = true;
  private marks = new Map<string, Mark>();
  private active = new Set<Mark>();
  private settings: RippleSettings | undefined;
  private cache = new ClickMarkCache();
  private pixelRatio = 1;
  private dirty = true;
  private lastDraw = -Infinity;

  constructor(
    private canvas: HTMLCanvasElement,
    private onComplete: (id: string) => void,
  ) {
    const context = canvas.getContext("2d");
    const scratchContext = this.scratch.getContext("2d");
    const residueContext = this.residue.getContext("2d");
    if (!context || !scratchContext || !residueContext)
      throw new Error("Click visualization requires Canvas 2D");
    this.context = context;
    this.scratchContext = scratchContext;
    this.residueContext = residueContext;
  }

  private discardSprite(mark: Mark) {
    if (!mark.sprite) return;
    this.cache.release(mark.sprite);
    mark.sprite = undefined;
  }

  resize(width: number, height: number, pixelRatio: number) {
    const w = Math.max(1, Math.round(width * pixelRatio));
    const h = Math.max(1, Math.round(height * pixelRatio));
    if (
      this.canvas.width === w &&
      this.canvas.height === h &&
      this.pixelRatio === pixelRatio
    )
      return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.residue.width = w;
    this.residue.height = h;
    this.residueDirty = true;
    if (this.pixelRatio !== pixelRatio) {
      this.pixelRatio = pixelRatio;
      this.cache.clear();
      for (const mark of this.marks.values()) {
        mark.sprite = undefined;
        mark.bounds = boundsFor(
          mark.effect,
          mark.geometry,
          this.settings!,
          pixelRatio,
        );
      }
    }
    this.dirty = true;
    this.lastDraw = -Infinity;
  }

  update(effects: VisibleClickEffect[], settings: RippleSettings, now: number) {
    const settingsChanged = this.settings !== settings;
    if (settingsChanged) {
      this.residueDirty = true;
      this.cache.clear();
      for (const mark of this.marks.values()) mark.sprite = undefined;
    }
    this.settings = settings;
    const retained = new Map<string, Mark>();
    effects.forEach((effect, index) => {
      let mark = this.marks.get(effect.id);
      const target = getClickResidueOpacity(
        index,
        effects.length,
        effect.completed,
      );
      if (!mark) {
        const geometry = getRippleGeometry(effect, settings);
        mark = {
          effect,
          geometry,
          bounds: boundsFor(effect, geometry, settings, this.pixelRatio),
          completed: effect.completed,
          opacityFrom: target,
          opacityTarget: target,
          opacityChangedAt: now,
        };
      } else {
        if (
          settingsChanged ||
          effect.x !== mark.effect.x ||
          effect.y !== mark.effect.y ||
          effect.color !== mark.effect.color ||
          effect.radiusFactor !== mark.effect.radiusFactor ||
          effect.durationFactor !== mark.effect.durationFactor ||
          effect.holdDuration !== mark.effect.holdDuration ||
          effect.startTime !== mark.effect.startTime
        ) {
          this.residueDirty = true;
          this.discardSprite(mark);
          mark.geometry = getRippleGeometry(effect, settings);
          mark.bounds = boundsFor(
            effect,
            mark.geometry,
            settings,
            this.pixelRatio,
          );
        }
        if (mark.opacityTarget !== target) {
          mark.opacityFrom = opacityAt(mark, now);
          mark.opacityTarget = target;
          mark.opacityChangedAt = now;
        }
        mark.effect = effect;
      }
      retained.set(effect.id, mark);
      if (!mark.completed || now < mark.geometry.lifecycle.completedAt)
        this.active.add(mark);
    });
    for (const [id, mark] of this.marks) {
      if (retained.has(id)) continue;
      this.discardSprite(mark);
      this.active.delete(mark);
      // Evicted active marks cannot notify playback through a later frame.
      if (!mark.completed) this.onComplete(id);
    }
    this.marks = retained;
    this.dirty = true;
  }

  get needsFrame() {
    return this.dirty || this.active.size > 0;
  }

  tick(now: number, visible: boolean) {
    for (const mark of this.active) {
      if (now < mark.geometry.lifecycle.completedAt) continue;
      this.active.delete(mark);
      if (!mark.completed) {
        mark.completed = true;
        this.onComplete(mark.effect.id);
      }
      this.dirty = true;
    }
    if (!visible || now - this.lastDraw < FRAME_INTERVAL_MS) return;
    if (!this.dirty && this.active.size === 0) return;
    const elapsed = now - this.lastDraw;
    this.lastDraw = Number.isFinite(elapsed)
      ? now - (elapsed % FRAME_INTERVAL_MS)
      : now;
    this.draw(now);
  }

  private draw(now: number) {
    if (!this.settings) return;
    let prefixLength = 0;
    const columns = Math.ceil(this.canvas.width / RESIDUE_TILE_SIZE);
    const rows = Math.ceil(this.canvas.height / RESIDUE_TILE_SIZE);
    const tiles = new Map<number, Mark[]>();
    for (const mark of this.marks.values()) {
      const opacity = opacityAt(mark, now);
      if (
        !mark.completed ||
        now < mark.geometry.lifecycle.completedAt ||
        opacity === 1
      )
        break;
      prefixLength++;
      const bounds = mark.bounds;
      const firstColumn = Math.max(
        0,
        Math.floor(bounds.left / RESIDUE_TILE_SIZE),
      );
      const lastColumn = Math.min(
        columns - 1,
        Math.floor((bounds.left + bounds.width - 1) / RESIDUE_TILE_SIZE),
      );
      const firstRow = Math.max(0, Math.floor(bounds.top / RESIDUE_TILE_SIZE));
      const lastRow = Math.min(
        rows - 1,
        Math.floor((bounds.top + bounds.height - 1) / RESIDUE_TILE_SIZE),
      );
      for (let y = firstRow; y <= lastRow; y++)
        for (let x = firstColumn; x <= lastColumn; x++) {
          const key = y * columns + x;
          let marks = tiles.get(key);
          if (!marks) {
            marks = [];
            tiles.set(key, marks);
          }
          marks.push(mark);
        }
    }
    for (const key of this.residueTiles.keys()) {
      if (tiles.has(key)) continue;
      this.residueContext.clearRect(
        (key % columns) * RESIDUE_TILE_SIZE,
        Math.floor(key / columns) * RESIDUE_TILE_SIZE,
        RESIDUE_TILE_SIZE,
        RESIDUE_TILE_SIZE,
      );
      this.residueTiles.delete(key);
    }
    for (const [key, marks] of tiles) {
      const cached = this.residueTiles.get(key);
      const changed =
        this.residueDirty ||
        cached?.length !== marks.length ||
        marks.some(
          (mark, index) =>
            cached[index].mark !== mark ||
            Math.abs(cached[index].opacity - opacityAt(mark, now)) >
              RESIDUE_OPACITY_STEP,
        );
      if (!changed) continue;
      const x = (key % columns) * RESIDUE_TILE_SIZE;
      const y = Math.floor(key / columns) * RESIDUE_TILE_SIZE;
      const ctx = this.residueContext;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, RESIDUE_TILE_SIZE, RESIDUE_TILE_SIZE);
      ctx.clip();
      ctx.clearRect(x, y, RESIDUE_TILE_SIZE, RESIDUE_TILE_SIZE);
      const entries: Array<{ mark: Mark; opacity: number }> = [];
      for (const mark of marks) {
        const opacity = opacityAt(mark, now);
        this.drawMark(ctx, mark, now, opacity);
        entries.push({ mark, opacity });
      }
      ctx.restore();
      this.residueTiles.set(key, entries);
    }
    this.residueDirty = false;
    const ctx = this.context;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (prefixLength > 0) ctx.drawImage(this.residue, 0, 0);
    this.dirty = false;
    let index = 0;
    for (const mark of this.marks.values()) {
      const opacity = opacityAt(mark, now);
      if (opacity !== mark.opacityTarget) this.dirty = true;
      if (index++ >= prefixLength) this.drawMark(ctx, mark, now, opacity);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private drawMark(
    ctx: CanvasRenderingContext2D,
    mark: Mark,
    now: number,
    opacity: number,
  ) {
    if (this.settings!.clickStrokeWidth <= 0) return;
    const { left, top, width, height } = mark.bounds;
    const right = left + width;
    const bottom = top + height;
    if (
      right <= 0 ||
      bottom <= 0 ||
      left >= this.canvas.width ||
      top >= this.canvas.height
    )
      return;
    const sprite =
      mark.sprite ?? this.paintMark(mark, now, left, top, width, height);
    ctx.globalAlpha = opacity;
    // SVG group opacity isolates faded rings; fully opaque groups multiply
    // their rings against the preceding marks instead.
    ctx.globalCompositeOperation = opacity === 1 ? "multiply" : "source-over";
    ctx.drawImage(
      sprite.canvas,
      sprite.x,
      sprite.y,
      width,
      height,
      left,
      top,
      width,
      height,
    );
  }

  private paintMark(
    mark: Mark,
    now: number,
    left: number,
    top: number,
    width: number,
    height: number,
  ) {
    const settings = this.settings!;
    if (this.scratch.width < width) this.scratch.width = width;
    if (this.scratch.height < height) this.scratch.height = height;
    const ctx = this.scratchContext;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.scratch.width, this.scratch.height);
    ctx.setTransform(
      this.pixelRatio,
      0,
      0,
      this.pixelRatio,
      mark.effect.x * this.pixelRatio - left,
      mark.effect.y * this.pixelRatio - top,
    );
    ctx.globalAlpha = Math.max(0, Math.min(1, settings.clickOpacity));
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
      ctx.arc(0, 0, radius, 0, 2 * Math.PI);
      ctx.stroke();
    }
    if (now >= mark.geometry.lifecycle.completedAt) {
      mark.sprite = this.cache.store(this.scratch, width, height);
      if (mark.sprite) return mark.sprite;
    }
    return { canvas: this.scratch, x: 0, y: 0 };
  }

  destroy() {
    for (const mark of this.marks.values()) this.discardSprite(mark);
    this.cache.clear();
    this.marks.clear();
    this.active.clear();
    this.scratch.width = this.scratch.height = 0;
    this.residue.width = this.residue.height = 0;
    this.residueTiles.clear();
  }
}
