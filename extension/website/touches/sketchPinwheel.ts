// ABOUTME: The original pinwheel renderer for the touches page, kept for reference —
// ABOUTME: conic-gradient bursts and clean pinwheel marks, pre nebula redesign

import p5 from "p5";
import { Trail } from "../shared/types";
import {
  CursorTouch,
  playToReal,
  realToPlay,
  motionAt,
} from "./detect";

import { SketchData, SketchSettings } from "./sketch";

const BURST_LIFE_MS = 1600;
const BURST_MAX_RADIUS = 90;
const MARK_RADIUS = 11;

interface Burst {
  touch: CursorTouch;
  /** Playback offset at which this burst began. */
  startPlayMs: number;
}

export function createTouchesSketchPinwheel(
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
    // Every touch leaves a permanent mark here so the canvas stays inhabited
    // for the rest of the cycle; one image() blit per frame regardless of
    // how many marks have accumulated.
    let marks: p5.Graphics;

    // Small settled pinwheel stamped at the moment of contact — the burst
    // blooms around it and fades, the mark stays.
    const stampMark = (touch: CursorTouch) => {
      const ctx = marks.drawingContext as CanvasRenderingContext2D;
      const colorA = p.color(touch.colorA);
      const colorB = p.color(touch.colorB);
      const conic = ctx.createConicGradient(0, touch.x, touch.y);
      const wedges = 6;
      for (let i = 0; i <= wedges; i++) {
        const c = i % 2 === 0 ? colorA : colorB;
        c.setAlpha(110);
        conic.addColorStop(i / wedges, c.toString());
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(touch.x, touch.y, MARK_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = conic;
      ctx.fill();
      ctx.restore();

      const mixed = p.lerpColor(colorA, colorB, 0.5);
      mixed.setAlpha(160);
      marks.noFill();
      marks.stroke(mixed);
      marks.strokeWeight(1.5);
      marks.circle(touch.x, touch.y, MARK_RADIUS * 2);
    };

    p.setup = () => {
      p.createCanvas(container.clientWidth, container.clientHeight);
      marks = p.createGraphics(container.clientWidth, container.clientHeight);
    };

    p.windowResized = () => {
      p.resizeCanvas(container.clientWidth, container.clientHeight);
      marks = p.createGraphics(container.clientWidth, container.clientHeight);
      // Restore the marks the cycle has already passed through.
      for (let i = 0; i < nextTouchIndex; i++) stampMark(data.touches[i]);
    };

    const drawCursor = (trail: Trail, realTs: number) => {
      const pos = motionAt(trail, realTs);
      const color = p.color(trail.color);

      // Parked cursors (wide sample bracket) sit dim and still, without
      // interpolating across idle gaps.
      if (!pos.live) {
        color.setAlpha(80);
        p.noStroke();
        p.fill(color);
        p.circle(pos.x, pos.y, 7);
        return;
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
        marks.clear();
      }

      const realTs = playToReal(data.segments, playElapsed);
      onTime?.(realTs);
      p.background(250, 247, 242);
      p.image(marks, 0, 0);

      while (
        nextTouchIndex < touchPlayTimes.length &&
        touchPlayTimes[nextTouchIndex] <= playElapsed
      ) {
        stampMark(data.touches[nextTouchIndex]);
        bursts.push({
          touch: data.touches[nextTouchIndex],
          startPlayMs: touchPlayTimes[nextTouchIndex],
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
