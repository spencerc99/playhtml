// ABOUTME: Spike page comparing the SVG trail renderer with p5 and raw WebGL2 renderers.
// ABOUTME: Real recent cursor data (or synthetic) through the same camera in every mode; shows fps.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  getCursorComponent,
  getCursorHotspot,
  getCursorScaleFactor,
} from "@movement/cursors";
import { getTrailRenderer } from "@movement/styles/trailRenderers";
import p5 from "p5";
import { getStrokePoints } from "perfect-freehand";
import { AnimatedTrails } from "@movement/components/AnimatedTrails";
import { DEFAULT_SETTINGS } from "@movement/components/settingsDefaults";
import {
  CinematicCamera,
  DEFAULT_CINEMATIC_CONFIG,
  type ViewBox,
} from "@movement/utils/cinematicCamera";
import type { CollectionEvent, TrailState } from "@movement/types";
import { useCursorTrails } from "@movement/hooks/useCursorTrails";
import { RECENT_EVENTS_URL } from "@movement/config";

const q = new URLSearchParams(location.search);
const N = Number(q.get("n") ?? 2000);
// real: the worker's most recent cursor events, through the archive's own
// trail pipeline. synthetic: random walks. testclick: one trail ending in one
// click, for comparing a single ripple across renderers.
const DATA = q.get("data") ?? "real";
const LIMIT = Number(q.get("limit") ?? 20000);
const PTS = Number(q.get("pts") ?? 150);
const SPEED = Number(q.get("speed") ?? 1);
const MODE = q.get("mode") ?? "svg"; // svg | gl
const WINDOW = q.get("window") === "all" ? 1e9 : Number(q.get("window") ?? 30);
const CINEMATIC = q.get("cinematic") === "1";
const INK = q.get("style") === "monochrome";
const START_FRAC = Number(q.get("start") ?? 0); // start playback partway through
const FREEZE = q.get("freeze"); // fixed elapsed fraction for screenshots
const VIEW = q.get("view"); // "x,y,w" fixed viewBox for screenshots
const W = innerWidth,
  H = innerHeight;
let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let DURATION = 60 * 60 * 1000;
const cursors = ["default", "pointer", "text"];
let states: TrailState[] = [];
function buildSynthetic(count: number) {
  const out: TrailState[] = [];
  for (let i = 0; i < count; i++) {
    const n = Math.max(4, Math.round(PTS * (0.3 + rnd() * 1.4)));
    let x = rnd() * W,
      y = rnd() * H;
    const pts = [] as TrailState["trail"]["points"];
    const t0 = rnd() * DURATION * 0.95;
    for (let k = 0; k < n; k++) {
      x = Math.min(W, Math.max(0, x + (rnd() - 0.5) * 40));
      y = Math.min(H, Math.max(0, y + (rnd() - 0.5) * 40));
      pts.push({
        x,
        y,
        ts: t0 + k * 250,
        cursor: cursors[Math.floor(k / 40) % 3],
      });
    }
    const durationMs = Math.min(20000, n * 120);
    const clicks = Array.from({ length: Math.floor(rnd() * 4) }, () => {
      const p = rnd();
      const pt = pts[Math.floor(p * (n - 1))];
      return { x: pt.x, y: pt.y, ts: pt.ts, progress: p };
    });
    out.push({
      trail: {
        points: pts,
        color: `hsl(${Math.floor(rnd() * 360)}, 70%, 55%)`,
        opacity: 1,
        id: `t${i}`,
        pid: `p${i % 200}`,
        startTime: t0,
        endTime: t0 + n * 250,
        clicks: clicks as any,
      },
      startOffsetMs: t0,
      durationMs,
      variedPoints: pts.map((p) => ({ x: p.x, y: p.y })),
      clicksWithProgress: clicks,
    });
  }
  return out;
}
let timeRange = { min: 0, max: DURATION, duration: DURATION };
const settings = {
  ...DEFAULT_SETTINGS,
  animationSpeed: SPEED,
  trailVisualStyle: INK ? "monochrome" : "color",
};

// Recent real cursor events through the same trail pipeline the archive uses
// (useCursorTrails with the portrait's default settings), run once off-screen.
async function buildReal(): Promise<{
  states: TrailState[];
  duration: number;
}> {
  const params = new URLSearchParams({ type: "cursor", limit: String(LIMIT) });
  const res = await fetch(`${RECENT_EVENTS_URL}?${params}`);
  if (!res.ok) throw new Error(`events/recent ${res.status}`);
  const events = (await res.json()) as CollectionEvent[];
  const trailSettings = {
    randomizeColors: DEFAULT_SETTINGS.randomizeColors,
    filters: DEFAULT_SETTINGS.filters,
    pidFilter: DEFAULT_SETTINGS.pidFilter,
    eventFilter: DEFAULT_SETTINGS.eventFilter,
    trailStyle: DEFAULT_SETTINGS.trailStyle,
    chaosIntensity: DEFAULT_SETTINGS.chaosIntensity,
    trailAnimationMode: DEFAULT_SETTINGS.trailAnimationMode,
    maxConcurrentTrails: DEFAULT_SETTINGS.maxConcurrentTrails,
    overlapFactor: DEFAULT_SETTINGS.overlapFactor,
    minGapBetweenTrails: DEFAULT_SETTINGS.minGapBetweenTrails,
    documentSpace: false,
  };
  let result: { states: TrailState[]; duration: number } | null = null;
  const Probe = () => {
    const r = useCursorTrails(events, { width: W, height: H }, trailSettings);
    result = { states: r.trailStates, duration: r.cycleDuration };
    return null;
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => root.render(<Probe />));
  root.unmount();
  if (!result || (result as { states: TrailState[] }).states.length === 0)
    throw new Error("no cursor trails in recent events");
  return result;
}

