// ABOUTME: Utilities for composing cursor stroke data into SVG strings.
// ABOUTME: Used for CSS cursors, live cursor rendering, and pasture scene display.

export interface Stroke {
  color: string;
  svgPath: string;
}

export interface CursorDrawing {
  creatorId: string;
  strokes: Stroke[];
  createdAt: number;
}

export function composeSvg(strokes: Stroke[], size: number = 32): string {
  const paths = strokes
    .map((s) => `<path d="${s.svgPath}" fill="${s.color}"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">${paths}</svg>`;
}

export function composeSvgDataUrl(
  strokes: Stroke[],
  size: number = 32
): string {
  const svg = composeSvg(strokes, size);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function cssCursorFromStrokes(strokes: Stroke[]): string {
  if (strokes.length === 0) return "auto";
  return `url("${composeSvgDataUrl(strokes)}"), auto`;
}
