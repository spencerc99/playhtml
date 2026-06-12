// ABOUTME: p5 instance-mode sketch — renders browsing journeys as comets flowing
// ABOUTME: through a turbulent field along submarine-cable corridors. Three styles:
// ABOUTME: channels (legible), currents (organic), ink (diffuse), switchable at runtime.

import type { Journey } from "./data";
import { GeoPoint, hashString, makeProjection, Projection } from "./geo";
import { CABLES } from "./cables";

// ── Tunables ──────────────────────────────────────────────────────────────────
const BG = 8;
const SIGNAL: [number, number, number] = [255, 173, 74];
const TARGET_LOOP_MS = 72_000;
const DUR_MIN = 480;
const DUR_MAX = 2_600;
const TAIL_FADE_FRAC = 0.16;
const CABLE_DECAY = 0.94;
const CABLE_BUMP = 0.05;
const RESAMPLE_STEP = 14;

export type StyleName = "channels" | "currents" | "ink";

interface Style {
  fieldAmp: number; // how far the flow field bends a path
  fieldScale: number; // spatial frequency of the field
  fiber: number; // strands per cable
  fiberSpread: number; // px between strands
  seedJitter: number; // per-journey decorrelation of the field
  ink: boolean; // diffuse-blob comets vs filament comets
  buffer: boolean; // accrete comet trails in an offscreen layer
  bufFade: number; // per-frame trail fade (lower = longer memory)
  tailMul: number;
  headMul: number;
  cableBase: number;
}

const STYLES: Record<StyleName, Style> = {
  channels: { fieldAmp: 9, fieldScale: 0.005, fiber: 2, fiberSpread: 2.4, seedJitter: 14, ink: false, buffer: false, bufFade: 0, tailMul: 1, headMul: 1, cableBase: 16 },
  currents: { fieldAmp: 32, fieldScale: 0.0026, fiber: 4, fiberSpread: 5.5, seedJitter: 42, ink: false, buffer: true, bufFade: 0.1, tailMul: 1.4, headMul: 1.15, cableBase: 13 },
  ink: { fieldAmp: 44, fieldScale: 0.0019, fiber: 5, fiberSpread: 9, seedJitter: 70, ink: true, buffer: true, bufFade: 0.06, tailMul: 2.1, headMul: 1.4, cableBase: 9 },
};

export interface SketchState {
  journeys: Journey[];
  paused: boolean;
  speed: number;
  style?: StyleName;
  onClock?: (dataTs: number, active: number, total: number) => void;
}

interface Pt {
  x: number;
  y: number;
}
interface ScreenPath {
  pts: Pt[];
  cum: number[];
  total: number;
}
interface PreparedJourney {
  path: ScreenPath;
  durMs: number;
  cableName: string | null;
  tint: [number, number, number];
  mass: number;
}
interface CableScreen {
  name: string;
  pts: Pt[];
  normals: Pt[];
  mid: Pt;
}
interface Traveler {
  j: number;
  birth: number;
}
interface Buffer {
  ctx: CanvasRenderingContext2D;
  canvas: CanvasImageSource;
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeInOut = (t: number): number => 0.5 * (1 - Math.cos(Math.PI * clamp01(t)));
const hashFrac = (n: number): number => (Math.sin(n * 12.9898) * 43758.5453) % 1;

// ── value-noise flow field ────────────────────────────────────────────────────
function lhash(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = lhash(ix, iy);
  const b = lhash(ix + 1, iy);
  const c = lhash(ix, iy + 1);
  const d = lhash(ix + 1, iy + 1);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

// ── geometry helpers ──────────────────────────────────────────────────────────
function unwrapAndProject(waypoints: GeoPoint[], proj: Projection): Pt[] {
  const out: Pt[] = [];
  let prevLon = waypoints[0].lon;
  let acc = prevLon;
  for (let i = 0; i < waypoints.length; i++) {
    const lon = waypoints[i].lon;
    if (i > 0) {
      let dlon = lon - prevLon;
      while (dlon > 180) dlon -= 360;
      while (dlon < -180) dlon += 360;
      acc += dlon;
    }
    prevLon = lon;
    out.push({ x: proj.lonToX(acc), y: proj.latToY(waypoints[i].lat) });
  }
  return out;
}

function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }));
  const out: Pt[] = [{ ...pts[0] }];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].x;
    const ay = pts[i - 1].y;
    const segLen = Math.hypot(pts[i].x - ax, pts[i].y - ay);
    if (segLen === 0) continue;
    const dx = (pts[i].x - ax) / segLen;
    const dy = (pts[i].y - ay) / segLen;
    let dpos = step - acc;
    while (dpos < segLen) {
      out.push({ x: ax + dx * dpos, y: ay + dy * dpos });
      dpos += step;
    }
    acc = segLen - (dpos - step);
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

