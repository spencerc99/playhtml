/**
 * Where a road runs. Shared by the bake and the route overlay so a drawn
 * route cannot drift off the road it claims to be on.
 *
 * Coordinates are CELLS — the bow amplitude and noise frequency are tuned in
 * cells and mean nothing in world units.
 */

/** Value noise on a coarse lattice, smoothstepped. Deterministic. */
export function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sxk = fx * fx * (3 - 2 * fx), syk = fy * fy * (3 - 2 * fy);
  const at = (a: number, b: number) => {
    let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  };
  const n00 = at(xi, yi), n10 = at(xi + 1, yi);
  const n01 = at(xi, yi + 1), n11 = at(xi + 1, yi + 1);
  return (n00 * (1 - sxk) + n10 * sxk) * (1 - syk) +
         (n01 * (1 - sxk) + n11 * sxk) * syk;
}

/** How much roads bend. Frequency is in 1/cells, so lower = broader sweeps. */
export const BOW_FREQ = 0.010;
export const BOW_FRAC = 0.17;
export const BOW_MAX = 30;
/** A settlement needs this many pages to have been laid out in blocks. */
export const GRIDDED = 42;

/**
 * A road as a cell-space polyline. In town it turns along the street grid so
 * it lies in the gaps between blocks; in open country it bows, taking its
 * direction from a smooth field so neighbouring roads lean the same way.
 */
export function roadPath(
  ax: number, ay: number, bx: number, by: number,
  gridAngle: number | null,
): number[] {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [ax, ay, bx, by];

  if (gridAngle !== null) {
    const ct = Math.cos(gridAngle), st = Math.sin(gridAngle);
    const du = dx * ct + dy * st;
    const dv = -dx * st + dy * ct;
    // corner placed off-centre so the network does not read as one staircase
    const t = 0.35 + 0.3 * (vnoise(ax * 0.04, ay * 0.04) * 0.5 + 0.5);
    const kx = ax + du * t * ct, ky = ay + du * t * st;
    const jx = kx + dv * -st, jy = ky + dv * ct;
    return [ax, ay, kx, ky, jx, jy, bx, by];
  }

  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const amp = vnoise(mx * BOW_FREQ, my * BOW_FREQ);
  const bow = amp * Math.min(len * BOW_FRAC, BOW_MAX);
  const cx = mx + (-dy / len) * bow, cy = my + (dx / len) * bow;

  const steps = Math.max(2, Math.ceil(len / 2));
  const out: number[] = [ax, ay];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push(u * u * ax + 2 * u * t * cx + t * t * bx,
             u * u * ay + 2 * u * t * cy + t * t * by);
  }
  return out;
}

/** Cells a polyline passes through, as flat col,row pairs. Bresenham per leg. */
export function pathCells(pts: number[]): number[] {
  const out: number[] = [];
  const push = (x: number, y: number) => {
    const n = out.length;
    if (n && out[n - 2] === x && out[n - 1] === y) return;
    out.push(x, y);
  };
  for (let i = 2; i < pts.length; i += 2) {
    let cx = Math.floor(pts[i - 2]), cy = Math.floor(pts[i - 1]);
    const tx = Math.floor(pts[i]), ty = Math.floor(pts[i + 1]);
    const dx = Math.abs(tx - cx), sxs = cx < tx ? 1 : -1;
    const dy = -Math.abs(ty - cy), sys = cy < ty ? 1 : -1;
    let err = dx + dy, guard = 0;
    for (;;) {
      push(cx, cy);
      if ((cx === tx && cy === ty) || ++guard > 8000) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; cx += sxs; }
      if (e2 <= dx) { err += dx; cy += sys; }
    }
  }
  return out;
}
