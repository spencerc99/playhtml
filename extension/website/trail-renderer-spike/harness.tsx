// ABOUTME: Spike page comparing the SVG trail renderer with p5 and raw WebGL2 renderers.
// ABOUTME: Same synthetic trails and cinematic camera in every mode; shows fps on screen.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  getCursorComponent,
  getCursorHotspot,
  getCursorScaleFactor,
} from "@movement/cursors";
import { getTrailRenderer } from "@movement/styles/trailRenderers";
import p5 from "p5";
import { AnimatedTrails } from "@movement/components/AnimatedTrails";
import { DEFAULT_SETTINGS } from "@movement/components/settingsDefaults";
import {
  CinematicCamera,
  DEFAULT_CINEMATIC_CONFIG,
  type ViewBox,
} from "@movement/utils/cinematicCamera";
import type { TrailState } from "@movement/types";

const q = new URLSearchParams(location.search);
const N = Number(q.get("n") ?? 2000);
const PTS = Number(q.get("pts") ?? 150);
const SPEED = Number(q.get("speed") ?? 20);
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
const DURATION = 60 * 60 * 1000;
const cursors = ["default", "pointer", "text"];
const states: TrailState[] = [];
for (let i = 0; i < N; i++) {
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
  states.push({
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
const timeRange = { min: 0, max: DURATION, duration: DURATION };
const settings = {
  ...DEFAULT_SETTINGS,
  animationSpeed: SPEED,
  trailVisualStyle: INK ? "monochrome" : "color",
};

// One shared clock for both renderers so runs are comparable.
const wallStart = performance.now();
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
].join(" · ");
let hudFrames = 0,
  hudLast = performance.now();
const hudTick = (t: number) => {
  hudFrames++;
  if (t - hudLast > 1000) {
    const w = window as any;
    hud.innerHTML =
      `${MODE} · ${N} trails · ${Math.round((hudFrames * 1000) / (t - hudLast))} fps` +
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
  queueMicrotask(() => mountGl2(document.getElementById("root")!));
}

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
  gl_Position = vec4(ndc.x, -ndc.y, 0.999 - 1.998 * (float(id) + 1.0) / uCount, 1.0);
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
  states.forEach((s, idx) => {
    const half = INK ? (1 + ((idx * 7 + 3) % 5)) / 2 : settings.strokeWidth / 2;
    const line = smoothCenterline(s.variedPoints);
    const n = line.length;
    const src = s.variedPoints;
    const buf = new Float32Array((n * 2 + 2 + src.length * 6) * 7);
    let o = 0;
    const lens = new Float32Array(n);
    for (let k = 1; k < n; k++)
      lens[k] =
        lens[k - 1] +
        Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
    const total = lens[n - 1];
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
      const w =
        half *
        Math.max(0.15, Math.min(1, lens[k] / TAPER, (total - lens[k]) / TAPER));
      if (k === 0) put(line[k].x + dy * w, line[k].y - dx * w, line[k].t, -1); // degenerate start
      put(line[k].x + dy * w, line[k].y - dx * w, line[k].t, -1);
      put(line[k].x - dy * w, line[k].y + dx * w, line[k].t, 1);
      if (k === n - 1)
        put(line[k].x - dy * w, line[k].y + dx * w, line[k].t, 1); // degenerate end
    }
    // Round joins: a disc at every recorded point. The per-trail depth test keeps
    // a disc from darkening the strip it overlaps.
    for (let k = 0; k < src.length; k++) {
      const t = k / (src.length - 1);
      const lk = Math.min(n - 1, k * SUB);
      const r =
        half *
        Math.max(
          0.15,
          Math.min(1, lens[lk] / TAPER, (total - lens[lk]) / TAPER),
        );
      const { x, y } = src[k];
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
  const texW = 2048,
    texH = Math.ceil((states.length * 2) / texW);
  const data = new Float32Array(texW * texH * 4);
  states.forEach((s, i) => {
    const [r, g, b] = hslToRgb(s.trail.color);
    data.set([s.startOffsetMs, s.durationMs, evict[i], 0, r, g, b, 0], i * 8);
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
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform4f(uView, view.x, view.y, view.w, view.h);
    gl.uniform1f(uTime, looped);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, count);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
