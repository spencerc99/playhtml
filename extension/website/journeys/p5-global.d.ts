// ABOUTME: Minimal ambient typing for the global p5 constructor loaded via CDN.
// ABOUTME: Covers only the subset of the p5 instance-mode API the sketch uses.

interface P5Instance {
  setup: () => void;
  draw: () => void;
  windowResized?: () => void;

  createCanvas(w: number, h: number): unknown;
  resizeCanvas(w: number, h: number): void;
  pixelDensity(d?: number): number;

  width: number;
  height: number;
  windowWidth: number;
  windowHeight: number;
  frameCount: number;
  deltaTime: number;
  millis(): number;

  push(): void;
  pop(): void;
  translate(x: number, y: number): void;

  background(gray: number, alpha?: number): void;
  stroke(r: number, g?: number, b?: number, a?: number): void;
  strokeWeight(w: number): void;
  noStroke(): void;
  fill(r: number, g?: number, b?: number, a?: number): void;
  noFill(): void;

  line(x1: number, y1: number, x2: number, y2: number): void;
  circle(x: number, y: number, d: number): void;
  point(x: number, y: number): void;
  beginShape(): void;
  vertex(x: number, y: number): void;
  endShape(): void;

  textAlign(horiz: number, vert?: number): void;
  textSize(n: number): void;
  text(s: string, x: number, y: number): void;

  readonly CENTER: number;
  readonly LEFT: number;

  drawingContext: CanvasRenderingContext2D;
}

interface P5Constructor {
  new (sketch: (p: P5Instance) => void, node?: HTMLElement | string): P5Instance;
}

declare const p5: P5Constructor;
