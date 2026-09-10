/**
 * Place names, drawn over the baked map rather than into it — a name burnt
 * into a fixed-resolution grid is only legible at the zoom it was sized for.
 *
 * A place earns a label when its own footprint can hold one, which gives the
 * usual few-big-names-far-out behaviour with no per-zoom lists.
 */
import { Camera } from "../camera";

export interface LabelSource {
  x: Float32Array;
  y: Float32Array;
  r: Float32Array;
  visits: Uint32Array;
  name: (i: number) => string;
}

interface Box { x0: number; y0: number; x1: number; y1: number }

/** Trim a hostname to something that fits on a map. */
export function shortName(s: string): string {
  if (!s) return "";
  return s.replace(/^www\./, "").replace(/\/$/, "");
}

export class LabelLayer {
  /** screen px; a name needs at least this much of its own place to sit on */
  minFootprint = 26;

  draw(
    ctx: CanvasRenderingContext2D, cam: Camera, src: LabelSource,
    colour: string, halo: string, cellPx: number, scale = 1,
  ) {
    // count and size both scale with zoom, as on any map
    const zt = Math.max(0, Math.min(1, (cellPx - 0.45) / 4.5));
    const cap = Math.round(9 + 58 * zt);
    const maxPx = (13 + 18 * zt) * scale;
    const minPx = 10 * scale;
    const { x, y, r, visits } = src;
    // biggest first, so when two names collide the more important one wins
    const cand: number[] = [];
    const pad = 80;
    for (let i = 0; i < x.length; i++) {
      const sx = cam.toScreenX(x[i]);
      if (sx < -pad || sx > cam.W + pad) continue;
      const sy = cam.toScreenY(y[i]);
      if (sy < -pad || sy > cam.H + pad) continue;
      cand.push(i);
    }
    cand.sort((a, b) => visits[b] - visits[a]);

    // size by traffic, not footprint: territory is not importance
    let mv = 1;
    for (const i of cand) if (visits[i] > mv) mv = visits[i];
    const lgv = Math.log1p(mv) || 1;

    const placed: Box[] = [];
    let drawn = 0;
    for (const i of cand) {
      if (drawn >= cap) break;
      const foot = Math.max(r[i] * cam.k * 2, 0);
      if (foot < this.minFootprint) continue;

      const name = shortName(src.name(i));
      if (!name) continue;
      const px = minPx + (maxPx - minPx) * Math.pow(Math.log1p(visits[i]) / lgv, 1.6);
      ctx.font = `${px}px MEKText, monospace`;
      const w = ctx.measureText(name).width;
      const sx = cam.toScreenX(x[i]) - w / 2;
      const sy = cam.toScreenY(y[i]) - px * 0.5;
      const box = { x0: sx - 3, y0: sy - 2, x1: sx + w + 3, y1: sy + px + 2 };

      let hit = false;
      for (const p of placed) {
        if (box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0) {
          hit = true; break;
        }
      }
      if (hit) continue;
      placed.push(box);
      drawn++;

      // a halo, or the name disappears into the built ground under it
      ctx.textBaseline = "top";
      ctx.lineWidth = Math.max(2, px * 0.22);
      ctx.strokeStyle = halo;
      ctx.lineJoin = "round";
      ctx.strokeText(name, sx, sy);
      ctx.fillStyle = colour;
      ctx.fillText(name, sx, sy);
    }
    return drawn;
  }
}
