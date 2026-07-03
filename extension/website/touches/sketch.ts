// ABOUTME: p5 sketch for the touches page — replays comet-like cursors on the
// ABOUTME: co-presence timeline and fires nebula collision bursts where they touch

import p5 from "p5";
import { Trail } from "../shared/types";
import { hashString, seededRandom } from "../shared/utils/styleUtils";
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

export type MarkStyle =
  | "nebula"
  | "sunprint"
  | "fingerprint"
  | "blot"
  | "wear"
  | "stitch";

/** Live-tunable settings the sketch reads every frame. */
export interface SketchSettings {
  speed: number;
  afterglowMs: number;
  showCursors: boolean;
  /** Dark sky mode: additive glow against near-black. Off = linen paper,
   * where marks blend like ink instead of light. */
  night: boolean;
  /** What residue a touch leaves behind. Everything except "nebula" also
   * quiets the burst down to a soft ring. */
  markStyle: MarkStyle;
}

const BURST_LIFE_MS = 1800;
const BURST_MAX_RADIUS = 95;
const CURSOR_TAIL_MS = 900;
const MARK_RADIUS = 13;
const NIGHT_BG: [number, number, number] = [16, 13, 19];
const DAY_BG: [number, number, number] = [250, 247, 242];

interface Burst {
  touch: CursorTouch;
  /** Playback offset at which this burst began. */
  startPlayMs: number;
  seed: number;
}

