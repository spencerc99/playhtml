// ABOUTME: WEBGL renderer for the touches page — nebula collision bursts computed
// ABOUTME: in a fragment shader (fbm turbulence, noisy shell, filament rays)

import p5 from "p5";
import { Trail } from "../shared/types";
import { hashString } from "../shared/utils/styleUtils";
import { SketchData, SketchSettings } from "./sketch";
import {
  CursorTouch,
  playToReal,
  realToPlay,
  motionAt,
} from "./detect";

const BURST_LIFE_MS = 2000;
const BURST_QUAD_PX = 260;
const REMNANT_QUAD_PX = 56;

const VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vUv;
uniform mat4 uProjectionMatrix;
uniform mat4 uModelViewMatrix;
void main() {
  vUv = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uProgress;
uniform float uSeed;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uMode; // 0 = live burst, 1 = settled remnant

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.13;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 c = (vUv - 0.5) * 2.0; // -1..1 across the quad
  float r = length(c);
  float ang = atan(c.y, c.x);
  vec3 white = vec3(1.0, 0.98, 0.93);

  if (uMode > 0.5) {
    // Settled remnant: a static turbulent knot of both colors.
    float turb = fbm(c * 3.2 + uSeed);
    float body = smoothstep(0.95, 0.15, r + (turb - 0.5) * 0.85);
    float sparkle = pow(noise(c * 9.0 + uSeed * 3.0), 6.0) * smoothstep(1.0, 0.3, r);
    vec3 col = mix(uColorA, uColorB, clamp(turb * 1.5 - 0.25, 0.0, 1.0));
    float alpha = body * 0.2 + sparkle * 0.3;
    gl_FragColor = vec4(col * (body * 0.85 + sparkle * 0.8) + white * sparkle * 0.2, alpha);
    return;
  }

  float prog = uProgress;
  float eased = 1.0 - pow(1.0 - prog, 3.0);
  float fade = 1.0 - prog;

  float turb = fbm(c * 3.5 + uSeed + prog * 0.7);

  // Hot core: blooms fast, dies before the shell finishes.
  float coreA = pow(1.0 - eased, 1.4);
  float core = exp(-r * r * 26.0) * coreA * 1.4;

  // Shockwave shell with noise-torn radius and thickness.
  float shellR = 0.12 + eased * 0.72;
  float wobble = (fbm(vec2(ang * 1.4 + uSeed, uSeed * 0.7)) - 0.5) * 0.22;
  float band = abs(r - (shellR + wobble));
  float shell = smoothstep(0.09 + turb * 0.05, 0.0, band) * fade;

  // Filament rays: angular noise spikes reaching past the shell.
  float rays = pow(fbm(vec2(ang * 2.6 + uSeed * 5.0, uSeed)), 3.0) * 2.2;
  float fil = rays
    * smoothstep(shellR + 0.35, shellR * 0.25, r)
    * smoothstep(0.02, 0.2, r)
    * fade;

  // Inner haze filling the blast interior.
  float haze = turb * smoothstep(shellR + 0.1, 0.0, r) * 0.4 * fade;

  vec3 col = mix(uColorA, uColorB, clamp(turb * 1.5 - 0.25, 0.0, 1.0));
  vec3 rgb = white * core + col * (shell * 1.25 + fil + haze) + white * shell * 0.25;
  float alpha = clamp(core + shell + fil * 0.85 + haze, 0.0, 1.0);
  gl_FragColor = vec4(rgb, alpha);
}
`;

interface Burst {
  touch: CursorTouch;
  startPlayMs: number;
  seed: number;
}

/** Seed folded into 0-10 so shader float precision stays comfortable. */
const shaderSeed = (touch: CursorTouch) =>
  (hashString(`${touch.ts}|${touch.x.toFixed(1)}`) % 1000) / 100;

export function createTouchesSketchGlsl(
  data: SketchData,
  settingsRef: { current: SketchSettings },
  container: HTMLElement,
  onTime?: (realTs: number) => void,
): p5 {
  const touchPlayTimes = data.touches.map((touch) =>
    realToPlay(data.segments, touch.ts),
  );

  const sketch = (p: p5) => {
    let playElapsed = 0;
    let nextTouchIndex = 0;
    let bursts: Burst[] = [];
    let burstShader: p5.Shader;
    // Remnants accumulate here (own WEBGL context and shader instance) so
    // the main pass blits one image regardless of how many have settled.
    let marks: p5.Graphics;
    let marksShader: p5.Shader;

    const rgb = (color: p5.Color): [number, number, number] => [
      p.red(color) / 255,
      p.green(color) / 255,
      p.blue(color) / 255,
    ];

    const stampMark = (touch: CursorTouch) => {
      marks.push();
      marks.noStroke();
      marks.shader(marksShader);
      marksShader.setUniform("uProgress", 1);
      marksShader.setUniform("uSeed", shaderSeed(touch));
      marksShader.setUniform("uColorA", rgb(p.color(touch.colorA)));
      marksShader.setUniform("uColorB", rgb(p.color(touch.colorB)));
      marksShader.setUniform("uMode", 1);
      marks.translate(touch.x - p.width / 2, touch.y - p.height / 2);
      marks.plane(REMNANT_QUAD_PX, REMNANT_QUAD_PX);
      marks.pop();
    };

    const initMarks = () => {
      marks = p.createGraphics(p.width, p.height, p.WEBGL);
      marksShader = marks.createShader(VERT, FRAG);
    };

    p.setup = () => {
      p.createCanvas(container.clientWidth, container.clientHeight, p.WEBGL);
      burstShader = p.createShader(VERT, FRAG);
      initMarks();
    };

    p.windowResized = () => {
      p.resizeCanvas(container.clientWidth, container.clientHeight);
      initMarks();
      for (let i = 0; i < nextTouchIndex; i++) stampMark(data.touches[i]);
    };

    const drawCursor = (trail: Trail, realTs: number) => {
      const pos = motionAt(trail, realTs);
      const color = p.color(trail.color);
      const x = pos.x - p.width / 2;
      const y = pos.y - p.height / 2;

      if (!pos.live) {
        color.setAlpha(120);
        p.noStroke();
        p.fill(color);
        p.circle(x, y, 4.5);
        return;
      }

      // Additive halo rings for glow, then the head with a hot core.
      p.blendMode(p.ADD);
      p.noStroke();
      for (let ring = 3; ring >= 1; ring--) {
        color.setAlpha(26);
        p.fill(color);
        p.circle(x, y, 8 + ring * 7);
      }
      p.blendMode(p.BLEND);
      color.setAlpha(255);
      p.fill(color);
      p.circle(x, y, 8.5);
      p.fill(255, 252, 240, 235);
      p.circle(x, y, 3.2);
    };

    const drawBurst = (burst: Burst) => {
      const age = playElapsed - burst.startPlayMs;
      if (age < 0 || age > BURST_LIFE_MS) return;
      const progress = age / BURST_LIFE_MS;

      p.push();
      p.noStroke();
      p.blendMode(p.ADD);
      p.shader(burstShader);
      burstShader.setUniform("uProgress", progress);
      burstShader.setUniform("uSeed", burst.seed);
      burstShader.setUniform("uColorA", rgb(p.color(burst.touch.colorA)));
      burstShader.setUniform("uColorB", rgb(p.color(burst.touch.colorB)));
      burstShader.setUniform("uMode", 0);
      p.translate(burst.touch.x - p.width / 2, burst.touch.y - p.height / 2);
      p.plane(BURST_QUAD_PX, BURST_QUAD_PX);
      p.resetShader();
      p.blendMode(p.BLEND);
      p.pop();
    };

    p.draw = () => {
      const settings = settingsRef.current;
      playElapsed += Math.min(250, p.deltaTime) * settings.speed;

      // The shader exploration lives on a night sky regardless of the
      // toggle — additive light has nothing to glow against on linen.
      p.background(16, 13, 19);
      if (data.totalMs <= 0) return;

      if (playElapsed >= data.totalMs) {
        playElapsed = playElapsed % data.totalMs;
        nextTouchIndex = 0;
        bursts = [];
        initMarks();
      }

      const realTs = playToReal(data.segments, playElapsed);
      onTime?.(realTs);
      // Remnants blit with normal blending — additive stacking of a
      // thousand marks whites out the dense center.
      p.image(marks, -p.width / 2, -p.height / 2, p.width, p.height);

      while (
        nextTouchIndex < touchPlayTimes.length &&
        touchPlayTimes[nextTouchIndex] <= playElapsed
      ) {
        const touch = data.touches[nextTouchIndex];
        stampMark(touch);
        bursts.push({
          touch,
          startPlayMs: touchPlayTimes[nextTouchIndex],
          seed: shaderSeed(touch),
        });
        nextTouchIndex++;
      }
      bursts = bursts.filter(
        (burst) => playElapsed - burst.startPlayMs <= BURST_LIFE_MS,
      );

      if (settings.showCursors) {
        for (const trail of data.trails) {
          if (trail.startTime <= realTs && realTs <= trail.endTime) {
            drawCursor(trail, realTs);
          }
        }
      }

      for (const burst of bursts) drawBurst(burst);
    };
  };

  return new p5(sketch, container);
}
