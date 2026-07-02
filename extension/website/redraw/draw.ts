// ABOUTME: Places real cursor trails to draw image strokes — mosaic mode rigidly
// ABOUTME: shape-matches whole gestures, warp mode bends trails toward image edges

import { Trail } from "../shared/types";
import { resampleUniform } from "../shared/utils/styleUtils";
import { Point } from "./image";

/** A real cursor gesture available for drawing with. */
export interface LibraryItem {
  points: Point[];
  color: string;
  id: string;
}

const SHAPE_SAMPLE_POINTS = 24;

interface ShapeDescriptor {
  normalized: Point[];
  centroid: Point;
  scale: number;
}

function describeShape(points: Point[]): ShapeDescriptor | null {
  if (points.length < 2) return null;
  const resampled = resampleUniform(points, SHAPE_SAMPLE_POINTS);
  let cx = 0;
  let cy = 0;
  for (const p of resampled) {
    cx += p.x;
    cy += p.y;
  }
  cx /= resampled.length;
  cy /= resampled.length;

  let meanSq = 0;
  for (const p of resampled) {
    meanSq += (p.x - cx) ** 2 + (p.y - cy) ** 2;
  }
  const scale = Math.sqrt(meanSq / resampled.length);
  if (scale < 1e-3) return null;

  return {
    normalized: resampled.map((p) => ({
      x: (p.x - cx) / scale,
      y: (p.y - cy) / scale,
    })),
    centroid: { x: cx, y: cy },
    scale,
  };
}

/** Optimal rotation angle aligning `from` onto `to` (2D Procrustes). */
function optimalRotation(from: Point[], to: Point[]): number {
  let dot = 0;
  let cross = 0;
  for (let i = 0; i < from.length; i++) {
    dot += from[i].x * to[i].x + from[i].y * to[i].y;
    cross += from[i].x * to[i].y - from[i].y * to[i].x;
  }
  return Math.atan2(cross, dot);
}

function rotationCost(from: Point[], to: Point[], angle: number): number {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let cost = 0;
  for (let i = 0; i < from.length; i++) {
    const rx = from[i].x * cos - from[i].y * sin;
    const ry = from[i].x * sin + from[i].y * cos;
    cost += (rx - to[i].x) ** 2 + (ry - to[i].y) ** 2;
  }
  return cost / from.length;
}

interface MatchResult {
  cost: number;
  reversed: boolean;
  angle: number;
}

function matchShapes(
  library: ShapeDescriptor,
  target: ShapeDescriptor,
  allowRotation: boolean,
): MatchResult {
  const reversedNormalized = [...library.normalized].reverse();
  let best: MatchResult = { cost: Infinity, reversed: false, angle: 0 };
  for (const [candidate, reversed] of [
    [library.normalized, false],
    [reversedNormalized, true],
  ] as const) {
    const angle = allowRotation
      ? optimalRotation(candidate, target.normalized)
      : 0;
    const cost = rotationCost(candidate, target.normalized, angle);
    if (cost < best.cost) best = { cost, reversed, angle };
  }
  return best;
}

function makeTrail(points: Point[], color: string, id: string): Trail {
  return {
    points: points.map((p, index) => ({ x: p.x, y: p.y, ts: index })),
    color,
    opacity: 1,
    id,
    startTime: 0,
    endTime: Math.max(1, points.length - 1),
    clicks: [],
  };
}

/** Mosaic mode: for each target stroke, pick the real gesture whose shape is
 * closest (translate + uniform scale, optional rotation, never bent) and place
 * it over the stroke. Longest strokes choose first; gestures aren't reused
 * until the library runs dry. */
export function mosaicTrails(
  targetStrokes: Point[][],
  library: LibraryItem[],
  allowRotation: boolean,
): Trail[] {
  const libraryShapes = library
    .map((item) => ({ item, shape: describeShape(item.points) }))
    .filter(
      (entry): entry is { item: LibraryItem; shape: ShapeDescriptor } =>
        entry.shape !== null,
    );
  if (libraryShapes.length === 0) return [];

  const used = new Set<number>();
  const trails: Trail[] = [];

  targetStrokes.forEach((stroke, strokeIndex) => {
    const target = describeShape(stroke);
    if (!target) return;

    if (used.size === libraryShapes.length) used.clear();

    let bestIndex = -1;
    let bestMatch: MatchResult = { cost: Infinity, reversed: false, angle: 0 };
    for (let i = 0; i < libraryShapes.length; i++) {
      if (used.has(i)) continue;
      const match = matchShapes(libraryShapes[i].shape, target, allowRotation);
      if (match.cost < bestMatch.cost) {
        bestMatch = match;
        bestIndex = i;
      }
    }
    if (bestIndex === -1) return;
    used.add(bestIndex);

    const { item, shape } = libraryShapes[bestIndex];
    const sourcePoints = bestMatch.reversed
      ? [...item.points].reverse()
      : item.points;
    const cos = Math.cos(bestMatch.angle);
    const sin = Math.sin(bestMatch.angle);

    const placed = sourcePoints.map((p) => {
      const dx = (p.x - shape.centroid.x) / shape.scale;
      const dy = (p.y - shape.centroid.y) / shape.scale;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      return {
        x: target.centroid.x + rx * target.scale,
        y: target.centroid.y + ry * target.scale,
      };
    });

    trails.push(makeTrail(placed, item.color, `mosaic-${strokeIndex}`));
  });

  return trails;
}

