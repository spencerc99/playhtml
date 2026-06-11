// ABOUTME: p5 instance-mode sketch — renders the swarm of browsing journeys as
// ABOUTME: comets routed along submarine cables, near-monochrome with one signal colour.

import type { Journey } from "./data";
import { GeoPoint, makeProjection, Projection } from "./geo";
import { CABLES } from "./cables";

// ── Tunables ──────────────────────────────────────────────────────────────────
const BG = 8; // near-black field
const SIGNAL: [number, number, number] = [255, 173, 74]; // the one accent — active cable
const TARGET_LOOP_MS = 72_000; // wall-time to sweep the whole dataset at speed 1
const DUR_MIN = 480; // one-way screen duration for the nearest journey
const DUR_MAX = 2_600; // one-way screen duration for the farthest journey
const TAIL_FADE_FRAC = 0.16; // fraction of life over which the comet fades out
const CABLE_DECAY = 0.94;
const CABLE_BUMP = 0.05;

export interface SketchState {
  journeys: Journey[];
  paused: boolean;
  speed: number;
  onClock?: (dataTs: number, active: number, total: number) => void;
}

interface ScreenPath {
  pts: { x: number; y: number }[];
  cum: number[];
  total: number;
}

interface PreparedJourney {
  path: ScreenPath;
  origin: { x: number; y: number };
  durMs: number;
  cableName: string | null;
  tint: [number, number, number];
}

interface Traveler {
  j: number; // index into prepared
  birth: number;
}

const easeInOut = (t: number): number => 0.5 * (1 - Math.cos(Math.PI * clamp01(t)));
function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// Unwrap a sequence of longitudes so consecutive steps take the short way around
// the globe (handles the antimeridian for trans-Pacific cables).
function unwrapAndProject(
  waypoints: GeoPoint[],
  proj: Projection,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let prevLon = waypoints[0].lon;
  let acc = prevLon;
  for (let i = 0; i < waypoints.length; i++) {
    const lon = waypoints[i].lon;
    if (i > 0) {
      let d = lon - prevLon;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      acc += d;
    }
    prevLon = lon;
    out.push({ x: proj.lonToX(acc), y: proj.latToY(waypoints[i].lat) });
  }
  return out;
}

function buildScreenPath(pts: { x: number; y: number }[]): ScreenPath {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    cum.push(total);
  }
  return { pts, cum, total };
}

function sampleAt(path: ScreenPath, dist: number): { x: number; y: number } {
  const d = Math.max(0, Math.min(path.total, dist));
  const { pts, cum } = path;
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] >= d) {
      const seg = cum[i] - cum[i - 1] || 1;
      const f = (d - cum[i - 1]) / seg;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f,
      };
    }
  }
  return pts[pts.length - 1];
}