// Push interior points along the flow field; pin the endpoints so routes connect.
function perturb(pts: Pt[], amp: number, scale: number, seedOff: number): Pt[] {
  const n = pts.length;
  if (n < 3 || amp === 0) return pts;
  for (let i = 1; i < n - 1; i++) {
    const u = i / (n - 1);
    const env = Math.sin(Math.PI * u);
    const ang = vnoise(pts[i].x * scale + seedOff, pts[i].y * scale + seedOff * 0.7) * Math.PI * 4;
    pts[i].x += Math.cos(ang) * amp * env;
    pts[i].y += Math.sin(ang) * amp * env;
  }
  return pts;
}

function normalsOf(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    out.push({ x: -ty / len, y: tx / len });
  }
  return out;
}

function buildScreenPath(pts: Pt[]): ScreenPath {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    cum.push(total);
  }
  return { pts, cum, total };
}

function sampleAt(path: ScreenPath, dist: number): Pt {
  const d = Math.max(0, Math.min(path.total, dist));
  const { pts, cum } = path;
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] >= d) {
      const seg = cum[i] - cum[i - 1] || 1;
      const f = (d - cum[i - 1]) / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
    }
  }
  return pts[pts.length - 1];
}

function parseTint(color: string): [number, number, number] {
  const m = color.match(/hsl\(\s*([\d.]+)/i);
  if (m) return hslToRgb((parseFloat(m[1]) % 360) / 360, 0.6, 0.7);
  return [235, 240, 250];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

// Offscreen layer for trail accretion — DOM canvas in the browser, injected
// factory (__makeCanvas) under the headless renderer.
function makeBuffer(w: number, h: number): Buffer | null {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    return ctx ? { ctx, canvas: c } : null;
  }
  const f = (globalThis as { __makeCanvas?: (w: number, h: number) => { getContext: (t: string) => CanvasRenderingContext2D } }).__makeCanvas;
  if (!f) return null;
  const c = f(w, h);
  return { ctx: c.getContext("2d"), canvas: c as unknown as CanvasImageSource };
}

export function startSketch(container: HTMLElement, state: SketchState): void {
  new p5((p: P5Instance) => {
    let proj: Projection;
    let prepared: PreparedJourney[] = [];
    let originGlyphs: Pt[] = [];
    let cableScreens: CableScreen[] = [];
    let buffer: Buffer | null = null;
    let builtStyle: StyleName | null = null;
    const cableActivity = new Map<string, number>();

    let minTs = 0;
    let maxTs = 1;
    let latMin = 0;
    let latMax = 1;
    let dataTs = 0;
    let ptr = 0;
    let travelers: Traveler[] = [];

    const styleOf = (): Style => STYLES[state.style ?? "currents"] ?? STYLES.currents;

    function computeBounds(): void {
      minTs = Infinity;
      maxTs = -Infinity;
      latMin = Infinity;
      latMax = -Infinity;
      for (const j of state.journeys) {
        minTs = Math.min(minTs, j.ts);
        maxTs = Math.max(maxTs, j.ts);
        latMin = Math.min(latMin, j.latencyMs);
        latMax = Math.max(latMax, j.latencyMs);
      }
      if (!isFinite(minTs)) {
        minTs = 0;
        maxTs = 1;
      }
      if (latMax - latMin < 1) latMax = latMin + 1;
      dataTs = minTs;
    }

    function durationFor(latencyMs: number): number {
      const norm = (latencyMs - latMin) / (latMax - latMin);
      return DUR_MIN + (DUR_MAX - DUR_MIN) * Math.sqrt(clamp01(norm));
    }

    function rebuild(): void {
      const st = styleOf();
      proj = makeProjection(p.width, p.height);

      prepared = state.journeys.map((j) => {
        const seed = hashString(`${j.pid}|${j.domain}|${j.ts}`);
        const seedOff = hashFrac(seed) * st.seedJitter;
        const raw = resample(unwrapAndProject(j.waypoints, proj), RESAMPLE_STEP);
        const path = buildScreenPath(perturb(raw, st.fieldAmp, st.fieldScale, seedOff));
        return {
          path,
          durMs: durationFor(j.latencyMs),
          cableName: j.cableName,
          tint: parseTint(j.color),
          mass: 0.35 + 0.65 * Math.abs(hashFrac(seed * 1.7)),
        };
      });

      const seen = new Set<string>();
      originGlyphs = [];
      for (const j of state.journeys) {
        if (seen.has(j.originKey)) continue;
        seen.add(j.originKey);
        originGlyphs.push({ x: proj.lonToX(j.origin.lon), y: proj.latToY(j.origin.lat) });
      }

      cableScreens = CABLES.map((c, ci) => {
        const pts = perturb(resample(unwrapAndProject(c.points, proj), RESAMPLE_STEP), st.fieldAmp * 0.5, st.fieldScale, ci * 31);
        return { name: c.name, pts, normals: normalsOf(pts), mid: pts[Math.floor(pts.length / 2)] };
      });

      buffer = st.buffer ? makeBuffer(p.width, p.height) : null;
      builtStyle = state.style ?? "currents";
    }

    // ── layers ──────────────────────────────────────────────────────────────
    function drawGrid(): void {
      p.push();
      p.stroke(255, 255, 255, 7);
      p.strokeWeight(1);
      for (let lon = -150; lon <= 150; lon += 30) {
        const x = proj.lonToX(lon);
        p.line(x, proj.latToY(82), x, proj.latToY(-58));
      }
      for (let lat = -55; lat <= 78; lat += 30) {
        const y = proj.latToY(lat);
        p.line(proj.lonToX(-180), y, proj.lonToX(180), y);
      }
      p.pop();
    }

    function drawCables(st: Style): void {
      const fw = proj.fullWidth;
      const ctx = p.drawingContext;
      p.noFill();
      for (const c of cableScreens) {
        const act = clamp01(cableActivity.get(c.name) ?? 0);
        const r = 70 + (SIGNAL[0] - 70) * act;
        const g = 74 + (SIGNAL[1] - 74) * act;
        const b = 82 + (SIGNAL[2] - 82) * act;
        const center = (st.fiber - 1) / 2;
        ctx.shadowBlur = act * 16;
        ctx.shadowColor = `rgba(${SIGNAL[0]},${SIGNAL[1]},${SIGNAL[2]},${act})`;
        for (let s = 0; s < st.fiber; s++) {
          const off = (s - center) * st.fiberSpread;
          const dim = 1 - 0.16 * Math.abs(s - center);
          p.stroke(r, g, b, (st.cableBase + act * 150) * dim);
          p.strokeWeight(0.7 + act * 1.2);
          for (const wrap of [-fw, 0, fw]) {
            p.beginShape();
            for (let i = 0; i < c.pts.length; i++) {
              p.vertex(c.pts[i].x + c.normals[i].x * off + wrap, c.pts[i].y + c.normals[i].y * off);
            }
            p.endShape();
          }
        }
        ctx.shadowBlur = 0;

        if (act > 0.28) {
          p.push();
          p.noStroke();
          p.fill(SIGNAL[0], SIGNAL[1], SIGNAL[2], act * 200);
          p.textSize(10);
          p.textAlign(p.CENTER);
          let mx = c.mid.x;
          while (mx < 0) mx += fw;
          while (mx > p.width) mx -= fw;
          p.text(c.name.toUpperCase(), mx, c.mid.y - 9);
          p.pop();
        }
        cableActivity.set(c.name, (cableActivity.get(c.name) ?? 0) * CABLE_DECAY);
      }
    }

    function drawOrigins(): void {
      const pulse = 0.6 + 0.4 * Math.sin(p.frameCount * 0.04);
      p.push();
      p.noStroke();
      for (const o of originGlyphs) {
        p.fill(200, 210, 230, 26 * pulse);
        p.circle(o.x, o.y, 9);
        p.fill(220, 230, 245, 150);
        p.circle(o.x, o.y, 2.4);
      }
      p.pop();
    }

    function drawTraveler(ctx: CanvasRenderingContext2D, t: Traveler, now: number, st: Style): boolean {
      const pj = prepared[t.j];
      const age = now - t.birth;
      const life = pj.durMs * 2;
      if (age >= life) return false;

      const dur = pj.durMs;
      let s: number;
      let dir: number;
      if (age < dur) {
        s = easeInOut(age / dur) * pj.path.total;
        dir = 1;
      } else {
        s = (1 - easeInOut((age - dur) / dur)) * pj.path.total;
        dir = -1;
      }
      const lifeFrac = age / life;
      const fade = Math.min(1, lifeFrac / 0.08) * Math.min(1, (1 - lifeFrac) / TAIL_FADE_FRAC);

      const head = sampleAt(pj.path, s);
      const fw = proj.fullWidth;
      const off = -fw * Math.round((head.x - p.width / 2) / fw);
      const [tr, tg, tb] = pj.tint;
      const mass = pj.mass;
      const baseR = dir > 0 ? 255 : 198;
      const baseG = dir > 0 ? 247 : 218;
      const baseB = dir > 0 ? 236 : 252;
      const hr = (baseR * 0.78 + tr * 0.22) | 0;
      const hg = (baseG * 0.78 + tg * 0.22) | 0;
      const hb = (baseB * 0.78 + tb * 0.22) | 0;

      if (st.ink) {
        const tailLen = Math.max(80, Math.min(300, pj.path.total * 0.2)) * st.tailMul;
        const K = 18;
        for (let k = 0; k < K; k++) {
          const pt = sampleAt(pj.path, s - dir * tailLen * (k / K));
          const a = (1 - k / K) ** 1.5 * 0.05 * fade * (0.5 + mass);
          const rad = (3 + (1 - k / K) * 13) * (0.6 + mass) * st.headMul;
          ctx.beginPath();
          ctx.fillStyle = `rgba(${hr},${hg},${hb},${a})`;
          ctx.shadowBlur = rad;
          ctx.shadowColor = `rgba(${hr},${hg},${hb},${a})`;
          ctx.arc(pt.x + off, pt.y, rad, 0, 6.283);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      } else {
        const tailLen = Math.max(60, Math.min(220, pj.path.total * 0.16)) * st.tailMul;
        const K = 16;
        ctx.lineCap = "round";
        for (let k = 0; k < K; k++) {
          const a0 = sampleAt(pj.path, s - dir * tailLen * (k / K));
          const b0 = sampleAt(pj.path, s - dir * tailLen * ((k + 1) / K));
          ctx.strokeStyle = `rgba(${hr},${hg},${hb},${((1 - k / K) ** 1.6 * 220 * fade) / 255})`;
          ctx.lineWidth = ((1 - k / K) * 2.2 + 0.3) * (0.7 + mass * 0.8) * st.headMul;
          ctx.beginPath();
          ctx.moveTo(a0.x + off, a0.y);
          ctx.lineTo(b0.x + off, b0.y);
          ctx.stroke();
        }
        ctx.shadowBlur = 10 * fade;
        ctx.shadowColor = `rgba(${hr},${hg},${hb},${fade})`;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${hr},${hg},${hb},${0.94 * fade})`;
        ctx.arc(head.x + off, head.y, 3.1 * (0.7 + mass * 0.8) * st.headMul, 0, 6.283);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      if (pj.cableName) {
        cableActivity.set(pj.cableName, (cableActivity.get(pj.cableName) ?? 0) + CABLE_BUMP * fade);
      }
      return true;
    }

    // ── lifecycle ────────────────────────────────────────────────────────────
    p.setup = () => {
      p.createCanvas(container.clientWidth, container.clientHeight);
      p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
      computeBounds();
      rebuild();
    };

    p.windowResized = () => {
      p.resizeCanvas(container.clientWidth, container.clientHeight);
      rebuild();
    };

    p.draw = () => {
      const st = styleOf();
      if (builtStyle !== (state.style ?? "currents")) rebuild();

      const rate = (maxTs - minTs) / TARGET_LOOP_MS;
      if (!state.paused) {
        dataTs += p.deltaTime * state.speed * rate;
        if (dataTs > maxTs) {
          dataTs = minTs;
          ptr = 0;
          travelers = [];
        }
        while (ptr < state.journeys.length && state.journeys[ptr].ts <= dataTs) {
          travelers.push({ j: ptr, birth: p.millis() });
          ptr++;
        }
      }

      p.background(BG);
      drawGrid();
      drawCables(st);
      drawOrigins();

      let target = p.drawingContext;
      if (st.buffer && buffer) {
        buffer.ctx.globalCompositeOperation = "destination-out";
        buffer.ctx.fillStyle = `rgba(0,0,0,${st.bufFade})`;
        buffer.ctx.fillRect(0, 0, p.width, p.height);
        // normal layering (not additive) so dense corridors can't sum to pure white
        buffer.ctx.globalCompositeOperation = "source-over";
        target = buffer.ctx;
      }

      const now = p.millis();
      travelers = travelers.filter((t) => drawTraveler(target, t, now, st));

      if (st.buffer && buffer) p.drawingContext.drawImage(buffer.canvas, 0, 0);

      state.onClock?.(dataTs, travelers.length, state.journeys.length);
    };
  }, container);
}
