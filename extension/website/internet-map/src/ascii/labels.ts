// ABOUTME: Draw hierarchical place labels with shared screen-space collision checks.
// ABOUTME: Aggregate host neighbourhoods for subordinate labels beside domain names.
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
  visits: ArrayLike<number>;
  scale?: number;
  name: (i: number) => string;
}

/** One label per prominent host, regardless of path and chunk splitting. */
export function prominentHosts(
  subs: LabelSource,
  names: string[],
  domains: string[],
  subDom: Uint32Array,
  subPages: Uint32Array,
  domainVisits: Uint32Array,
): LabelSource {
  const hosts = new Map<
    string,
    {
      name: string;
      dom: number;
      lead: number;
      visits: number;
      pages: number;
      members: number[];
    }
  >();
  for (let i = 0; i < names.length; i++) {
    const name = names[i].replace(/ \[\d+\]$/, "").split("/")[0];
    const dom = subDom[i];
    if (shortName(name) === shortName(domains[dom])) continue;
    const key = `${dom}:${name}`;
    let host = hosts.get(key);
    if (!host) {
      host = { name, dom, lead: i, visits: 0, pages: 0, members: [] };
      hosts.set(key, host);
    }
    host.visits += subs.visits[i];
    host.pages += subPages[i];
    host.members.push(i);
    if (subs.visits[i] > subs.visits[host.lead]) host.lead = i;
  }
  // A host needs both occupied ground and a meaningful share of its domain.
  const prominent = [...hosts.values()].filter(
    (h) => h.pages >= 8 && h.visits >= domainVisits[h.dom] * 0.02,
  );
  const x = Float32Array.from(prominent, (h) => subs.x[h.lead]);
  const y = Float32Array.from(prominent, (h) => subs.y[h.lead]);
  const r = Float32Array.from(prominent, (h) => {
    let radius = 0;
    for (const i of h.members)
      radius = Math.max(
        radius,
        Math.hypot(subs.x[i] - subs.x[h.lead], subs.y[i] - subs.y[h.lead]) +
          subs.r[i],
      );
    return radius;
  });
  return {
    x,
    y,
    r,
    visits: Float64Array.from(prominent, (h) => h.visits),
    name: (i) => prominent[i].name,
    scale: 0.72,
  };
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Trim a hostname to something that fits on a map. */
export function shortName(s: string): string {
  if (!s) return "";
  return s.replace(/^www\./, "").replace(/\/$/, "");
}

export class LabelLayer {
  /** screen px; a name needs at least this much of its own place to sit on */
  minFootprint = 26;

  draw(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    sources: LabelSource[],
    colour: string,
    halo: string,
    cellPx: number,
    scale = 1,
  ) {
    const zt = Math.max(0, Math.min(1, (cellPx - 0.45) / 4.5));
    const cap = Math.round(9 + 58 * zt);
    // Parent labels reserve their space before subordinate labels are tried.
    const placed: Box[] = [];
    let drawn = 0;
    let maxVisits = 1;
    for (const src of sources) {
      const size = scale * (src.scale ?? 1);
      const maxPx = (13 + 18 * zt) * size;
      const minPx = 10 * size;
      const { x, y, r, visits } = src;
      const cand: number[] = [];
      const pad = 80;
      for (let i = 0; i < x.length; i++) {
        const sx = cam.toScreenX(x[i]);
        if (sx < -pad || sx > cam.W + pad) continue;
        const sy = cam.toScreenY(y[i]);
        if (sy < -pad || sy > cam.H + pad) continue;
        cand.push(i);
      }
      // Biggest first: traffic decides priority and size, not territory.
      cand.sort((a, b) => visits[b] - visits[a]);
      let mv = maxVisits;
      for (const i of cand) if (visits[i] > mv) mv = visits[i];
      // Share the traffic scale so a host stays smaller than its parent.
      maxVisits = mv;
      const lgv = Math.log1p(mv) || 1;
      let tierDrawn = 0;
      for (const i of cand) {
        if (tierDrawn >= cap) break;
        const foot = Math.max(r[i] * cam.k * 2, 0);
        if (foot < this.minFootprint) continue;
        const name = shortName(src.name(i));
        if (!name) continue;
        const px =
          minPx + (maxPx - minPx) * Math.pow(Math.log1p(visits[i]) / lgv, 1.6);
        ctx.font = `${px}px MEKText, monospace`;
        const w = ctx.measureText(name).width;
        const sx = cam.toScreenX(x[i]) - w / 2;
        const anchorY = cam.toScreenY(y[i]) - px * 0.5;
        // Try immediately above or below a host when its centred name collides.
        const offsetPx = (13 + 18 * zt) * scale + 6;
        const offsets = (src.scale ?? 1) < 1 ? [0, offsetPx, -offsetPx] : [0];
        let sy = anchorY;
        let box: Box | undefined;
        for (const offset of offsets) {
          sy = anchorY + offset;
          const candidate = {
            x0: sx - 3,
            y0: sy - 2,
            x1: sx + w + 3,
            y1: sy + px + 2,
          };
          if (
            placed.some(
              (p) =>
                candidate.x0 < p.x1 &&
                candidate.x1 > p.x0 &&
                candidate.y0 < p.y1 &&
                candidate.y1 > p.y0,
            )
          )
            continue;
          box = candidate;
          break;
        }
        if (!box) continue;
        placed.push(box);
        drawn++;
        tierDrawn++;
        // A halo keeps names legible over the built ground.
        ctx.textBaseline = "top";
        ctx.lineWidth = Math.max(2, px * 0.22);
        ctx.strokeStyle = halo;
        ctx.lineJoin = "round";
        ctx.strokeText(name, sx, sy);
        ctx.fillStyle = colour;
        ctx.fillText(name, sx, sy);
      }
    }
    return drawn;
  }
}
