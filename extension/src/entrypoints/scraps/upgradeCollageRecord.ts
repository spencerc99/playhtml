// ABOUTME: Brings collages saved before later passes into the current shape.
// ABOUTME: Named upgrades of known earlier shapes, never a general filling-in of gaps.

import { DEFAULT_FORMAT, formatOf } from "./collageFormats";

/** The frame every collage was laid out in before formats existed. */
const EARLIER_FRAME = { width: 1200, height: 800 } as const;

/**
 * The paper color to give an upgraded collage.
 *
 * Before this pass the bake filled the canvas with this tone, so it is what
 * the saved thumbnail actually shows and what the collage has always been on,
 * whatever the studio drew behind it.
 */
const PAPER_BEFORE_FORMATS = "#faf9f6";

/**
 * The postcard is the same 3:2 shape as the frame collages used to have, so
 * every piece scales by one factor and the arrangement is unchanged.
 */
const PLACEMENT_SCALE =
  formatOf(DEFAULT_FORMAT).width / EARLIER_FRAME.width;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEarlierFrame(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    value.width === EARLIER_FRAME.width &&
    value.height === EARLIER_FRAME.height
  );
}

/**
 * Whether a stored row is a collage from before formats, paper and flips.
 *
 * It has to look like a collage in every other way and be missing exactly the
 * fields this shape predates. A row that is merely broken, or that carries an
 * unfamiliar frame or format, is not this shape and is left alone.
 */
export function isEarlierCollageShape(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.createdAt !== "number") return false;
  if (typeof value.updatedAt !== "number") return false;
  if (!Array.isArray(value.pieces)) return false;
  if (!isEarlierFrame(value.frame)) return false;
  // The fields this pass added must be absent, not merely wrong.
  if (value.format !== undefined || value.paper !== undefined) return false;
  return value.pieces.every(
    (piece) =>
      isPlainObject(piece) &&
      typeof piece.x === "number" &&
      typeof piece.y === "number" &&
      typeof piece.width === "number" &&
      typeof piece.height === "number" &&
      piece.flipX === undefined &&
      piece.flipY === undefined,
  );
}

/**
 * Rewrites an earlier collage into the current shape: the postcard format at
 * its true size, every placement scaled to match, and the paper it was always
 * made on. Rotation, stacking, crop fractions, cutout parameters and the
 * baked preview are carried across untouched, so the collage looks the same
 * and keeps the thumbnail it already had until it is saved again.
 */
export function upgradeEarlierCollage(value: unknown): unknown {
  if (!isEarlierCollageShape(value)) return value;
  const record = value as Record<string, unknown>;
  const format = formatOf(DEFAULT_FORMAT);

  return {
    ...record,
    frame: { width: format.width, height: format.height },
    format: format.name,
    paper: { color: PAPER_BEFORE_FORMATS },
    pieces: (record.pieces as Record<string, unknown>[]).map((piece) => ({
      ...piece,
      x: (piece.x as number) * PLACEMENT_SCALE,
      y: (piece.y as number) * PLACEMENT_SCALE,
      width: (piece.width as number) * PLACEMENT_SCALE,
      height: (piece.height as number) * PLACEMENT_SCALE,
      flipX: false,
      flipY: false,
    })),
  };
}

/**
 * Whether a stored row is a collage from before paper could carry the page's
 * grain. It is a current-shape record whose paper has a color but does not say
 * one way or the other about grain.
 */
export function isUngrainedCollageShape(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (!Array.isArray(value.pieces)) return false;
  if (!isPlainObject(value.paper)) return false;
  if (typeof value.paper.color !== "string") return false;
  return value.paper.grain === undefined;
}

/**
 * Says out loud that a collage saved before grain existed has none. Grain is
 * on for new collages, so without this an existing one would silently gain a
 * texture it was never made with.
 */
export function upgradeUngrainedCollage(value: unknown): unknown {
  if (!isUngrainedCollageShape(value)) return value;
  const record = value as Record<string, unknown>;
  const paper = record.paper as Record<string, unknown>;
  return { ...record, paper: { ...paper, grain: false } };
}

/**
 * Brings a collage from any earlier shape up to the current one. The upgrades
 * chain, because a collage old enough to predate formats also predates grain.
 * A collage already in the current shape is handed back as the same value.
 */
export function upgradeToCurrentShape(stored: unknown): unknown {
  const withFormats = isEarlierCollageShape(stored)
    ? upgradeEarlierCollage(stored)
    : stored;
  return isUngrainedCollageShape(withFormats)
    ? upgradeUngrainedCollage(withFormats)
    : withFormats;
}