function parseTint(color: string): [number, number, number] {
  // Pull an HSL hue if present; otherwise default to a neutral cool white.
  const m = color.match(/hsl\(\s*([\d.]+)/i);
  if (m) {
    const h = (parseFloat(m[1]) % 360) / 360;
    return hslToRgb(h, 0.6, 0.7);
  }
  return [235, 240, 250];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

export function startSketch(container: HTMLElement, state: SketchState): void {
  new p5((p: P5Instance) => {
    let proj: Projection;
    let prepared: PreparedJourney[] = [];
    let originGlyphs: { x: number; y: number }[] = [];
    let cableScreens: { name: string; pts: { x: number; y: number }[]; mid: { x: number; y: number } }[] = [];
    const cableActivity = new Map<string, number>();

    let minTs = 0;
    let maxTs = 1;
    let latMin = 0;
    let latMax = 1;

    let dataTs = 0;
    let ptr = 0;
    let travelers: Traveler[] = [];

    function computeBounds() {
      const js = state.journeys;
      minTs = Infinity;
      maxTs = -Infinity;
      latMin = Infinity;
      latMax = -Infinity;
      for (const j of js) {
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
      // Compressed-but-proportional: √ curve keeps far journeys visibly longer
      // while packing the swarm into a watchable tempo.
      const norm = (latencyMs - latMin) / (latMax - latMin);
      return DUR_MIN + (DUR_MAX - DUR_MIN) * Math.sqrt(clamp01(norm));
    }

    function rebuild() {
      proj = makeProjection(p.width, p.height);

      prepared = state.journeys.map((j) => ({
        path: buildScreenPath(unwrapAndProject(j.waypoints, proj)),
        origin: { x: proj.lonToX(j.origin.lon), y: proj.latToY(j.origin.lat) },
        durMs: durationFor(j.latencyMs),
        cableName: j.cableName,
        tint: parseTint(j.color),
      }));

      const seen = new Set<string>();
      originGlyphs = [];
      for (const j of state.journeys) {
        if (seen.has(j.originKey)) continue;
        seen.add(j.originKey);
        originGlyphs.push({ x: proj.lonToX(j.origin.lon), y: proj.latToY(j.origin.lat) });
      }

      cableScreens = CABLES.map((c) => {
        const pts = unwrapAndProject(c.points, proj);
        const mid = pts[Math.floor(pts.length / 2)];
        return { name: c.name, pts, mid };
      });
    }

    // ── draw layers ──────────────────────────────────────────────────────────
    function drawGrid() {
      p.push();
      p.stroke(255, 255, 255, 7);
      p.strokeWeight(1);
      for (let lon = -150; lon <= 150; lon += 30) {
        const x = proj.lonToX(lon);
        p.line(x, proj.latToY(85), x, proj.latToY(-60));
      }
      for (let lat = -60; lat <= 80; lat += 30) {
        const y = proj.latToY(lat);
        p.line(proj.lonToX(-180), y, proj.lonToX(180), y);
      }
      p.pop();
    }

    function drawPolyline(pts: { x: number; y: number }[], dx: number) {
      p.beginShape();
      for (const pt of pts) p.vertex(pt.x + dx, pt.y);
      p.endShape();
    }

    function drawCables() {
      const fw = proj.fullWidth;
      const ctx = p.drawingContext;
      for (const c of cableScreens) {
        const a = cableActivity.get(c.name) ?? 0;
        const act = clamp01(a);
        p.noFill();
        // base faint corridor + signal glow proportional to coincident traffic
        const baseAlpha = 16 + act * 150;
        const r = 70 + (SIGNAL[0] - 70) * act;
        const g = 74 + (SIGNAL[1] - 74) * act;
        const b = 82 + (SIGNAL[2] - 82) * act;
        ctx.shadowBlur = act * 16;
        ctx.shadowColor = `rgba(${SIGNAL[0]},${SIGNAL[1]},${SIGNAL[2]},${act})`;
        p.stroke(r, g, b, baseAlpha);
        p.strokeWeight(0.8 + act * 1.4);
        for (const off of [-fw, 0, fw]) drawPolyline(c.pts, off);
        ctx.shadowBlur = 0;

        if (act > 0.28) {
          p.push();
          p.noStroke();
          p.fill(SIGNAL[0], SIGNAL[1], SIGNAL[2], act * 200);
          p.textSize(10);
          p.textAlign(p.CENTER);
          // place the on-screen wrap copy of the label
          let mx = c.mid.x;
          while (mx < 0) mx += fw;
          while (mx > p.width) mx -= fw;
          p.text(c.name.toUpperCase(), mx, c.mid.y - 8);
          p.pop();
        }

        cableActivity.set(c.name, a * CABLE_DECAY);
      }
    }

    function drawOrigins() {
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

    function drawTraveler(t: Traveler, now: number) {
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

      // fade in at birth, out at death
      const lifeFrac = age / life;
      const fade =
        Math.min(1, lifeFrac / 0.08) * Math.min(1, (1 - lifeFrac) / TAIL_FADE_FRAC);

      const head = sampleAt(pj.path, s);
      const fw = proj.fullWidth;
      const off = -fw * Math.round((head.x - p.width / 2) / fw);

      const tailLen = Math.max(60, Math.min(220, pj.path.total * 0.16));
      const K = 16;
      const ctx = p.drawingContext;

      // direction-aware comet: warm on the way out, cool on the return
      const [tr, tg, tb] = pj.tint;
      const baseR = dir > 0 ? 255 : 200;
      const baseG = dir > 0 ? 248 : 220;
      const baseB = dir > 0 ? 238 : 252;
      const headR = baseR * 0.86 + tr * 0.14;
      const headG = baseG * 0.86 + tg * 0.14;
      const headB = baseB * 0.86 + tb * 0.14;

      p.push();
      p.noFill();
      ctx.lineCap = "round";
      for (let k = 0; k < K; k++) {
        const d0 = s - dir * tailLen * (k / K);
        const d1 = s - dir * tailLen * ((k + 1) / K);
        const a = sampleAt(pj.path, d0);
        const b = sampleAt(pj.path, d1);
        const segAlpha = (1 - k / K) ** 1.6 * 220 * fade;
        p.strokeWeight((1 - k / K) * 2.2 + 0.3);
        p.stroke(headR, headG, headB, segAlpha);
        p.line(a.x + off, a.y, b.x + off, b.y);
      }
      // glowing head
      ctx.shadowBlur = 10 * fade;
      ctx.shadowColor = `rgba(${headR | 0},${headG | 0},${headB | 0},${fade})`;
      p.noStroke();
      p.fill(headR, headG, headB, 240 * fade);
      p.circle(head.x + off, head.y, 3.1);
      ctx.shadowBlur = 0;
      p.pop();

      // light up the cable this journey rides while in flight
      if (pj.cableName) {
        cableActivity.set(
          pj.cableName,
          (cableActivity.get(pj.cableName) ?? 0) + CABLE_BUMP * fade,
        );
      }
      return true;
    }

    // ── lifecycle ──────────────────────────────────────────────────────────────
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
      p.background(BG);
      drawGrid();

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

      drawCables();
      drawOrigins();

      const now = p.millis();
      travelers = travelers.filter((t) => drawTraveler(t, now));

      state.onClock?.(dataTs, travelers.length, state.journeys.length);
    };
  }, container);
}
