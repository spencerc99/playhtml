// ABOUTME: Geometry for several collage pieces handled at once: bounds, scale, turn, mirror.
// ABOUTME: Also the marquee hit-test, so an area drag picks what the eye sees inside it.

import {
  MIN_PIECE_SIDE,
  boxCenter,
  normalizeDegrees,
  rotatePoint,
  isSideEdge,
  signedCornerScale,
  type BoxEdge,
  type Bounds,
  type PieceBox,
  type Point,
  type ResizeCorner,
} from "./collageGeometry";

/** A piece's box as it sits in the frame: its size, place and turn. */
export type PlacedBox = PieceBox & { rotation: number };

/** The four corners of a turned box in frame space, clockwise from top-left. */
export function turnedCorners(box: PlacedBox): Point[] {
  const center = boxCenter(box);
  const radians = (box.rotation * Math.PI) / 180;
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ].map((corner) => rotatePoint(corner, center, radians));
}

/** The upright rectangle that holds every point given. */
function boundsOfPoints(points: readonly Point[]): Bounds {
  if (points.length === 0) {
    throw new Error("boundsOfPoints needs at least one point");
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The upright box around a set of pieces, turned corners included, which is
 * the box a group's handles are drawn on.
 */
export function groupBounds(pieces: readonly PlacedBox[]): Bounds {
  if (pieces.length === 0) {
    throw new Error("groupBounds needs at least one piece");
  }
  return boundsOfPoints(pieces.flatMap(turnedCorners));
}

/** The rectangle two points span, whichever way the drag went. */
export function rectBetween(a: Point, b: Point): Bounds {
  return boundsOfPoints([a, b]);
}

/** The two axes a turned box's edges run along, as unit vectors. */
function edgeAxes(box: PlacedBox): Point[] {
  const radians = (box.rotation * Math.PI) / 180;
  return [
    { x: Math.cos(radians), y: Math.sin(radians) },
    { x: -Math.sin(radians), y: Math.cos(radians) },
  ];
}

function projection(points: readonly Point[], axis: Point): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    const along = point.x * axis.x + point.y * axis.y;
    min = Math.min(min, along);
    max = Math.max(max, along);
  }
  return [min, max];
}

/**
 * Whether a turned piece and an upright rectangle share any area. Two convex
 * shapes are apart exactly when some edge direction separates them, so the
 * four edge directions of the pair are all that need checking.
 */
export function boxMeetsRect(box: PlacedBox, rect: Bounds): boolean {
  const boxPoints = turnedCorners(box);
  const rectPoints: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  const axes: Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, ...edgeAxes(box)];
  return axes.every((axis) => {
    const [boxMin, boxMax] = projection(boxPoints, axis);
    const [rectMin, rectMax] = projection(rectPoints, axis);
    return boxMax >= rectMin && rectMax >= boxMin;
  });
}

/** The pieces a marquee touches, in the order they were given. */
export function piecesInRect<T extends PlacedBox>(
  pieces: readonly T[],
  rect: Bounds,
): T[] {
  return pieces.filter((piece) => boxMeetsRect(piece, rect));
}

/**
 * A group scale: every point moves away from `anchor` by `x` and `y`. A
 * negative factor carries points across the anchor, mirroring the group.
 */
export interface GroupScale {
  anchor: Point;
  x: number;
  y: number;
}

/**
 * The smallest a corner drag may shrink a group to, as a share of its size,
 * on either side of the anchor.
 */
export const MIN_GROUP_FACTOR = 0.05;

function boundsCorner(bounds: Bounds, corner: ResizeCorner): Point {
  return {
    x: corner === "top-left" || corner === "bottom-left"
      ? bounds.x
      : bounds.x + bounds.width,
    y: corner === "top-left" || corner === "top-right"
      ? bounds.y
      : bounds.y + bounds.height,
  };
}

function oppositeCorner(corner: ResizeCorner): ResizeCorner {
  switch (corner) {
    case "top-left":
      return "bottom-right";
    case "top-right":
      return "bottom-left";
    case "bottom-left":
      return "top-right";
    case "bottom-right":
      return "top-left";
  }
}

/**
 * The scale a corner drag on a group's box asks for. The opposite corner
 * stays put, or the center does with `aboutCenter`. With `keepAspect` both
 * axes take the larger of the two stretches, as a single piece's corner does.
 * A drag carried past the anchor turns the group over across that axis
 * (see signedCornerScale).
 */
export function groupScaleFromCorner(options: {
  bounds: Bounds;
  corner: ResizeCorner;
  pointer: Point;
  keepAspect: boolean;
  aboutCenter: boolean;
}): GroupScale {
  const { bounds, corner, pointer, keepAspect, aboutCenter } = options;
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error("groupScaleFromCorner needs a group with area");
  }
  const anchor = aboutCenter
    ? boxCenter(bounds)
    : boundsCorner(bounds, oppositeCorner(corner));
  const grabbed = boundsCorner(bounds, corner);
  const scale = signedCornerScale({
    anchor,
    grabbed,
    pointer,
    keepAspect,
    minimum: { x: MIN_GROUP_FACTOR, y: MIN_GROUP_FACTOR },
  });
  return { anchor, ...scale };
}

/**
 * The scale an edge drag on a group's box asks for. The opposite edge stays
 * put, or the center does with `aboutCenter`. With `keepAspect` the group
 * scales evenly about the middle of that edge; without it the group
 * stretches along the one axis. Carried past the anchor, it turns over.
 */