function buildTestClick(): TrailState[] {
  // Same ripple size in every renderer: both draw radiusFactor from Math.random.
  Math.random = () => 0.8;
  const pts = Array.from({ length: 30 }, (_, k) => ({
    x: W / 2 - 150 + k * 10,
    y: H / 2 + Math.sin(k / 4) * 40,
    ts: k * 250,
  }));
  const end = pts[pts.length - 1];
  const clicks = [{ x: end.x, y: end.y, ts: end.ts, progress: 1 }];
  return [
    {
      trail: {
        points: pts,
        color: "hsl(280, 70%, 55%)",
        opacity: 1,
        id: "t0",
        pid: "p0",
        startTime: 0,
        endTime: end.ts,
        clicks: clicks as any,
      },
      startOffsetMs: 1000,
      durationMs: 3000,
      variedPoints: pts.map((p) => ({ x: p.x, y: p.y })),
      clicksWithProgress: clicks,
    },
  ];
}

let dataNote = "";
async function loadData() {
  if (DATA === "testclick") {
    states = buildTestClick();
    DURATION = 60_000;
  } else if (DATA === "real") {
    try {
      const real = await buildReal();
      states = real.states;
      DURATION = Math.max(1, real.duration);
      dataNote = `real data (${LIMIT} events)`;
    } catch (err) {
      console.warn("[spike] real data unavailable, using synthetic:", err);
      dataNote = "real data unavailable, synthetic";
      states = buildSynthetic(N);
    }
  } else {
    states = buildSynthetic(N);
    dataNote = "synthetic";
  }
  timeRange = { min: 0, max: DURATION, duration: DURATION };
}

// One shared clock for both renderers so runs are comparable.
let wallStart = performance.now();
const elapsedMs = () =>
  FREEZE !== null
    ? Number(FREEZE) * DURATION
    : START_FRAC * DURATION + (performance.now() - wallStart) * SPEED;

const frames: number[] = [];
let last = performance.now();
const tick = (t: number) => {
  frames.push(t - last);
  last = t;
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
(window as any).__takeFrames = () => frames.splice(0);

// On-screen readout so the comparison runs on real hardware without devtools.
const hud = document.createElement("div");
hud.style.cssText =
  "position:fixed;top:8px;left:8px;z-index:10;font:12px ui-monospace,monospace;background:rgba(255,255,255,.85);padding:6px 8px;border-radius:4px";
document.body.appendChild(hud);
const link = (patch: Record<string, string>, label: string) => {
  const next = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) next.set(k, v);
  return `<a href="?${next}">${label}</a>`;
};
const hudLinks = [
  link({ mode: "svg" }, "svg"),
  link({ mode: "gl2" }, "webgl"),
  link({ mode: "gl" }, "p5"),
  link(
    { cinematic: CINEMATIC ? "0" : "1" },
    CINEMATIC ? "camera off" : "camera on",
  ),
  link(
    { window: q.get("window") === "all" ? "30" : "all", start: "0.5" },
    q.get("window") === "all" ? "window 30" : "all trails",
  ),
  link({ style: INK ? "color" : "monochrome" }, INK ? "color" : "ink"),
  link(
    { data: DATA === "real" ? "synthetic" : "real" },
    DATA === "real" ? "synthetic data" : "real data",
  ),
  link(
    { speed: SPEED === 1 ? "20" : "1" },
    SPEED === 1 ? "20× speed" : "1× speed",
  ),
].join(" · ");
let hudFrames = 0,
  hudLast = performance.now();
const hudTick = (t: number) => {
  hudFrames++;
  if (t - hudLast > 1000) {
    const w = window as any;
    hud.innerHTML =
      `${MODE} · ${states.length} trails · ${dataNote} · ${SPEED}× · ${Math.round((hudFrames * 1000) / (t - hudLast))} fps` +
      (w.__glVerts
        ? ` · ${(w.__glVerts / 1e6).toFixed(2)}M verts · built in ${Math.round(w.__glBuildMs)}ms`
        : "") +
      `<br>${hudLinks}`;
    hudFrames = 0;
    hudLast = t;
  }
  requestAnimationFrame(hudTick);
};
requestAnimationFrame(hudTick);

const cinematicConfig = CINEMATIC ? { ...DEFAULT_CINEMATIC_CONFIG } : null;

