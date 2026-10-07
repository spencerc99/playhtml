// ABOUTME: Minimal type declarations for the p5.brush library, which ships no types.
// ABOUTME: Covers only the subset of the p5 build this experiment calls.

declare module "p5.brush" {
  import type p5 from "p5";

  /** Bind p5.brush to a p5 instance. Must be called before setup/draw. */
  export function instance(p: p5): void;

  /** Redirect brush drawing to a buffer, or back to the main canvas when omitted. */
  export function load(buffer?: p5.Graphics): void;

  /** Scale every registered brush's weight, scatter and spacing. */
  export function scaleBrushes(scale: number): void;

  /** Names of every registered brush, built-in and custom. */
  export function box(): string[];

  export function set(brushName: string, color: string, weight: number): void;
  export function pick(brushName: string): void;
  export function stroke(color: string): void;
  export function noStroke(): void;
  export function strokeWeight(weight: number): void;

  export function fill(color: string, opacity?: number): void;
  export function noFill(): void;
  export function fillBleed(
    strength: number,
    direction?: "out" | "in",
    angle?: number,
  ): void;
  export function fillTexture(
    textureStrength: number,
    borderIntensity: number,
    scatter?: boolean,
  ): void;

  export function hatch(
    dist: number,
    angle: number,
    options?: { rand?: number | false; continuous?: boolean; gradient?: number | false },
  ): void;
  export function noHatch(): void;
  export function hatchStyle(brushName: string, color: string, weight: number): void;

  export function line(x1: number, y1: number, x2: number, y2: number): void;

  /** Draw through absolute [x, y] or [x, y, pressure] control points. */
  export function spline(points: number[][], curvature?: number): unknown;
  export function circle(x: number, y: number, radius: number, r?: number | boolean): unknown;

  /** Segmented/curved stroke building: begin, then move(), then endStroke(). */
  export function beginStroke(type: "curve" | "segments", x: number, y: number): void;
  export function move(angle: number, length: number, pressure: number): void;
  export function endStroke(angle: number, pressure: number): void;

  /** Seed the library's PRNG, so scatter and jitter repeat exactly. */
  export function seed(value: number | string): void;

  export function noField(): void;
  export function wiggle(wiggle: number): void;
}