function smoothPoints(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    out.push({
      x: (points[i - 1].x + points[i].x + points[i + 1].x) / 3,
      y: (points[i - 1].y + points[i].y + points[i + 1].y) / 3,
    });
  }
  out.push(points[points.length - 1]);
  return out;
}

const IN_PLACE_MIN_RUN_POINTS = 4;

/** In-place mode: nothing is moved or bent. Trails stay exactly where they
 * happened; only the runs of consecutive points falling inside the image's
 * dilated edge corridor are kept, so the image emerges purely from movement
 * that really passed through those places. Fidelity is limited by how much
 * of the pool happens to overlap the image. */
export function inPlaceTrails(
  trails: LibraryItem[],
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  toImagePoint: (p: Point) => Point,
  maxStrokes: number,
): Trail[] {
  const isInside = (p: Point): boolean => {
    const ip = toImagePoint(p);
    const ix = Math.round(ip.x);
    const iy = Math.round(ip.y);
    return (
      ix >= 0 &&
      iy >= 0 &&
      ix < maskWidth &&
      iy < maskHeight &&
      mask[iy * maskWidth + ix] === 1
    );
  };

  // Archived points are sparsely sampled, so two consecutive in-corridor
  // points can chord straight across the image interior (both ends on the
  // rim, line through the middle). A run only continues if the segment
  // between the points stays inside too.
  const segmentInside = (a: Point, b: Point): boolean => {
    for (const t of [0.25, 0.5, 0.75]) {
      if (!isInside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }))
        return false;
    }
    return true;
  };

  const segments: Array<{ points: Point[]; color: string }> = [];

  for (const trail of trails) {
    let run: Point[] = [];
    const flush = () => {
      if (run.length >= IN_PLACE_MIN_RUN_POINTS) {
        segments.push({ points: run, color: trail.color });
      }
      run = [];
    };
    for (const p of trail.points) {
      if (!isInside(p)) {
        flush();
        continue;
      }
      if (run.length > 0 && !segmentInside(run[run.length - 1], p)) {
        flush();
      }
      run.push(p);
    }
    flush();
  }

  segments.sort((a, b) => pathLength(b.points) - pathLength(a.points));
  return segments
    .slice(0, maxStrokes)
    .map((segment, index) =>
      makeTrail(segment.points, segment.color, `inplace-${index}`),
    );
}

function pathLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  }
  return length;
}

/** Warp mode: assign one real gesture per target stroke (paired by length
 * rank — long strokes get long gestures), rigidly place it over the stroke,
 * then bend each point toward its arc-position twin on the stroke (point i of
 * the gesture pulls toward the same fractional position along the stroke, so
 * the gesture morphs smoothly instead of snapping to whichever stroke point
 * is nearest). Strength 0 shows the raw placed gestures; 1 traces the image
 * exactly. */
export function warpTrails(
  targetStrokes: Point[][],
  library: LibraryItem[],
  strength: number,
): Trail[] {
  if (library.length === 0) return [];

  // Both lists ordered longest-first so rank pairing matches lengths.
  const byLength = library
    .map((item) => ({ item, length: pathLength(item.points) }))
    .sort((a, b) => b.length - a.length)
    .map((entry) => entry.item);

  const trails: Trail[] = [];
  targetStrokes.forEach((stroke, strokeIndex) => {
    const target = describeShape(stroke);
    if (!target) return;
    const item = byLength[strokeIndex % byLength.length];
    const shape = describeShape(item.points);
    if (!shape) return;

    const placed = item.points.map((p) => ({
      x:
        target.centroid.x +
        ((p.x - shape.centroid.x) / shape.scale) * target.scale,
      y:
        target.centroid.y +
        ((p.y - shape.centroid.y) / shape.scale) * target.scale,
    }));

    const strokeTwins = resampleUniform(stroke, placed.length);
    const bent = placed.map((p, i) => {
      const twin = strokeTwins[Math.min(i, strokeTwins.length - 1)];
      return {
        x: p.x + (twin.x - p.x) * strength,
        y: p.y + (twin.y - p.y) * strength,
      };
    });

    trails.push(
      makeTrail(smoothPoints(bent), item.color, `warp-${strokeIndex}`),
    );
  });

  return trails;
}