async function boot() {
  await loadData();
  wallStart = performance.now();
  if (MODE === "svg") {
    createRoot(document.getElementById("root")!).render(
      <AnimatedTrails
        trailStates={states}
        timeRange={timeRange}
        windowSize={WINDOW}
        settings={settings as any}
        cinematic={cinematicConfig}
        getInstallationElapsedMs={() => elapsedMs()}
        showClickRipples={q.get("clicks") !== "0"}
      />,
    );
    if (VIEW) {
      const [vx, vy, vw] = VIEW.split(",").map(Number);
      setTimeout(
        () =>
          document
            .querySelector("svg.trails-svg")
            ?.setAttribute("viewBox", `${vx} ${vy} ${vw} ${(vw * H) / W}`),
        500,
      );
    }
  } else if (MODE === "gl") {
    mountGl(document.getElementById("root")!);
  } else {
    mountGl2(document.getElementById("root")!);
  }
}
queueMicrotask(() => void boot());

// ---------------- WebGL spike ----------------
const VERT = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec4 aVertexColor;
in float aT;
in float aSide;
in vec4 aTrail; // start, duration, evictAt, unused
uniform vec4 uView;
uniform float uTime;
out vec4 vColor; out float vT; out float vSide; out vec2 vWorld; out float vAlpha; out float vProgress;
void main() {
  vec2 p = aPosition.xy;
  vec2 ndc = (p - uView.xy) / uView.zw * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  float start = aTrail.x, dur = aTrail.y, evict = aTrail.z;
  float prog = (uTime - start) / dur;
  float alpha = 1.0;
  if (uTime < start) alpha = 0.0;
  else if (prog >= 1.0) {
    alpha = 1.0 - min(1.0, (uTime - start - dur) / 3000.0) * 0.5;
    if (uTime > evict) alpha = max(0.0, 0.5 * (1.0 - (uTime - evict) / 3000.0));
  }
  vAlpha = alpha; vProgress = prog; vT = aT; vSide = aSide; vWorld = p; vColor = aVertexColor;
}`;
const FRAG = `#version 300 es
precision highp float;
in vec4 vColor; in float vT; in float vSide; in vec2 vWorld; in float vAlpha; in float vProgress;
uniform float uOpacity;
uniform float uInk;
out vec4 outColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.0; a *= 0.5; } return s; }
void main() {
  if (vAlpha <= 0.0 || vT > vProgress) discard;
  float edge = abs(vSide);
  float limit = 1.0;
  if (uInk > 0.5) limit = 1.0 - 0.45 * fbm(vWorld * 0.35) ;
  float aa = fwidth(vSide);
  float cov = 1.0 - smoothstep(limit - aa, limit + aa, edge);
  if (cov <= 0.0) discard;
  vec3 col = uInk > 0.5 ? vec3(0.0) : vColor.rgb;
  float a = (uInk > 0.5 ? 0.8 : 1.0) * uOpacity * vAlpha * cov;
  outColor = vec4(col * a, a);
}`;

const SUB = Number(q.get("sub") ?? 4);
const TAPER = 20;

// Catmull-Rom subdivision so the ribbon stays smooth under the camera's 4-5x zoom.
function smoothCenterline(pts: Array<{ x: number; y: number }>) {
  const out: Array<{ x: number; y: number; t: number }> = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)],
      p1 = pts[i],
      p2 = pts[i + 1],
      p3 = pts[Math.min(n - 1, i + 2)];
    for (let s = 0; s < SUB; s++) {
      const u = s / SUB,
        u2 = u * u,
        u3 = u2 * u;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b +
          (-a + c) * u +
          (2 * a - 5 * b + 4 * c - d) * u2 +
          (-a + 3 * b - 3 * c + d) * u3);
      out.push({
        x: cr(p0.x, p1.x, p2.x, p3.x),
        y: cr(p0.y, p1.y, p2.y, p3.y),
        t: (i + u) / (n - 1),
      });
    }
  }
  out.push({ x: pts[n - 1].x, y: pts[n - 1].y, t: 1 });
  return out;
}

// perfect-freehand's own centerline and width profile, so the GPU strokes
// match the SVG ones: its streamline/smoothing for the points, its taper
// easings for the ends, and (when thinning > 0) its velocity-simulated pressure.
// Mirrors the portrait's FREEHAND_OPTIONS in utils/trailAnimation.ts.
const THINNING = Number(q.get("thinning") ?? 0);
const END_TAPER = 20;
const taperStartEase = (t: number) => t * (2 - t);
const taperEndEase = (t: number) => --t * t * t + 1;
const RATE_OF_PRESSURE_CHANGE = 0.275;
const simulatePressure = (prev: number, distance: number, size: number) => {
  const sp = Math.min(1, distance / size);
  const rp = Math.min(1, 1 - sp);
  return Math.min(1, prev + (rp - prev) * (sp * RATE_OF_PRESSURE_CHANGE));
};

function freehandCenterline(
  src: Array<{ x: number; y: number }>,
  size: number,
) {
  const sp = getStrokePoints(src, {
    size,
    thinning: THINNING,
    smoothing: 0.5,
    streamline: 0.05,
    simulatePressure: THINNING > 0,
    last: true,
  });
  // Progress is index-based in the SVG renderer (head = (n-1) * progress), so
  // map each smoothed point back to a fractional input index by arc length.
  const cum = [0];
  for (let k = 1; k < src.length; k++)
    cum.push(
      cum[k - 1] + Math.hypot(src[k].x - src[k - 1].x, src[k].y - src[k - 1].y),
    );
  const inputTotal = cum[cum.length - 1] || 1;
  const total = sp[sp.length - 1]?.runningLength || 1;
  let seg = 0;
  const indexAt = (len: number) => {
    while (seg < cum.length - 2 && cum[seg + 1] < len) seg++;
    const span = cum[seg + 1] - cum[seg] || 1;
    return Math.min(1, (seg + (len - cum[seg]) / span) / (src.length - 1));
  };
  let pressure = sp
    .slice(0, 10)
    .reduce(
      (acc, p) =>
        (acc +
          (THINNING > 0
            ? simulatePressure(acc, p.distance, size)
            : p.pressure)) /
        2,
      sp[0]?.pressure ?? 0.5,
    );
  return sp.map((p) => {
    let r = size / 2;
    if (THINNING > 0) {
      pressure = simulatePressure(pressure, p.distance, size);
      r = size * (0.5 - THINNING * (0.5 - pressure));
    }
    const len = p.runningLength;
    const ts = len < END_TAPER ? taperStartEase(len / END_TAPER) : 1;
    const te =
      total - len < END_TAPER ? taperEndEase((total - len) / END_TAPER) : 1;
    r = Math.max(0.01, r * Math.min(ts, te));
    return {
      x: p.point[0],
      y: p.point[1],
      r,
      t: indexAt((len / total) * inputTotal),
    };
  });
}

// Catmull-Rom between the smoothed points so curves hold up at 4-8x zoom.
function subdivide(
  line: Array<{ x: number; y: number; r: number; t: number }>,
) {
  const out: typeof line = [];
  const n = line.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = line[Math.max(0, i - 1)],
      p1 = line[i],
      p2 = line[i + 1],
      p3 = line[Math.min(n - 1, i + 2)];
    for (let k = 0; k < SUB; k++) {
      const u = k / SUB,
        u2 = u * u,
        u3 = u2 * u;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b +
          (-a + c) * u +
          (2 * a - 5 * b + 4 * c - d) * u2 +
          (-a + 3 * b - 3 * c + d) * u3);
      out.push({
        x: cr(p0.x, p1.x, p2.x, p3.x),
        y: cr(p0.y, p1.y, p2.y, p3.y),
        r: p1.r + (p2.r - p1.r) * u,
        t: p1.t + (p2.t - p1.t) * u,
      });
    }
  }
  out.push(line[n - 1]);
  return out;
}

function evictTimes(): Float64Array {
  const order = states
    .map((s, i) => ({ i, f: s.startOffsetMs + s.durationMs }))
    .sort((a, b) => a.f - b.f);
  const out = new Float64Array(states.length).fill(1e12);
  order.forEach((e, rank) => {
    if (rank + WINDOW < order.length) out[e.i] = order[rank + WINDOW].f;
  });
  return out;
}

function mountGl(container: HTMLElement) {
  new p5((p: p5) => {
    let geo: p5.Geometry;
    let shader: p5.Shader;
    const camera = cinematicConfig
      ? new CinematicCamera(cinematicConfig)
      : null;
    const active: Array<{
      index: number;
      x: number;
      y: number;
      progress: number;
    }> = [];
    let prevLooped = 0;

    p.setup = () => {
      p.createCanvas(W, H, p.WEBGL);
      p.pixelDensity(window.devicePixelRatio);
      shader = p.createShader(VERT, FRAG);
      const evict = evictTimes();
      const t0 = performance.now();
      const half = settings.strokeWidth / 2;
      geo = p.buildGeometry(() => {
        p.noStroke();
        states.forEach((s, idx) => {
          const line = smoothCenterline(s.variedPoints);
          const lens = [0];
          for (let k = 1; k < line.length; k++)
            lens.push(
              lens[k - 1] +
                Math.hypot(
                  line[k].x - line[k - 1].x,
                  line[k].y - line[k - 1].y,
                ),
            );
          const total = lens[lens.length - 1];
          p.fill(p.color(s.trail.color));
          p.beginShape(p.TRIANGLE_STRIP);
          for (let k = 0; k < line.length; k++) {
            const a = line[Math.max(0, k - 1)],
              b = line[Math.min(line.length - 1, k + 1)];
            let dx = b.x - a.x,
              dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            dx /= len;
            dy /= len;
            const taper = Math.max(
              0.15,
              Math.min(1, lens[k] / TAPER, (total - lens[k]) / TAPER),
            );
            const w = half * taper;
            for (const side of [-1, 1]) {
              p.vertexProperty("aT", line[k].t);
              p.vertexProperty("aSide", side);
              p.vertexProperty("aTrail", [
                s.startOffsetMs,
                s.durationMs,
                evict[idx],
                0,
              ]);
              p.vertex(line[k].x - dy * w * side, line[k].y + dx * w * side, 0);
            }
          }
          p.endShape();
        });
      });
      (window as any).__glBuildMs = performance.now() - t0;
      (window as any).__glVerts = geo.vertices.length;
    };

    p.draw = () => {
      const elapsed = elapsedMs();
      const looped = elapsed % DURATION;
      if (looped < prevLooped) camera?.reset();
      prevLooped = looped;

      let view: ViewBox = { x: 0, y: 0, w: W, h: H };
      if (VIEW) {
        const [vx, vy, vw] = VIEW.split(",").map(Number);
        view = { x: vx, y: vy, w: vw, h: (vw * H) / W };
      } else if (camera) {
        // Heads for the camera come from the CPU, as the sound engine's would.
        active.length = 0;
        for (let i = 0; i < states.length; i++) {
          const s = states[i];
          const prog = (looped - s.startOffsetMs) / s.durationMs;
          if (prog <= 0 || prog >= 1) continue;
          const pts = s.variedPoints,
            exact = (pts.length - 1) * prog,
            k = Math.floor(exact),
            f = exact - k;
          const a = pts[k],
            b = pts[Math.min(k + 1, pts.length - 1)];
          active.push({
            index: i,
            x: a.x + (b.x - a.x) * f,
            y: a.y + (b.y - a.y) * f,
            progress: prog,
          });
        }
        view =
          camera.tick({
            screenW: W,
            screenH: H,
            nowMs: performance.now(),
            activeTrails: active,
          }) ?? view;
      }
      (window as any).__view = view;

      p.clear();
      p.shader(shader);
      shader.setUniform("uView", [view.x, view.y, view.w, view.h]);
      shader.setUniform("uTime", looped);
      shader.setUniform("uOpacity", settings.trailOpacity);
      shader.setUniform("uInk", INK ? 1 : 0);
      p.noStroke();
      p.model(geo);
    };
  }, container);
}

// ---------------- raw WebGL2 spike ----------------
const VERT2 = `#version 300 es
precision highp float;
in vec4 aPos; // x, y, t, unused
in vec2 aLocal; // strip: (side, 0); join disc: unit-square corner
in float aTrail;
uniform vec4 uView;
uniform float uTime;
uniform float uCount;
uniform highp sampler2D uTrails; // 2 texels per trail: (start, dur, evict, 0), (r, g, b, 0)
out vec3 vColor; out float vT; out vec2 vLocal; out vec2 vWorld; out float vAlpha; out float vProgress;
void main() {
  int id = int(aTrail);
  ivec2 base = ivec2((id * 2) % 2048, (id * 2) / 2048);
  vec4 timing = texelFetch(uTrails, base, 0);
  vec4 color = texelFetch(uTrails, base + ivec2(1, 0), 0);
  vec2 p = aPos.xy;
  vec2 ndc = (p - uView.xy) / uView.zw * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.999 - 1.998 * (timing.w + 1.0) / uCount, 1.0);
  float start = timing.x, dur = timing.y, evict = timing.z;
  float prog = (uTime - start) / dur;
  float alpha = 1.0;
  if (uTime < start) alpha = 0.0;
  else if (prog >= 1.0) {
    alpha = 1.0 - min(1.0, (uTime - start - dur) / 3000.0) * 0.5;
    if (uTime > evict) alpha = max(0.0, 0.5 * (1.0 - (uTime - evict) / 3000.0));
  }
  if (alpha <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // cull whole trail before raster
  vAlpha = alpha; vProgress = prog; vT = aPos.z; vLocal = aLocal; vWorld = p; vColor = color.rgb;
}`;
// Hard coverage: MSAA smooths edges per sample, so the per-trail depth test never
// lets a soft fringe block the same trail's interior.
const FRAG2 = FRAG.replace("in vec4 vColor;", "in vec3 vColor;")
  .replace("vColor.rgb", "vColor")
  .replace("in float vSide;", "in vec2 vLocal;")
  .replace("float edge = abs(vSide);", "float edge = length(vLocal);")
  .replace("float aa = fwidth(vSide);", "")
  .replace(
    "float cov = 1.0 - smoothstep(limit - aa, limit + aa, edge);",
    "float cov = edge < limit ? 1.0 : 0.0;",
  );

function hslToRgb(css: string): [number, number, number] {
  const m = css.match(/hsl\((\d+), (\d+)%, (\d+)%\)/)!;
  const h = +m[1] / 360,
    s = +m[2] / 100,
    l = +m[3] / 100;
  const q2 = l < 0.5 ? l * (1 + s) : l + s - l * s,
    p2 = 2 * l - q2;
  const f = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6
      ? p2 + (q2 - p2) * 6 * t
      : t < 0.5
        ? q2
        : t < 2 / 3
          ? p2 + (q2 - p2) * (2 / 3 - t) * 6
          : p2;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

// Click ripples on the GPU: one quad per click, rings drawn in the fragment
// shader with getRippleGeometry's math (rings start ringDelay apart, each
// eases out to its own target radius). Ripples live in world space, so they
// follow the cinematic camera, and they stay as long as their trail does.
const RIPPLE_VERT = `#version 300 es
precision highp float;
in vec4 aPos;    // x, y, local dx, local dy (world px from the click)
in vec4 aClick;  // click time (data ms), trail id, outer target radius, core radius
in float aVel;   // ring expansion velocity, px per real ms
uniform vec4 uView;
uniform highp sampler2D uTrails;
uniform float uTime;
out vec2 vLocal; out float vClickT; out float vOuter; out float vCore; out float vVel; out vec3 vColor; out float vVisible;
void main() {
  int id = int(aClick.y);
  ivec2 base = ivec2((id * 2) % 2048, (id * 2) / 2048);
  vec4 timing = texelFetch(uTrails, base, 0);
  vec4 color = texelFetch(uTrails, base + ivec2(1, 0), 0);
  // Same lifetime as the trail: gone once it has finished its eviction fade.
  float evict = timing.z;
  vVisible = uTime > evict + 3000.0 ? 0.0 : 1.0;
  vec2 ndc = (aPos.xy - uView.xy) / uView.zw * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vLocal = aPos.zw; vClickT = aClick.x; vOuter = aClick.z; vCore = aClick.w; vVel = aVel; vColor = color.rgb;
}`;
const RIPPLE_FRAG = `#version 300 es
precision highp float;
in vec2 vLocal; in float vClickT; in float vOuter; in float vCore; in float vVel; in vec3 vColor; in float vVisible;
uniform float uTime;
uniform float uSpeed;
uniform int uRings;
uniform float uRingDelay;
uniform float uStroke;
uniform float uClickOpacity;
out vec4 outColor;
void main() {
  if (vVisible <= 0.0) discard;
  // Ripple timings are real milliseconds; the trail clock runs at uSpeed.
  float elapsed = (uTime - vClickT) / uSpeed;
  if (elapsed < 0.0) discard;
  float d = length(vLocal);
  float aa = fwidth(d);
  float cov = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uRings) break;
    float start = float(i) * uRingDelay;
    if (elapsed < start) continue;
    float target = uRings == 1 ? vOuter : vCore + (vOuter - vCore) * float(i) / float(uRings - 1);
    float p = clamp((elapsed - start) / max(1.0, target / vVel), 0.0, 1.0);
    float r = target * (1.0 - pow(1.0 - p, 3.0));
    cov = max(cov, 1.0 - smoothstep(uStroke * 0.5 - aa, uStroke * 0.5 + aa, abs(d - r)));
  }
  if (cov <= 0.0) discard;
  float a = uClickOpacity * cov;
  outColor = vec4(vColor * a, a);
}`;

function mountGl2(container: HTMLElement) {
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.cssText = `width:${W}px;height:${H}px;position:absolute;inset:0`;
  container.appendChild(canvas);
  const gl = canvas.getContext("webgl2", {
    depth: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  })!;
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(sh)!);
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT2));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG2));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(prog)!);

  // Build one interleaved strip for every trail, joined with degenerate vertices.
  const t0 = performance.now();
  const evict = evictTimes();
  const chunks: Float32Array[] = [];
  let count = 0;
  // Draw oldest first. Each trail sits at its own depth (newer in front) so it
  // never blends over itself; drawing back to front means every older layer is
  // already in the framebuffer when a newer one blends over it, so layers stack
  // like the SVG renderer's instead of the newest hiding everything behind it.
  const drawOrder = states
    .map((st, i) => ({ i, start: st.startOffsetMs }))
    .sort((a, b) => a.start - b.start)
    .map((e) => e.i);
  drawOrder.forEach((idx) => {
    const s = states[idx];
    const size = INK ? 1 + ((idx * 7 + 3) % 5) : settings.strokeWidth;
    const pts = freehandCenterline(s.variedPoints, size);
    if (pts.length < 2) return;
    const line = subdivide(pts);
    const n = line.length;
    const buf = new Float32Array((n * 2 + 2 + pts.length * 6) * 7);
    let o = 0;
    const put = (x: number, y: number, t: number, lx: number, ly = 0) => {
      buf[o++] = x;
      buf[o++] = y;
      buf[o++] = t;
      buf[o++] = 0;
      buf[o++] = lx;
      buf[o++] = ly;
      buf[o++] = idx;
    };
    for (let k = 0; k < n; k++) {
      const a = line[Math.max(0, k - 1)],
        b = line[Math.min(n - 1, k + 1)];
      let dx = b.x - a.x,
        dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const w = line[k].r;
      if (k === 0) put(line[k].x + dy * w, line[k].y - dx * w, line[k].t, -1); // degenerate start
      put(line[k].x + dy * w, line[k].y - dx * w, line[k].t, -1);
      put(line[k].x - dy * w, line[k].y + dx * w, line[k].t, 1);
      if (k === n - 1)
        put(line[k].x - dy * w, line[k].y + dx * w, line[k].t, 1); // degenerate end
    }
    // Round joins: a disc at every smoothed point, standing in for
    // perfect-freehand's corner caps. The per-trail depth test keeps a disc
    // from darkening the strip it overlaps.
    for (const { x, y, r, t } of pts) {
      put(x - r, y - r, t, -1, -1); // degenerate in
      put(x - r, y - r, t, -1, -1);
      put(x + r, y - r, t, 1, -1);
      put(x - r, y + r, t, -1, 1);
      put(x + r, y + r, t, 1, 1);
      put(x + r, y + r, t, 1, 1); // degenerate out
    }
    chunks.push(buf);
    count += buf.length / 7;
  });
  const verts = new Float32Array(count * 7);
  let off = 0;
  for (const c of chunks) {
    verts.set(c, off);
    off += c.length;
  }
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const aPos = gl.getAttribLocation(prog, "aPos"),
    aLocal = gl.getAttribLocation(prog, "aLocal"),
    aTrail = gl.getAttribLocation(prog, "aTrail");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 4, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(aLocal);
  gl.vertexAttribPointer(aLocal, 2, gl.FLOAT, false, 28, 16);
  gl.enableVertexAttribArray(aTrail);
  gl.vertexAttribPointer(aTrail, 1, gl.FLOAT, false, 28, 24);

  // Per-trail data texture.
  // Paint order: the later a trail starts, the nearer it sits, so the newest
  // trail is always on top (the SVG renderer re-appends active heads the same way).
  const startRank = new Float32Array(states.length);
  drawOrder.forEach((idx, rank) => (startRank[idx] = rank));
  const texW = 2048,
    texH = Math.ceil((states.length * 2) / texW);
  const data = new Float32Array(texW * texH * 4);
  states.forEach((s, i) => {
    const [r, g, b] = hslToRgb(s.trail.color);
    data.set(
      [s.startOffsetMs, s.durationMs, evict[i], startRank[i], r, g, b, 0],
      i * 8,
    );
  });
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    texW,
    texH,
    0,
    gl.RGBA,
    gl.FLOAT,
    data,
  );
  (window as any).__glBuildMs = performance.now() - t0;
  (window as any).__glVerts = count;
  (window as any).__glMB = (verts.byteLength + data.byteLength) / 1e6;

  // Ripple geometry, built once like the trails.
  const rippleProg = gl.createProgram()!;
  gl.attachShader(rippleProg, compile(gl.VERTEX_SHADER, RIPPLE_VERT));
  gl.attachShader(rippleProg, compile(gl.FRAGMENT_SHADER, RIPPLE_FRAG));
  gl.linkProgram(rippleProg);
  if (!gl.getProgramParameter(rippleProg, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(rippleProg)!);
  const rippleVerts: number[] = [];
  // createClickEffect's radiusFactor is Math.random(); match it.
  const rippleRnd = Math.random;
  states.forEach((s, idx) => {
    for (const click of s.clicksWithProgress) {
      const pts = s.variedPoints;
      const exact = (pts.length - 1) * click.progress;
      const k = Math.min(Math.floor(exact), pts.length - 1);
      const f = exact - k;
      const a = pts[k],
        b = pts[Math.min(k + 1, pts.length - 1)];
      const cx = a.x + (b.x - a.x) * f,
        cy = a.y + (b.y - a.y) * f;
      // getRippleGeometry, with createClickEffect's random radiusFactor.
      const radiusFactor = rippleRnd();
      const hold = click.duration ? Math.min(3, 1 + click.duration / 1000) : 1;
      const expansion = settings.clickExpansionDuration * hold;
      const effMax =
        (settings.clickMinRadius +
          radiusFactor * (settings.clickMaxRadius - settings.clickMinRadius)) *
        hold;
      const outer = effMax * settings.clickAnimationStopPoint;
      const core = Math.max(
        1,
        Math.min(settings.clickCoreRadius + (radiusFactor - 0.5) * 4, outer),
      );
      const vel = outer / expansion;
      const clickT = s.startOffsetMs + click.progress * s.durationMs;
      const h = outer + settings.clickStrokeWidth;
      const corner = (dx: number, dy: number) =>
        rippleVerts.push(
          cx + dx,
          cy + dy,
          dx,
          dy,
          clickT,
          idx,
          outer,
          core,
          vel,
        );
      corner(-h, -h); // degenerate in
      corner(-h, -h);
      corner(h, -h);
      corner(-h, h);
      corner(h, h);
      corner(h, h); // degenerate out
    }
  });
  const rippleCount = rippleVerts.length / 9;
  const rippleVao = gl.createVertexArray();
  gl.bindVertexArray(rippleVao);
  const rippleVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, rippleVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rippleVerts), gl.STATIC_DRAW);
  const rp = (name: string, size: number, offset: number) => {
    const loc = gl.getAttribLocation(rippleProg, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 36, offset);
  };
  rp("aPos", 4, 0);
  rp("aClick", 4, 16);
  rp("aVel", 1, 32);
  gl.useProgram(rippleProg);
  const rView = gl.getUniformLocation(rippleProg, "uView"),
    rTime = gl.getUniformLocation(rippleProg, "uTime");
  gl.uniform1i(gl.getUniformLocation(rippleProg, "uTrails"), 0);
  gl.uniform1f(gl.getUniformLocation(rippleProg, "uSpeed"), SPEED);
  gl.uniform1i(
    gl.getUniformLocation(rippleProg, "uRings"),
    Math.max(1, Math.min(8, settings.clickNumRings)),
  );
  gl.uniform1f(
    gl.getUniformLocation(rippleProg, "uRingDelay"),
    settings.clickRingDelayMs,
  );
  gl.uniform1f(
    gl.getUniformLocation(rippleProg, "uStroke"),
    settings.clickStrokeWidth,
  );
  gl.uniform1f(
    gl.getUniformLocation(rippleProg, "uClickOpacity"),
    settings.clickOpacity,
  );
  (window as any).__glRipples = rippleCount / 6;

  gl.useProgram(prog);
  const uView = gl.getUniformLocation(prog, "uView"),
    uTime = gl.getUniformLocation(prog, "uTime");
  gl.uniform1f(gl.getUniformLocation(prog, "uOpacity"), settings.trailOpacity);
  gl.uniform1f(gl.getUniformLocation(prog, "uInk"), INK ? 1 : 0);
  gl.uniform1i(gl.getUniformLocation(prog, "uTrails"), 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.uniform1f(gl.getUniformLocation(prog, "uCount"), states.length + 2);
  gl.viewport(0, 0, canvas.width, canvas.height);

  const camera = cinematicConfig ? new CinematicCamera(cinematicConfig) : null;
  const active: Array<{
    index: number;
    x: number;
    y: number;
    progress: number;
  }> = [];
  let prevLooped = 0;
  // Cursors: only trails still drawing have one, so a small pool of SVG
  // groups over the canvas covers them. The overlay shares the camera's
  // viewBox, so cursors zoom with the trails exactly as in SVG mode.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const overlay = document.createElementNS(SVG_NS, "svg");
  overlay.setAttribute("preserveAspectRatio", "none");
  overlay.style.cssText = `position:absolute;inset:0;width:${W}px;height:${H}px;pointer-events:none`;
  container.appendChild(overlay);
  const renderer = getTrailRenderer(INK ? "monochrome" : "color");
  const CURSOR_SIZE = 32;
  const markupCache = new Map<string, string>();
  const cursorMarkup = (type: string | undefined, color: string) => {
    const key = `${type}|${color}`;
    let markup = markupCache.get(key);
    if (!markup) {
      const Cursor = getCursorComponent(type);
      const scale = (CURSOR_SIZE / 24) * getCursorScaleFactor(type);
      const hotspot = getCursorHotspot(type);
      // Render the shared cursor component once, off-DOM, and keep its markup.
      const host = document.createElementNS(SVG_NS, "g");
      const root = createRoot(host);
      flushSync(() => root.render(<Cursor color={color} size={CURSOR_SIZE} />));
      markup = `<g transform="translate(${-hotspot.x * scale}, ${-hotspot.y * scale})">${host.innerHTML}</g>`;
      root.unmount();
      markupCache.set(key, markup);
    }
    return markup;
  };
  const pool: Array<{ el: SVGGElement; key: string }> = [];
  const updateCursors = () => {
    for (let i = 0; i < active.length; i++) {
      if (i === pool.length) {
        const el = document.createElementNS(SVG_NS, "g");
        overlay.appendChild(el);
        pool.push({ el, key: "" });
      }
      const slot = pool[i];
      const { index, x, y, progress } = active[i];
      const s = states[index];
      const pts = s.trail.points;
      const type =
        pts[Math.min(Math.floor((pts.length - 1) * progress), pts.length - 1)]
          ?.cursor;
      const color = renderer.getCursorColor(s.trail.color, type);
      const key = `${type}|${color}`;
      if (slot.key !== key) {
        slot.el.innerHTML = cursorMarkup(type, color);
        slot.key = key;
      }
      slot.el.setAttribute("transform", `translate(${x}, ${y})`);
      slot.el.style.display = "";
    }
    for (let i = active.length; i < pool.length; i++)
      pool[i].el.style.display = "none";
  };

  const frame = () => {
    const looped = elapsedMs() % DURATION;
    if (looped < prevLooped) camera?.reset();
    prevLooped = looped;
    // Trail heads from the CPU: they feed the camera and the cursors, as they
    // would the sound engine.
    active.length = 0;
    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      const pr = (looped - s.startOffsetMs) / s.durationMs;
      if (pr <= 0 || pr >= 1) continue;
      const pts = s.variedPoints,
        exact = (pts.length - 1) * pr,
        k = Math.floor(exact),
        f = exact - k;
      const a = pts[k],
        b = pts[Math.min(k + 1, pts.length - 1)];
      active.push({
        index: i,
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        progress: pr,
      });
    }
    let view: ViewBox = { x: 0, y: 0, w: W, h: H };
    if (VIEW) {
      const [vx, vy, vw] = VIEW.split(",").map(Number);
      view = { x: vx, y: vy, w: vw, h: (vw * H) / W };
    } else if (camera) {
      view =
        camera.tick({
          screenW: W,
          screenH: H,
          nowMs: performance.now(),
          activeTrails: active,
        }) ?? view;
    }
    overlay.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
    updateCursors();
    (window as any).__view = view;
    // Opaque page background, so multiplied ripples have something to darken.
    gl.clearColor(0xfa / 255, 0xf7 / 255, 0xf2 / 255, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Ripples first, without depth, so trails paint over them as in SVG.
    if (q.get("clicks") !== "0" && rippleCount > 0) {
      gl.disable(gl.DEPTH_TEST);
      // mix-blend-mode: multiply, as the SVG rings use: with premultiplied
      // (c*a, a) this gives dst * (1 - a + a*c).
      gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(rippleProg);
      gl.bindVertexArray(rippleVao);
      gl.uniform4f(rView, view.x, view.y, view.w, view.h);
      gl.uniform1f(rTime, looped);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, rippleCount);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
    }
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform4f(uView, view.x, view.y, view.w, view.h);
    gl.uniform1f(uTime, looped);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, count);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
