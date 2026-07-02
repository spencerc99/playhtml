// ABOUTME: p5 sketch for the touches page — replays cursors on the co-presence
// ABOUTME: timeline and fires two-color gradient bursts where they touch

import p5 from "p5";
import { Trail } from "../shared/types";
import {
  CursorTouch,
  TimeSegment,
  playToReal,
  realToPlay,
  positionAt,
  motionAt,
} from "./detect";

export interface SketchData {
  trails: Trail[];
  touches: CursorTouch[];
  segments: TimeSegment[];
  totalMs: number;
}

/** Live-tunable settings the sketch reads every frame. */
export interface SketchSettings {
  speed: number;
  afterglowMs: number;
  showCursors: boolean;
}

const BURST_LIFE_MS = 1600;
const BURST_MAX_RADIUS = 90;
const CURSOR_TAIL_MS = 700;

interface Burst {
  touch: CursorTouch;
  /** Playback offset at which this burst began. */
  startPlayMs: number;
}

export function createTouchesSketch(
  data: SketchData,
  settingsRef: { current: SketchSettings },
  container: HTMLElement,
): p5 {
  const touchPlayTimes = data.touches.map((touch) =>
    realToPlay(data.segments, touch.ts),
  );

  const sketch = (p: p5) => {
    let playElapsed = 0;
    let nextTouchIndex = 0;
    let bursts: Burst[] = [];

    p.setup = () => {
      p.createCanvas(container.clientWidth, container.clientHeight);
    };

    p.windowResized = () => {
      p.resizeCanvas(container.clientWidth, container.clientHeight);
    };

    const drawCursor = (trail: Trail, realTs: number) => {
      const pos = motionAt(trail, realTs);
      const color = p.color(trail.color);

      // Parked cursors (wide sample bracket) sit dim and still — no tail, no
      // interpolated drift across idle gaps.
      if (!pos.live) {
        color.setAlpha(80);
        p.noStroke();
        p.fill(color);
        p.circle(pos.x, pos.y, 7);
        return;
      }

      // Short comet tail so motion reads without drawing whole trails.
      p.noFill();
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        const t0 = realTs - (CURSOR_TAIL_MS * i) / steps;
        const t1 = realTs - (CURSOR_TAIL_MS * (i - 1)) / steps;
        if (t1 <= trail.startTime) break;
        const a = positionAt(trail, Math.max(t0, trail.startTime));
        const b = positionAt(trail, Math.max(t1, trail.startTime));
        color.setAlpha(140 * (1 - i / (steps + 1)));
        p.stroke(color);
        p.strokeWeight(2.5 * (1 - i / (steps + 2)));
        p.line(a.x, a.y, b.x, b.y);
      }

      color.setAlpha(255);
      p.noStroke();
      p.fill(color);
      p.circle(pos.x, pos.y, 9);
    };

    const drawBurst = (burst: Burst) => {
      const age = playElapsed - burst.startPlayMs;
      if (age < 0 || age > BURST_LIFE_MS) return;
      const progress = age / BURST_LIFE_MS;
      const eased = 1 - (1 - progress) ** 3;
      const radius = 14 + eased * BURST_MAX_RADIUS;
      const alpha = 1 - progress;

      const ctx = p.drawingContext as CanvasRenderingContext2D;
      const { touch } = burst;

      // Slowly rotating two-color pinwheel, faded out radially — the
      // "gradient shader" feel without leaving the 2D canvas.
      const conic = ctx.createConicGradient(
        progress * Math.PI,
        touch.x,
        touch.y,
      );
      const colorA = p.color(touch.colorA);
      const colorB = p.color(touch.colorB);
      const wedges = 6;
      for (let i = 0; i <= wedges; i++) {
        const c = i % 2 === 0 ? colorA : colorB;
        c.setAlpha(160 * alpha);
        conic.addColorStop(i / wedges, c.toString());
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(touch.x, touch.y, radius, 0, Math.PI * 2);
      const fade = ctx.createRadialGradient(
        touch.x,
        touch.y,
        radius * 0.15,
        touch.x,
        touch.y,
        radius,
      );
      fade.addColorStop(0, `rgba(250, 247, 242, ${0.45 * alpha})`);
      fade.addColorStop(1, "rgba(250, 247, 242, 0)");
      ctx.fillStyle = conic;
      ctx.fill();
      ctx.fillStyle = fade;
      ctx.fill();
      ctx.restore();

      // Crisp expanding ring in the blended color, like a click ripple.
      const mixed = p.lerpColor(colorA, colorB, 0.5);
      mixed.setAlpha(220 * alpha);
      p.noFill();
      p.stroke(mixed);
      p.strokeWeight(2);
      p.circle(touch.x, touch.y, radius * 2);
    };

    const drawAfterglow = (burst: Burst, realTs: number) => {
      const { afterglowMs } = settingsRef.current;
      if (afterglowMs <= 0) return;
      const age = playElapsed - burst.startPlayMs;
      if (age > afterglowMs) return;
      const fade = 1 - age / afterglowMs;

      for (const trailIndex of [burst.touch.trailA, burst.touch.trailB]) {
        const trail = data.trails[trailIndex];
        const from = burst.touch.ts;
        const to = Math.min(realTs, trail.endTime);
        if (to <= from) continue;
        const color = p.color(trail.color);
        color.setAlpha(70 * fade);
        p.noFill();
        p.stroke(color);
        p.strokeWeight(1.5);
        p.beginShape();
        for (let ts = from; ts <= to; ts += 120) {
          const pos = positionAt(trail, ts);
          p.vertex(pos.x, pos.y);
        }
        p.endShape();
      }
    };

    p.draw = () => {
      const settings = settingsRef.current;
      playElapsed += Math.min(250, p.deltaTime) * settings.speed;

      if (data.totalMs <= 0) {
        p.background(250, 247, 242);
        return;
      }

      if (playElapsed >= data.totalMs) {
        playElapsed = playElapsed % data.totalMs;
        nextTouchIndex = 0;
        bursts = [];
      }

      const realTs = playToReal(data.segments, playElapsed);
      p.background(250, 247, 242);

      while (
        nextTouchIndex < touchPlayTimes.length &&
        touchPlayTimes[nextTouchIndex] <= playElapsed
      ) {
        bursts.push({
          touch: data.touches[nextTouchIndex],
          startPlayMs: touchPlayTimes[nextTouchIndex],
        });
        nextTouchIndex++;
      }
      bursts = bursts.filter(
        (burst) =>
          playElapsed - burst.startPlayMs <=
          Math.max(BURST_LIFE_MS, settings.afterglowMs),
      );

      for (const burst of bursts) drawAfterglow(burst, realTs);

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
