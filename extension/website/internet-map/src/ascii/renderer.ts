/**
 * Blits a window of the baked map. Nothing here is recomputed per frame.
 *
 * Fast enough to drag because rows are emitted as runs of identical glyph
 * (O(cells), not one pass per colour), and because the map is constant enough
 * to paint once into an offscreen canvas for zoomed-out views.
 */
import { Camera } from "../camera";
import { BakedMap, ROAD_LEVELS } from "./bake";
import { ROAD, roadHV, BUILD_ALPHA } from "./glyphs";
import { LANDMARKS, LM_TREE, LM_WTREE } from "./tileset";
import { PALETTE } from "./glyphs";
import { Theme, DARK } from "../theme";

export interface DrawOpts {
  showRoads: boolean;
}

/**
 * How much live text is affordable, in visible cells — px-per-cell is the
 * wrong measure because cost depends on the viewport too. Lower while
 * dragging, where a frame must land inside the pointer's cadence.
 */
const LIVE_CELLS_STILL = 520e3;
const LIVE_CELLS_DRAG = 240e3;
/** Bounds the offscreen canvas whatever the grid size; 3px/cell is 434MB at 4096. */
const CACHE_BUDGET_PX = 64e6;
const CACHE_PX_MAX = 3;

export class AsciiRenderer {
  cellPx = 12;
  usedCache = false;
  /** work counters, for the benchmark */
  ops = { cells: 0, fills: 0 };

