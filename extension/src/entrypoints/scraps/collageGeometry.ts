// ABOUTME: Geometry for placing, resizing, rotating, and cropping collage pieces.
// ABOUTME: Pure math shared by the collage studio surface and the PNG bake.

/** A rectangle expressed as 0..1 fractions of a piece's source box. */
export interface CropFraction {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PieceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const FULL_CROP: CropFraction = { x: 0, y: 0, width: 1, height: 1 };

/** Smallest side a piece is allowed to shrink to, in frame units. */
export const MIN_PIECE_SIDE = 12;

export type ResizeCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    throw new Error("clamp received NaN");
  }
  return Math.min(max, Math.max(min, value));
}

export function isFullCrop(crop: CropFraction): boolean {
  return (
    crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1
  );
}

/**
 * Rotates a point around a center by `radians`. Used to convert between the
 * frame's axes and a rotated piece's own axes.
 */
export function rotatePoint(
  point: Point,
  center: Point,
  radians: number,
): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function boxCenter(box: PieceBox): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Maps a frame-space point into the unrotated local space of a piece, where
 * (0,0) is the piece's top-left corner and (width,height) its bottom-right.
 */
export function toLocalPoint(
  point: Point,
  box: PieceBox,
  rotationDegrees: number,
): Point {
  const center = boxCenter(box);
  const unrotated = rotatePoint(point, center, (-rotationDegrees * Math.PI) / 180);
  return { x: unrotated.x - box.x, y: unrotated.y - box.y };
}

/**
 * Resizes a box by dragging one corner, keeping the opposite corner pinned in
 * frame space so a rotated piece grows along its own axes. With `keepAspect`
 * the drag is projected onto the box's starting aspect ratio.
 */
export function resizeFromCorner(options: {
  box: PieceBox;
  rotationDegrees: number;
  corner: ResizeCorner;
  pointer: Point;
  keepAspect: boolean;
}): PieceBox {
  const { box, rotationDegrees, corner, pointer, keepAspect } = options;
  const radians = (rotationDegrees * Math.PI) / 180;
  const center = boxCenter(box);
  const local = rotatePoint(pointer, center, -radians);

  const anchorX = corner === "top-left" || corner === "bottom-left"
    ? box.x + box.width
    : box.x;
  const anchorY = corner === "top-left" || corner === "top-right"
    ? box.y + box.height
    : box.y;

  let width = Math.abs(local.x - anchorX);
  let height = Math.abs(local.y - anchorY);

  if (keepAspect) {
    const aspect = box.width / box.height;
    if (width / height > aspect) {
      height = width / aspect;
    } else {
      width = height * aspect;
    }
  }

  width = Math.max(MIN_PIECE_SIDE, width);
  height = Math.max(MIN_PIECE_SIDE, height);

  const signX = corner === "top-left" || corner === "bottom-left" ? -1 : 1;
  const signY = corner === "top-left" || corner === "top-right" ? -1 : 1;
  const nextLocal: PieceBox = {
    x: signX === 1 ? anchorX : anchorX - width,
    y: signY === 1 ? anchorY : anchorY - height,
    width,
    height,
  };

  // The box rotates about its own center, so moving a corner moves the center;
  // re-anchor so the pinned corner lands back where the user left it.
  const pinnedBefore = rotatePoint(
    { x: anchorX, y: anchorY },
    center,
    radians,
  );
  const nextCenter = boxCenter(nextLocal);
  const pinnedAfter = rotatePoint(
    { x: anchorX, y: anchorY },
    nextCenter,
    radians,
  );

  return {
    ...nextLocal,
    x: nextLocal.x + (pinnedBefore.x - pinnedAfter.x),
    y: nextLocal.y + (pinnedBefore.y - pinnedAfter.y),
  };
}

/** Angle in degrees from a box's center to a pointer, with 0 pointing up. */
export function rotationToPointer(box: PieceBox, pointer: Point): number {
  const center = boxCenter(box);
  const degrees =
    (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI +
    90;
  return normalizeDegrees(degrees);
}

export function normalizeDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  if (wrapped < 0) return wrapped + 360;
  // A rotation of negative zero reads as a tiny leftward turn downstream, so
  // it settles to plain zero.
  return wrapped === 0 ? 0 : wrapped;
}

/** Rounds a rotation to the nearest `step` degrees, for shift-constrained drags. */
export function snapDegrees(degrees: number, step: number): number {
  if (step <= 0) throw new Error("snapDegrees requires a positive step");
  return normalizeDegrees(Math.round(degrees / step) * step);
}

/**
 * Builds a crop from a drag inside a piece's local box. The result is clamped
 * to the piece and expressed as 0..1 fractions of its source box.
 */
export function cropFromLocalDrag(
  start: Point,
  end: Point,
  box: PieceBox,
): CropFraction {
  const left = clamp(Math.min(start.x, end.x), 0, box.width);
  const right = clamp(Math.max(start.x, end.x), 0, box.width);
  const top = clamp(Math.min(start.y, end.y), 0, box.height);
  const bottom = clamp(Math.max(start.y, end.y), 0, box.height);
  return {
    x: left / box.width,
    y: top / box.height,
    width: Math.max((right - left) / box.width, 0),
    height: Math.max((bottom - top) / box.height, 0),
  };
}

/**
 * Composes a new crop drawn inside an already-cropped piece back onto the
 * source box, so successive crops keep referring to the original material.
 */
export function composeCrop(
  outer: CropFraction,
  inner: CropFraction,
): CropFraction {
  return {
    x: outer.x + inner.x * outer.width,
    y: outer.y + inner.y * outer.height,
    width: inner.width * outer.width,
    height: inner.height * outer.height,
  };
}

/** Whether a crop selection is big enough to be worth applying. */
export function isUsableCrop(crop: CropFraction): boolean {
  return crop.width > 0.02 && crop.height > 0.02;
}

/**
 * The piece's full source box, recovered from its visible (cropped) box. The
 * studio and the bake both draw the whole source and clip it to the crop.
 */
export function sourceBoxForCrop(
  visible: PieceBox,
  crop: CropFraction,
): PieceBox {
  if (crop.width <= 0 || crop.height <= 0) {
    throw new Error("sourceBoxForCrop received a crop with no area");
  }
  const width = visible.width / crop.width;
  const height = visible.height / crop.height;
  return {
    x: visible.x - crop.x * width,
    y: visible.y - crop.y * height,
    width,
    height,
  };
}

/**
 * Scales a source of `naturalWidth` x `naturalHeight` so its longest side is
 * `maxSide`, keeping its aspect ratio. This is the size a freshly placed piece
 * takes: small icons come up big enough to handle, large photos come down.
 */
export function fitWithin(
  naturalWidth: number,
  naturalHeight: number,
  maxSide: number,
): { width: number; height: number } {
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    throw new Error("fitWithin requires positive natural dimensions");
  }
  const scale = maxSide / Math.max(naturalWidth, naturalHeight);
  return {
    width: Math.max(MIN_PIECE_SIDE, naturalWidth * scale),
    height: Math.max(MIN_PIECE_SIDE, naturalHeight * scale),
  };
}

/** Scale that fits a frame into an available viewport area, never above 1. */
export function frameScale(
  frame: { width: number; height: number },
  available: { width: number; height: number },
): number {
  if (available.width <= 0 || available.height <= 0) return 1;
  return Math.min(
    1,
    available.width / frame.width,
    available.height / frame.height,
  );
}