export function groupScaleFromEdge(options: {
  bounds: Bounds;
  edge: BoxEdge;
  pointer: Point;
  keepAspect: boolean;
  aboutCenter: boolean;
}): GroupScale {
  const { bounds, edge, pointer, keepAspect, aboutCenter } = options;
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error("groupScaleFromEdge needs a group with area");
  }
  const center = boxCenter(bounds);
  const side = isSideEdge(edge);
  const grabbed =
    edge === "left"
      ? bounds.x
      : edge === "right"
        ? bounds.x + bounds.width
        : edge === "top"
          ? bounds.y
          : bounds.y + bounds.height;
  const opposite = side
    ? (edge === "left" ? bounds.x + bounds.width : bounds.x)
    : (edge === "top" ? bounds.y + bounds.height : bounds.y);
  const fixed = aboutCenter ? (side ? center.x : center.y) : opposite;
  const raw = ((side ? pointer.x : pointer.y) - fixed) / (grabbed - fixed);
  const along = (raw < 0 ? -1 : 1) * Math.max(MIN_GROUP_FACTOR, Math.abs(raw));
  const cross = keepAspect ? Math.abs(along) : 1;
  return side
    ? { anchor: { x: fixed, y: center.y }, x: along, y: cross }
    : { anchor: { x: center.x, y: fixed }, x: cross, y: along };
}

/**
 * Scales every piece about the group's anchor: each center moves with the
 * scale, and each piece grows along its own turned axes by however much the
 * scale stretches that axis. An even scale is exact; an uneven one on a turned
 * piece keeps the piece a rectangle, which is as close as a box can come.
 * A negative factor mirrors the group as mirrorGroup does: centers cross the
 * anchor, and each piece's material flips across that axis with its turn
 * reversed.
 */
export function scaleGroup<T extends FlippableBox>(
  pieces: readonly T[],
  scale: GroupScale,
): T[] {
  return pieces.map((piece) => {
    const center = boxCenter(piece);
    const radians = (piece.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const width = Math.max(
      MIN_PIECE_SIDE,
      piece.width * Math.hypot(scale.x * cos, scale.y * sin),
    );
    const height = Math.max(
      MIN_PIECE_SIDE,
      piece.height * Math.hypot(scale.x * sin, scale.y * cos),
    );
    const next = {
      x: scale.anchor.x + (center.x - scale.anchor.x) * scale.x,
      y: scale.anchor.y + (center.y - scale.anchor.y) * scale.y,
    };
    const acrossX = scale.x < 0;
    const acrossY = scale.y < 0;
    // One mirror reverses a turn; two mirrors make a half turn, which the
    // two flipped materials already show, so the turn stands.
    const rotation =
      acrossX !== acrossY ? normalizeDegrees(-piece.rotation) : piece.rotation;
    return {
      ...piece,
      x: next.x - width / 2,
      y: next.y - height / 2,
      width,
      height,
      rotation,
      flipX: acrossX ? !piece.flipX : piece.flipX,
      flipY: acrossY ? !piece.flipY : piece.flipY,
    };
  });
}

/**
 * Turns every piece about a shared center: each piece's center orbits it and
 * the piece's own turn adds the same amount.
 */
export function rotateGroup<T extends PlacedBox>(
  pieces: readonly T[],
  center: Point,
  degrees: number,
): T[] {
  const radians = (degrees * Math.PI) / 180;
  return pieces.map((piece) => {
    const moved = rotatePoint(boxCenter(piece), center, radians);
    return {
      ...piece,
      x: moved.x - piece.width / 2,
      y: moved.y - piece.height / 2,
      rotation: normalizeDegrees(piece.rotation + degrees),
    };
  });
}

/** The angle from a center to a point in degrees, with 0 pointing right. */
export function angleAbout(center: Point, point: Point): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

/** Moves every piece by the same amount. */
export function translateGroup<T extends PieceBox>(
  pieces: readonly T[],
  dx: number,
  dy: number,
): T[] {
  return pieces.map((piece) => ({ ...piece, x: piece.x + dx, y: piece.y + dy }));
}

/** A placed box that can be mirrored: its material flips inside the box. */
export type FlippableBox = PlacedBox & { flipX: boolean; flipY: boolean };

/**
 * Mirrors a group across the middle of its bounds, as a mirror held to the
 * whole arrangement would show it: each piece's center crosses to the other
 * side, its turn runs the other way, and its material flips. "x" mirrors left
 * to right, "y" top to bottom.
 */
export function mirrorGroup<T extends FlippableBox>(
  pieces: readonly T[],
  axis: "x" | "y",
): T[] {
  if (pieces.length === 0) return [];
  const middle = boxCenter(groupBounds(pieces));
  return pieces.map((piece) => {
    const center = boxCenter(piece);
    const next =
      axis === "x"
        ? { x: 2 * middle.x - center.x, y: center.y }
        : { x: center.x, y: 2 * middle.y - center.y };
    return {
      ...piece,
      x: next.x - piece.width / 2,
      y: next.y - piece.height / 2,
      rotation: normalizeDegrees(-piece.rotation),
      flipX: axis === "x" ? !piece.flipX : piece.flipX,
      flipY: axis === "y" ? !piece.flipY : piece.flipY,
    };
  });
}