  private cache: HTMLCanvasElement | null = null;
  private cacheOpts = "";
  /** px per cell in the cache, chosen to fit the budget */
  private cachePx = CACHE_PX_MAX;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private map: BakedMap,
    public theme: Theme = DARK,
  ) {}

  /**
   * Swap the theme. The offscreen cache is a picture of the map in the old
   * colours, so it has to go — but the baked grid does not, because a tint is
   * a slot index and the slot layout never changes.
   */
  setTheme(t: Theme) {
    this.theme = t;
    this.cache = null;
    this.cacheOpts = "";
  }

  private fontFor(cellPxW: number) {
    return cellPxW / 0.8;   // both faces advance 0.8em
  }

  /**
   * Paint a rectangle of the grid, one row at a time, as runs.
   *
   * `ox`/`oy` are where cell (c0, r0) lands, `cw`/`ch` the cell size in px.
   */
  private paintGrid(
    ctx: CanvasRenderingContext2D, opts: DrawOpts,
    c0: number, c1: number, r0: number, r1: number,
    ox: number, oy: number, cw: number, ch: number,
  ) {
    const M = this.map;
    this.ops.cells += (c1 - c0 + 1) * (r1 - r0 + 1);
    const fontPx = this.fontFor(cw);
    ctx.textBaseline = "top";

    for (let r = r0; r <= r1; r++) {
      const base = r * M.cols;
      const y = oy + (r - r0) * ch;

      if (opts.showRoads) {
        ctx.font = `${fontPx}px MEKDings, monospace`;
        // When one mark serves both directions there is nothing to overdraw,
        // and drawing it twice would just darken every crossing.
        const single = ROAD.h === ROAD.v;
        const passes: Array<boolean | null> = single ? [null] : [false, true];
        for (const vertical of passes) {
          let c = c0;
          while (c <= c1) {
            const i = base + c;
            const lvl = M.roadLvl[i];
            const bits = M.roadBits[i];
            const on = lvl > 0 && !!bits &&
              (vertical === null ? true
                : vertical ? roadHV(bits)[1] : roadHV(bits)[0]);
            if (!on) { c++; continue; }
            const glyph = vertical ? ROAD.v : ROAD.h;
            let e = c + 1;
            while (e <= c1) {
              const j = base + e;
              const b2 = M.roadBits[j];
              if (M.roadLvl[j] !== lvl || !b2) break;
              if (vertical !== null &&
                  !(vertical ? roadHV(b2)[1] : roadHV(b2)[0])) break;
              e++;
            }
            // gamma on the ramp so the once-travelled majority stay faint
            ctx.globalAlpha = this.theme.roadGain * Math.pow(lvl / ROAD_LEVELS, 1.9);
            ctx.fillStyle = this.theme.road;
            ctx.fillText(glyph.repeat(e - c), ox + (c - c0) * cw, y);
            this.ops.fills++;
            c = e;
          }
        }
        ctx.globalAlpha = 1;
      }

      // trees and grass are ground cover; they belong behind the built map
      ctx.font = `${fontPx}px MEKDings, monospace`;
      ctx.fillStyle = this.theme.landmark;
      let c = c0;
      while (c <= c1) {
        const g = M.land[base + c];
        if (!g) { c++; continue; }
        // keyed on glyph AND colour, so tint costs a fill only where it changes
        const tn = M.tint[base + c];
        const sh = M.shade[base + c];
        let e = c + 1;
        while (e <= c1 && M.land[base + e] === g &&
               M.tint[base + e] === tn && M.shade[base + e] === sh) e++;
        ctx.globalAlpha = g >= LM_WTREE ? this.theme.wildGain
                        : g >= LM_TREE ? this.theme.countrysideGain
                        : this.theme.buildingGain * BUILD_ALPHA[sh];
        ctx.fillStyle = tn ? PALETTE[tn] : this.theme.landmark;
        ctx.fillText(LANDMARKS[g].repeat(e - c), ox + (c - c0) * cw, y);
        this.ops.fills++;
        c = e;
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Paint the whole constant map once into an offscreen canvas. */
  buildCache(opts: DrawOpts) {
    const M = this.map;
    const key = `${opts.showRoads}`;
    if (this.cache && this.cacheOpts === key) return;

    const aspect = M.cellH / M.cellW;
    this.cachePx = Math.min(
      CACHE_PX_MAX,
      Math.sqrt(CACHE_BUDGET_PX / Math.max(M.cols * M.rows * aspect, 1)));
    const cw = this.cachePx;
    const ch = cw * aspect;
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(M.cols * cw);
    cv.height = Math.ceil(M.rows * ch);
    const cx = cv.getContext("2d")!;
    // The cache holds ink on TRANSPARENT ground, not ink on the background.
    // draw() has already filled the viewport with the background, so the blit
    // composites over it — and the far-zoom contrast pass can then multiply
    // the ink without also darkening the empty margin into a visible slab.
    this.paintGrid(cx, opts, 0, M.cols - 1, 0, M.rows - 1, 0, 0, cw, ch);
    this.cache = cv;
    this.cacheOpts = key;
  }

  /** forceLive bypasses the cache — used only by the benchmark */
  forceLive = false;

  draw(cam: Camera, opts: DrawOpts, preferCache = false) {
    const ctx = this.ctx;
    const M = this.map;
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, cam.W, cam.H);

    const cw = M.cellW * cam.k;
    this.cellPx = cw;

    const c0 = Math.max(0, Math.floor((cam.toWorldX(0) - M.x0) / M.cellW));
    const c1 = Math.min(M.cols - 1, Math.ceil((cam.toWorldX(cam.W) - M.x0) / M.cellW));
    const r0 = Math.max(0, Math.floor((cam.toWorldY(0) - M.y0) / M.cellH));
    const r1 = Math.min(M.rows - 1, Math.ceil((cam.toWorldY(cam.H) - M.y0) / M.cellH));
    const cells = Math.max(0, c1 - c0 + 1) * Math.max(0, r1 - r0 + 1);

    // the only question is whether THIS frame is too big to lay out
    const budget = preferCache ? LIVE_CELLS_DRAG : LIVE_CELLS_STILL;
    this.usedCache = !this.forceLive && cells > budget;
    if (this.usedCache) {
      this.buildCache(opts);
      if (this.cache) {
        const scale = cw / this.cachePx;
        ctx.save();
        ctx.imageSmoothingEnabled = scale < 1;
        ctx.translate(cam.toScreenX(M.x0), cam.toScreenY(M.y0));
        ctx.scale(scale, scale);
        // Zoomed out, thousands of cells average into one pixel. On a dark
        // ground that concentrates sparse bright ink and the continent still
        // reads; on paper the same averaging pulls sparse dark ink towards the
        // paper and the map fades to nothing. `farContrast` blits the
        // downscaled ink over itself, so each pass composites more of the same
        // marks onto the ground and the ink deepens where there IS ink and
        // nowhere else. 1 disables it, which is right for a dark ground.
        ctx.drawImage(this.cache, 0, 0);
        const boost = this.theme.farContrast;
        if (boost > 1 && scale < 1) {
          const whole = Math.min(6, Math.floor(boost) - 1);
          const frac = boost - Math.floor(boost);
          for (let i = 0; i < whole; i++) ctx.drawImage(this.cache, 0, 0);
          if (frac > 0.01) {
            ctx.globalAlpha = frac;
            ctx.drawImage(this.cache, 0, 0);
            ctx.globalAlpha = 1;
          }
        }
        ctx.restore();
        return;
      }
    }

    if (c1 < c0 || r1 < r0) return;

    this.paintGrid(ctx, opts, c0, c1, r0, r1,
                   cam.toScreenX(M.x0 + c0 * M.cellW),
                   cam.toScreenY(M.y0 + r0 * M.cellH),
                   cw, M.cellH * cam.k);
  }

}