export function createTouchesSketch(
  data: SketchData,
  settingsRef: { current: SketchSettings },
  container: HTMLElement,
  onTime?: (realTs: number) => void,
): p5 {
  const touchPlayTimes = data.touches.map((touch) =>
    realToPlay(data.segments, touch.ts),
  );
  const touchSeed = (touch: CursorTouch) =>
    hashString(`${touch.ts}|${touch.x.toFixed(1)}|${touch.y.toFixed(1)}`);

  const sketch = (p: p5) => {
    let playElapsed = 0;
    let nextTouchIndex = 0;
    let bursts: Burst[] = [];
    // Every touch leaves a permanent remnant here so the canvas stays
    // inhabited for the rest of the cycle; one image() blit per frame
    // regardless of how many have accumulated.
    let marks: p5.Graphics;

    const glowComposite = () =>
      settingsRef.current.night ? "lighter" : "multiply";

    /** Organic blob outline: radius perturbed by smooth noise so no two
     * remnants share a silhouette. */
    const blobVertices = (
      x: number,
      y: number,
      radius: number,
      seed: number,
      wobble: number,
    ): Array<{ x: number; y: number }> => {
      const points: Array<{ x: number; y: number }> = [];
      const steps = 22;
      const noiseShift = (seed % 1000) * 0.13;
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const n = p.noise(
          Math.cos(angle) * 0.9 + noiseShift,
          Math.sin(angle) * 0.9 + noiseShift,
        );
        const r = radius * (1 - wobble + n * wobble * 2);
        points.push({ x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r });
      }
      return points;
    };

    /** Wobbly partial arc around (x, y) — the building block of the patina
     * styles: fingerprint ridges, stitch parentheses. */
    const wobblyArc = (
      x: number,
      y: number,
      radius: number,
      startAngle: number,
      span: number,
      seed: number,
    ) => {
      marks.beginShape();
      const steps = 12;
      for (let s = 0; s <= steps; s++) {
        const angle = startAngle + (s / steps) * span;
        const sway =
          (p.noise(angle * 1.9 + (seed % 400) * 0.37, radius * 0.3) - 0.5) *
          1.8;
        marks.vertex(
          x + Math.cos(angle) * (radius + sway),
          y + Math.sin(angle) * (radius + sway),
        );
      }
      marks.endShape();
    };

    // Concentric broken arcs, like a smudged thumbprint left on glass.
    const stampFingerprint = (
      touch: CursorTouch,
      seed: number,
      colorA: p5.Color,
      colorB: p5.Color,
      mixed: p5.Color,
      night: boolean,
    ) => {
      const rings = 3 + Math.floor(seededRandom(seed, 1) * 2);
      marks.noFill();
      for (let ring = 0; ring < rings; ring++) {
        const c = ring % 2 === 0 ? colorA : colorB;
        c.setAlpha(night ? 130 : 100);
        marks.stroke(c);
        marks.strokeWeight(0.9);
        const radius = 3.2 + ring * 3.1 + seededRandom(seed, 10 + ring) * 1.6;
        const start = seededRandom(seed, 20 + ring) * Math.PI * 2;
        const span = 1.2 + seededRandom(seed, 30 + ring) * 1.8;
        wobblyArc(touch.x, touch.y, radius, start, span, seed + ring * 13);
      }
      mixed.setAlpha(150);
      marks.noStroke();
      marks.fill(mixed);
      marks.circle(touch.x, touch.y, 2.6);
    };

    // A soft two-color bleed, like a water ring left by a warm cup.
    const stampBlot = (
      touch: CursorTouch,
      seed: number,
      colorA: p5.Color,
      colorB: p5.Color,
      mixed: p5.Color,
      night: boolean,
    ) => {
      marks.noStroke();
      const layers: Array<{ c: p5.Color; scale: number; alpha: number }> = [
        { c: mixed, scale: 1.35, alpha: night ? 30 : 20 },
        { c: colorA, scale: 0.85, alpha: night ? 44 : 30 },
        { c: colorB, scale: 0.6, alpha: night ? 44 : 30 },
      ];
      layers.forEach(({ c, scale, alpha }, layer) => {
        const offsetX = layer === 0 ? 0 : (seededRandom(seed, layer * 9) - 0.5) * 9;
        const offsetY = layer === 0 ? 0 : (seededRandom(seed, layer * 9 + 1) - 0.5) * 9;
        c.setAlpha(alpha);
        marks.fill(c);
        marks.beginShape();
        for (const v of blobVertices(
          touch.x + offsetX,
          touch.y + offsetY,
          MARK_RADIUS * scale,
          seed + layer * 41,
          0.5,
        )) {
          marks.vertex(v.x, v.y);
        }
        marks.endShape(marks.CLOSE);
      });
    };

    // Barely-there tonal wear with two paired dots — density does the
    // talking, like brass polished smooth where hands keep landing.
    const stampWear = (
      touch: CursorTouch,
      seed: number,
      colorA: p5.Color,
      colorB: p5.Color,
      mixed: p5.Color,
      night: boolean,
    ) => {
      const ctx = marks.drawingContext as CanvasRenderingContext2D;
      const radius = 13 + seededRandom(seed, 3) * 7;
      const soft = ctx.createRadialGradient(
        touch.x,
        touch.y,
        1,
        touch.x,
        touch.y,
        radius,
      );
      mixed.setAlpha(night ? 34 : 22);
      soft.addColorStop(0, mixed.toString());
      mixed.setAlpha(0);
      soft.addColorStop(1, mixed.toString());
      ctx.fillStyle = soft;
      ctx.beginPath();
      ctx.arc(touch.x, touch.y, radius, 0, Math.PI * 2);
      ctx.fill();

      const pairAngle = seededRandom(seed, 5) * Math.PI * 2;
      const dotOffset = 2.2;
      marks.noStroke();
      colorA.setAlpha(210);
      marks.fill(colorA);
      marks.circle(
        touch.x + Math.cos(pairAngle) * dotOffset,
        touch.y + Math.sin(pairAngle) * dotOffset,
        2.4,
      );
      colorB.setAlpha(210);
      marks.fill(colorB);
      marks.circle(
        touch.x - Math.cos(pairAngle) * dotOffset,
        touch.y - Math.sin(pairAngle) * dotOffset,
        2.4,
      );
    };

    // Two facing parentheses enclosing the meeting point, like a stitch or
    // a pair of hands cupped around something small.
    const stampStitch = (
      touch: CursorTouch,
      seed: number,
      colorA: p5.Color,
      colorB: p5.Color,
      mixed: p5.Color,
      night: boolean,
    ) => {
      const rotation = seededRandom(seed, 7) * Math.PI * 2;
      const radius = 4.6 + seededRandom(seed, 8) * 1.6;
      marks.noFill();
      colorA.setAlpha(night ? 190 : 160);
      marks.stroke(colorA);
      marks.strokeWeight(1.4);
      wobblyArc(touch.x, touch.y, radius, rotation + 0.5, Math.PI - 1.0, seed);
      colorB.setAlpha(night ? 190 : 160);
      marks.stroke(colorB);
      wobblyArc(
        touch.x,
        touch.y,
        radius,
        rotation + Math.PI + 0.5,
        Math.PI - 1.0,
        seed + 51,
      );
      mixed.setAlpha(170);
      marks.noStroke();
      marks.fill(mixed);
      marks.circle(touch.x, touch.y, 1.8);
    };

    /** The classic pointer silhouette, tip at (x, y), unrotated — cursors
     * never rotate on screen, so neither do their shadows. */
    const pointerPath = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      scale: number,
    ) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 14 * scale);
      ctx.lineTo(x + 3.8 * scale, y + 10.6 * scale);
      ctx.lineTo(x + 6.3 * scale, y + 16 * scale);
      ctx.lineTo(x + 8.6 * scale, y + 15 * scale);
      ctx.lineTo(x + 6.1 * scale, y + 9.6 * scale);
      ctx.lineTo(x + 10.8 * scale, y + 9.6 * scale);
      ctx.closePath();
    };

    // Sun print: the touch flash "exposes" a soft two-color stain, and the
    // two cursors' silhouettes — at their true positions at the moment of
    // contact — stay unexposed inside it, etched as negative space. The
    // hopeful twin of a shadow left on a surface by a bright event.
    const stampSunprint = (
      touch: CursorTouch,
      seed: number,
      colorA: p5.Color,
      colorB: p5.Color,
      mixed: p5.Color,
      night: boolean,
    ) => {
      const ctx = marks.drawingContext as CanvasRenderingContext2D;
      const posA = positionAt(data.trails[touch.trailA], touch.ts);
      const posB = positionAt(data.trails[touch.trailB], touch.ts);

      // Exposed surface: soft photographic stains, one per color at each
      // cursor's spot, blended at the middle.
      const stains: Array<{ x: number; y: number; c: p5.Color }> = [
        { x: posA.x, y: posA.y, c: colorA },
        { x: posB.x, y: posB.y, c: colorB },
        { x: touch.x, y: touch.y, c: mixed },
      ];
      for (const [index, stain] of stains.entries()) {
        const radius = 15 + seededRandom(seed, index * 11) * 8;
        const soft = ctx.createRadialGradient(
          stain.x,
          stain.y,
          2,
          stain.x,
          stain.y,
          radius,
        );
        stain.c.setAlpha(night ? 52 : 34);
        soft.addColorStop(0, stain.c.toString());
        stain.c.setAlpha(0);
        soft.addColorStop(1, stain.c.toString());
        ctx.fillStyle = soft;
        ctx.beginPath();
        ctx.arc(stain.x, stain.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Unexposed shadows: the arrows punch through the stain to bare
      // surface, tips at the exact meeting points.
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
      pointerPath(ctx, posA.x, posA.y, 0.62);
      ctx.fill();
      pointerPath(ctx, posB.x, posB.y, 0.62);
      ctx.fill();
      ctx.restore();
    };

    // Settled residue stamped at the moment of contact — style selectable;
    // the burst blooms around it and fades, the mark stays.
    const stampMark = (touch: CursorTouch) => {
      const ctx = marks.drawingContext as CanvasRenderingContext2D;
      const seed = touchSeed(touch);
      const night = settingsRef.current.night;
      const colorA = p.color(touch.colorA);
      const colorB = p.color(touch.colorB);
      const mixed = p.lerpColor(colorA, colorB, 0.5);
      const style = settingsRef.current.markStyle;

      if (style !== "nebula") {
        ctx.save();
        ctx.globalCompositeOperation = night ? "source-over" : "multiply";
        if (style === "sunprint") {
          stampSunprint(touch, seed, colorA, colorB, mixed, night);
        } else if (style === "fingerprint") {
          stampFingerprint(touch, seed, colorA, colorB, mixed, night);
        } else if (style === "blot") {
          stampBlot(touch, seed, colorA, colorB, mixed, night);
        } else if (style === "wear") {
          stampWear(touch, seed, colorA, colorB, mixed, night);
        } else {
          stampStitch(touch, seed, colorA, colorB, mixed, night);
        }
        ctx.restore();
        return;
      }

      ctx.save();
      // Remnants composite normally so hundreds of overlaps blend toward
      // color instead of blowing out to white — the additive glow belongs to
      // the live burst, not the residue.
      ctx.globalCompositeOperation = night ? "source-over" : "multiply";

      const layers = [colorA, colorB, mixed];
      layers.forEach((c, layer) => {
        const radius =
          MARK_RADIUS * (0.4 + seededRandom(seed, layer * 17) * 0.7);
        const offsetX = (seededRandom(seed, layer * 17 + 1) - 0.5) * 12;
        const offsetY = (seededRandom(seed, layer * 17 + 2) - 0.5) * 12;
        c.setAlpha(night ? 46 : 32);
        marks.noStroke();
        marks.fill(c);
        marks.beginShape();
        for (const v of blobVertices(
          touch.x + offsetX,
          touch.y + offsetY,
          radius,
          seed + layer * 31,
          0.6,
        )) {
          marks.vertex(v.x, v.y);
        }
        marks.endShape(marks.CLOSE);
      });

      // Wispy arc filaments hugging the remnant, like torn shell fragments.
      for (let w = 0; w < 3; w++) {
        const c = w % 2 === 0 ? colorA : colorB;
        c.setAlpha(night ? 80 : 60);
        marks.noFill();
        marks.stroke(c);
        marks.strokeWeight(0.7);
        const startAngle = seededRandom(seed, 300 + w * 7) * Math.PI * 2;
        const span = 0.6 + seededRandom(seed, 301 + w * 7) * 1.4;
        const arcRadius =
          MARK_RADIUS * (0.9 + seededRandom(seed, 302 + w * 7) * 0.9);
        marks.beginShape();
        const steps = 10;
        for (let s = 0; s <= steps; s++) {
          const angle = startAngle + (s / steps) * span;
          const sway =
            (p.noise(angle * 1.7 + (seed % 500) * 0.29, w * 3.1) - 0.5) * 7;
          marks.vertex(
            touch.x + Math.cos(angle) * (arcRadius + sway),
            touch.y + Math.sin(angle) * (arcRadius + sway),
          );
        }
        marks.endShape();
      }

      // Dust speckles drifting off the remnant.
      for (let i = 0; i < 8; i++) {
        const angle = seededRandom(seed, 200 + i * 3) * Math.PI * 2;
        const dist =
          MARK_RADIUS * (0.7 + seededRandom(seed, 201 + i * 3) * 2.1);
        const c = i % 2 === 0 ? colorA : colorB;
        c.setAlpha(night ? 130 : 100);
        marks.noStroke();
        marks.fill(c);
        marks.circle(
          touch.x + Math.cos(angle) * dist,
          touch.y + Math.sin(angle) * dist,
          0.7 + seededRandom(seed, 202 + i * 3) * 1.5,
        );
      }

      ctx.restore();
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
      const night = settingsRef.current.night;

      // Parked cursors (wide sample bracket) sit dim and still, like faint
      // stars — no tail, no interpolated drift across idle gaps.
      if (!pos.live) {
        color.setAlpha(night ? 120 : 80);
        p.noStroke();
        p.fill(color);
        p.circle(pos.x, pos.y, night ? 4.5 : 6);
        return;
      }

      // Comet tail: segments taper gradually from the head's width down to
      // a whisker, alpha falling with them.
      const steps = 14;
      let prev: { x: number; y: number } = pos;
      for (let i = 1; i <= steps; i++) {
        const t = realTs - (CURSOR_TAIL_MS * i) / steps;
        if (t <= trail.startTime) break;
        const point = positionAt(trail, Math.max(t, trail.startTime));
        const falloff = 1 - i / (steps + 1);
        color.setAlpha(210 * falloff * falloff);
        p.stroke(color);
        p.strokeWeight(0.6 + 7 * falloff);
        p.line(prev.x, prev.y, point.x, point.y);
        prev = point;
      }

      // Glow halo around the head.
      const ctx = p.drawingContext as CanvasRenderingContext2D;
      ctx.save();
      ctx.globalCompositeOperation = glowComposite();
      const halo = ctx.createRadialGradient(
        pos.x,
        pos.y,
        1,
        pos.x,
        pos.y,
        16,
      );
      color.setAlpha(night ? 120 : 60);
      halo.addColorStop(0, color.toString());
      color.setAlpha(0);
      halo.addColorStop(1, color.toString());
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Head: color disc with a hot core.
      color.setAlpha(255);
      p.noStroke();
      p.fill(color);
      p.circle(pos.x, pos.y, 8.5);
      p.fill(night ? p.color(255, 252, 240, 235) : p.color(255, 255, 255, 200));
      p.circle(pos.x, pos.y, 3.2);
    };

    const drawBurst = (burst: Burst) => {
      const age = playElapsed - burst.startPlayMs;
      if (age < 0 || age > BURST_LIFE_MS) return;
      const progress = age / BURST_LIFE_MS;
      const eased = 1 - (1 - progress) ** 3;
      const alpha = 1 - progress;
      const { touch, seed } = burst;
      const night = settingsRef.current.night;

      const colorA = p.color(touch.colorA);
      const colorB = p.color(touch.colorB);
      const mixed = p.lerpColor(colorA, colorB, 0.5);
      const ctx = p.drawingContext as CanvasRenderingContext2D;

      // Patina styles get a quiet bloom: a small glow and one soft ring,
      // no filaments — the residue is the point, not the explosion.
      if (settingsRef.current.markStyle !== "nebula") {
        ctx.save();
        ctx.globalCompositeOperation = glowComposite();
        const coreAlpha = (1 - eased) ** 1.5;
        if (coreAlpha > 0.01) {
          const coreRadius = 7 + eased * 16;
          const core = ctx.createRadialGradient(
            touch.x,
            touch.y,
            0,
            touch.x,
            touch.y,
            coreRadius,
          );
          mixed.setAlpha((night ? 150 : 90) * coreAlpha);
          core.addColorStop(0, mixed.toString());
          mixed.setAlpha(0);
          core.addColorStop(1, mixed.toString());
          ctx.fillStyle = core;
          ctx.beginPath();
          ctx.arc(touch.x, touch.y, coreRadius, 0, Math.PI * 2);
          ctx.fill();
        }
        mixed.setAlpha(170 * alpha);
        p.noFill();
        p.stroke(mixed);
        p.strokeWeight(1.3);
        p.circle(touch.x, touch.y, (12 + eased * 52) * 2);
        ctx.restore();
        return;
      }

      ctx.save();
      ctx.globalCompositeOperation = glowComposite();

      // Hot core flash: blooms fast, dies before the shell finishes.
      const coreAlpha = (1 - eased) ** 1.5;
      if (coreAlpha > 0.01) {
        const coreRadius = 10 + eased * 30;
        const core = ctx.createRadialGradient(
          touch.x,
          touch.y,
          0,
          touch.x,
          touch.y,
          coreRadius,
        );
        core.addColorStop(
          0,
          night
            ? `rgba(255, 250, 235, ${0.95 * coreAlpha})`
            : `rgba(120, 90, 60, ${0.5 * coreAlpha})`,
        );
        mixed.setAlpha(160 * coreAlpha);
        core.addColorStop(0.45, mixed.toString());
        mixed.setAlpha(0);
        core.addColorStop(1, mixed.toString());
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(touch.x, touch.y, coreRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Wobbly expanding shockwave shell.
      const shellRadius = 15 + eased * BURST_MAX_RADIUS;
      mixed.setAlpha(190 * alpha);
      p.noFill();
      p.stroke(mixed);
      p.strokeWeight(1.6);
      p.beginShape();
      for (const v of blobVertices(
        touch.x,
        touch.y,
        shellRadius,
        seed + Math.floor(progress * 3),
        0.12,
      )) {
        p.vertex(v.x, v.y);
      }
      p.endShape(p.CLOSE);

      // Filaments thrown off the collision, jittering outward in both colors.
      const filaments = 13;
      for (let f = 0; f < filaments; f++) {
        const baseAngle = seededRandom(seed, f * 5) * Math.PI * 2;
        const length =
          shellRadius * (0.6 + seededRandom(seed, f * 5 + 1) * 0.9);
        const c = f % 2 === 0 ? colorA : colorB;
        c.setAlpha(170 * alpha);
        p.stroke(c);
        p.strokeWeight(0.7 + seededRandom(seed, f * 5 + 2) * 1.4);
        p.noFill();
        p.beginShape();
        const segments = 7;
        const perpX = Math.cos(baseAngle + Math.PI / 2);
        const perpY = Math.sin(baseAngle + Math.PI / 2);
        for (let s = 0; s <= segments; s++) {
          const dist = 8 + (length - 8) * (s / segments) * eased;
          const sway =
            (p.noise(f * 9.7 + s * 0.55, (seed % 100) * 0.31) - 0.5) *
            16 *
            (s / segments);
          p.vertex(
            touch.x + Math.cos(baseAngle) * dist + perpX * sway,
            touch.y + Math.sin(baseAngle) * dist + perpY * sway,
          );
        }
        p.endShape();
      }

      ctx.restore();
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
        color.setAlpha((settingsRef.current.night ? 90 : 70) * fade);
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
      const bg = settings.night ? NIGHT_BG : DAY_BG;

      if (data.totalMs <= 0) {
        p.background(bg[0], bg[1], bg[2]);
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
      p.background(bg[0], bg[1], bg[2]);
      p.image(marks, 0, 0);

      while (
        nextTouchIndex < touchPlayTimes.length &&
        touchPlayTimes[nextTouchIndex] <= playElapsed
      ) {
        const touch = data.touches[nextTouchIndex];
        stampMark(touch);
        bursts.push({
          touch,
          startPlayMs: touchPlayTimes[nextTouchIndex],
          seed: touchSeed(touch),
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
