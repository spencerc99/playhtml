// ABOUTME: Shape of a saved scrap collage, its pieces, and its provenance list.
// ABOUTME: Converts between the in-memory studio state and the stored record.

import type { ScrapItem } from "@movement/components/ScrapCollage";
import type { CropFraction } from "./collageGeometry";
import {
  FULL_CROP,
  boxForInnerRect,
  composeCrop,
  rotatePoint,
  sourceBoxForCrop,
} from "./collageGeometry";
import { parseCutout, type PieceCutout } from "./backgroundCutout";
import {
  isCollageFormatName,
  parsePaper,
  type CollageFormatName,
  type CollagePaper,
} from "./collageFormats";

export interface CollageFrame {
  width: number;
  height: number;
}

/**
 * A scrap copied into the collage so it still redraws and still names where it
 * came from once the scrap itself has been pruned or deduped away.
 */
export type ScrapSnapshot = ScrapItem;

export interface CollagePiece {
  id: string;
  scrapId: string;
  scrap: ScrapSnapshot;
  /** Visible box in frame coordinates, after the crop is applied. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
  crop: CropFraction;
  /** Mirrors what is shown inside the piece's box, leaving the box alone. */
  flipX: boolean;
  flipY: boolean;
  /** How this piece's backdrop was removed, absent when it was left alone. */
  cutout?: PieceCutout;
}

export interface CollageRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  frame: CollageFrame;
  /** Which named size the frame is, so the studio can name it back. */
  format: CollageFormatName;
  paper: CollagePaper;
  pieces: CollagePiece[];
  /**
   * The baked picture of this collage, or an explicit note that it has not
   * been drawn yet. A collage is stored the moment its arrangement changes,
   * which can be before a bake has ever succeeded, and the absence is said
   * out loud rather than left as a missing field.
   */
  preview: CollagePreview;
}

export type CollagePreview =
  | { drawn: true; image: Blob }
  | { drawn: false; reason: string };

/** A stored row that could not be read, listed so it can still be deleted. */
export interface UnreadableCollage {
  unreadable: true;
  id: string;
  title: string;
  updatedAt: number;
  reason: string;
}

export type CollageEntry = CollageSummary | UnreadableCollage;

export function isUnreadable(entry: CollageEntry): entry is UnreadableCollage {
  return "unreadable" in entry;
}

/** One source page a collage drew material from. */
export interface CollageProvenance {
  pageUrl: string;
  domain: string;
  pageTitle: string;
  firstSeenAt: number;
  pieceCount: number;
  /** The page's favicon as it was stored with a scrap, when one was. */
  faviconUrl?: string;
}

export interface CollageSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pieceCount: number;
  /** Every distinct page its pieces came from, for counting across collages. */
  sourcePages: string[];
  paper: CollagePaper;
  preview: CollagePreview;
}

export function createPieceId(): string {
  return `piece_${crypto.randomUUID()}`;
}

export function createCollageId(): string {
  return `collage_${crypto.randomUUID()}`;
}

/** What a copy is called when the collage it came from had no name. */
const UNTITLED_COPY = "untitled collage copy";

/**
 * A separate collage holding the same arrangement. Every piece is copied with
 * an id of its own, so editing the copy cannot reach back into the original,
 * and the two records share nothing.
 *
 * The preview comes across as it is: the arrangement is identical, so the
 * picture already drawn for it is the right one and nothing is re-baked.
 */
export function duplicateCollage(
  record: CollageRecord,
  now: number = Date.now(),
): CollageRecord {
  return {
    id: createCollageId(),
    title: record.title.trim() ? `${record.title.trim()} copy` : UNTITLED_COPY,
    createdAt: now,
    updatedAt: now,
    frame: { ...record.frame },
    format: record.format,
    paper: { ...record.paper },
    pieces: record.pieces.map((piece) => ({
      ...piece,
      id: createPieceId(),
      crop: { ...piece.crop },
      // The scrap snapshot is the material itself, never edited in place, so
      // both collages may point at the one copy of it.
      ...(piece.cutout ? { cutout: { ...piece.cutout } } : {}),
    })),
    preview: record.preview.drawn
      ? { drawn: true, image: record.preview.image }
      : { drawn: false, reason: record.preview.reason },
  };
}

/**
 * Source pages behind a collage, one entry per page, oldest first. A page that
 * contributed several pieces is listed once with its piece count.
 */
export function collageProvenance(
  pieces: readonly CollagePiece[],
): CollageProvenance[] {
  const byPage = new Map<string, CollageProvenance>();
  for (const piece of pieces) {
    const { pageUrl, domain, pageTitle, ts, faviconUrl } = piece.scrap;
    const existing = byPage.get(pageUrl);
    if (existing) {
      existing.pieceCount += 1;
      existing.firstSeenAt = Math.min(existing.firstSeenAt, ts);
      if (!existing.pageTitle && pageTitle) existing.pageTitle = pageTitle;
      if (!existing.faviconUrl && faviconUrl) existing.faviconUrl = faviconUrl;
      continue;
    }
    byPage.set(pageUrl, {
      pageUrl,
      domain,
      pageTitle,
      firstSeenAt: ts,
      pieceCount: 1,
      ...(faviconUrl ? { faviconUrl } : {}),
    });
  }
  return [...byPage.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt);
}

/**
 * A structured clone out of IndexedDB can carry a Blob whose prototype belongs
 * to another realm, so the preview is recognized by what it offers rather than
 * by `instanceof`.
 */
function isBlobLike(value: unknown): value is Blob {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Blob>;
  return (
    typeof candidate.size === "number" &&
    typeof candidate.type === "string" &&
    typeof candidate.slice === "function"
  );
}

function readCrop(value: unknown): CropFraction {
  if (!value || typeof value !== "object") return { ...FULL_CROP };
  const crop = value as Record<string, unknown>;
  const numbers = ["x", "y", "width", "height"] as const;
  for (const key of numbers) {
    if (typeof crop[key] !== "number" || !Number.isFinite(crop[key])) {
      throw new Error(`Collage piece crop is missing a numeric ${key}`);
    }
  }
  return {
    x: crop.x as number,
    y: crop.y as number,
    width: crop.width as number,
    height: crop.height as number,
  };
}

function readNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Collage piece is missing a numeric ${key}`);
  }
  return value;
}

function readBoolean(source: Record<string, unknown>, key: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") {
    throw new Error(`Collage piece is missing a boolean ${key}`);
  }
  return value;
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Collage piece is missing ${key}`);
  }
  return value;
}

export function parseCollagePiece(value: unknown): CollagePiece {
  if (!value || typeof value !== "object") {
    throw new Error("Collage piece is not an object");
  }
  const piece = value as Record<string, unknown>;
  const scrap = piece.scrap;
  if (!scrap || typeof scrap !== "object") {
    throw new Error("Collage piece is missing its scrap snapshot");
  }
  return {
    id: readString(piece, "id"),
    scrapId: readString(piece, "scrapId"),
    scrap: scrap as ScrapSnapshot,
    x: readNumber(piece, "x"),
    y: readNumber(piece, "y"),
    width: readNumber(piece, "width"),
    height: readNumber(piece, "height"),
    rotation: readNumber(piece, "rotation"),
    z: readNumber(piece, "z"),
    crop: readCrop(piece.crop),
    flipX: readBoolean(piece, "flipX"),
    flipY: readBoolean(piece, "flipY"),
    // Collages saved before cutouts existed simply have no field to read.
    ...(piece.cutout === undefined ? {} : { cutout: parseCutout(piece.cutout) }),
  };
}

export function parseCollageRecord(value: unknown): CollageRecord {
  if (!value || typeof value !== "object") {
    throw new Error("Collage record is not an object");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.pieces)) {
    throw new Error("Collage record is missing its pieces");
  }
  const frame = record.frame;
  if (!frame || typeof frame !== "object") {
    throw new Error("Collage record is missing its frame");
  }
  const preview = readPreview(record.preview);
  return {
    id: readString(record, "id"),
    title: typeof record.title === "string" ? record.title : "",
    createdAt: readNumber(record, "createdAt"),
    updatedAt: readNumber(record, "updatedAt"),
    frame: {
      width: readNumber(frame as Record<string, unknown>, "width"),
      height: readNumber(frame as Record<string, unknown>, "height"),
    },
    format: readFormatName(record.format),
    paper: parsePaper(record.paper),
    pieces: record.pieces.map(parseCollagePiece),
    preview,
  };
}

function readFormatName(value: unknown): CollageFormatName {
  if (!isCollageFormatName(value)) {
    throw new Error(`Collage record has an unknown format: ${String(value)}`);
  }
  return value;
}

function readPreview(value: unknown): CollagePreview {
  if (isBlobLike(value)) {
    // A collage stored before previews could be absent carries the bare blob.
    return { drawn: true, image: value };
  }
  if (!value || typeof value !== "object") {
    throw new Error("Collage record is missing its preview");
  }
  const preview = value as Record<string, unknown>;
  if (preview.drawn === true) {
    if (!isBlobLike(preview.image)) {
      throw new Error("Collage preview says it is drawn but carries no image");
    }
    return { drawn: true, image: preview.image };
  }
  if (preview.drawn === false) {
    if (typeof preview.reason !== "string") {
      throw new Error("An undrawn collage preview must say why");
    }
    return { drawn: false, reason: preview.reason };
  }
  throw new Error("Collage record is missing its preview");
}

export function summarizeCollage(record: CollageRecord): CollageSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    pieceCount: record.pieces.length,
    sourcePages: collageProvenance(record.pieces).map(
      (source) => source.pageUrl,
    ),
    paper: record.paper,
    preview: record.preview,
  };
}

/**
 * Trims a piece to a rectangle drawn inside it. The visible box shrinks to what
 * was kept and the crop composes onto the source, so the piece still refers to
 * the original material and a later crop can be drawn inside this one.
 */
export function applyCrop(
  piece: CollagePiece,
  inner: CropFraction,
): CollagePiece {
  return {
    ...piece,
    ...boxForInnerRect(piece, inner, piece.rotation),
    crop: composeCrop(piece.crop, inner),
  };
}

/**
 * Applies a crop drawn against the piece's whole source box, which is what a
 * crop session edits. `applyCrop` takes a rectangle inside the piece's visible
 * box; this takes one inside the source, so the two are not interchangeable.
 */
export function composeCropOnto(
  piece: CollagePiece,
  fromSource: CropFraction,
): CollagePiece {
  const source = sourceBoxForCrop(piece, piece.crop);
  const box = {
    x: source.x + fromSource.x * source.width,
    y: source.y + fromSource.y * source.height,
    width: source.width * fromSource.width,
    height: source.height * fromSource.height,
  };
  const before = rotatePoint(
    { x: box.x, y: box.y },
    { x: source.x + source.width / 2, y: source.y + source.height / 2 },
    (piece.rotation * Math.PI) / 180,
  );
  const after = rotatePoint(
    { x: box.x, y: box.y },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    (piece.rotation * Math.PI) / 180,
  );
  return {
    ...piece,
    x: box.x + (before.x - after.x),
    y: box.y + (before.y - after.y),
    width: box.width,
    height: box.height,
    crop: fromSource,
  };
}

/** Mirrors what a piece shows, leaving its box and its crop alone. */
export function flipPiece(
  piece: CollagePiece,
  axis: "x" | "y",
): CollagePiece {
  return axis === "x"
    ? { ...piece, flipX: !piece.flipX }
    : { ...piece, flipY: !piece.flipY };
}

/**
 * The CSS transform that draws a piece's material: the mirror happens inside
 * the box, so a flipped piece keeps its position, its rotation and the crop
 * window it was given.
 */
export function pieceMaterialTransform(piece: CollagePiece): string {
  const scaleX = piece.flipX ? -1 : 1;
  const scaleY = piece.flipY ? -1 : 1;
  return scaleX === 1 && scaleY === 1
    ? "none"
    : `scale(${scaleX}, ${scaleY})`;
}

/** Restores a cropped piece to its whole source, around the same center. */
export function clearCrop(piece: CollagePiece): CollagePiece {
  if (piece.crop.width <= 0 || piece.crop.height <= 0) {
    throw new Error("Cannot restore a piece whose crop has no area");
  }
  const width = piece.width / piece.crop.width;
  const height = piece.height / piece.crop.height;
  return {
    ...piece,
    x: piece.x + piece.width / 2 - width / 2,
    y: piece.y + piece.height / 2 - height / 2,
    width,
    height,
    crop: { ...FULL_CROP },
  };
}

/** Reassigns z so the stack is a dense 0..n-1 run in its current order. */
export function normalizeStack(pieces: readonly CollagePiece[]): CollagePiece[] {
  return [...pieces]
    .sort((a, b) => a.z - b.z)
    .map((piece, index) => ({ ...piece, z: index }));
}

export function movePieceForward(
  pieces: readonly CollagePiece[],
  pieceId: string,
): CollagePiece[] {
  return swapWithNeighbor(pieces, pieceId, 1);
}

export function movePieceBackward(
  pieces: readonly CollagePiece[],
  pieceId: string,
): CollagePiece[] {
  return swapWithNeighbor(pieces, pieceId, -1);
}

export function movePieceToFront(
  pieces: readonly CollagePiece[],
  pieceId: string,
): CollagePiece[] {
  return liftToEnd(pieces, pieceId, "front");
}

export function movePieceToBack(
  pieces: readonly CollagePiece[],
  pieceId: string,
): CollagePiece[] {
  return liftToEnd(pieces, pieceId, "back");
}

function liftToEnd(
  pieces: readonly CollagePiece[],
  pieceId: string,
  end: "front" | "back",
): CollagePiece[] {
  const ordered = normalizeStack(pieces);
  const moving = ordered.find((piece) => piece.id === pieceId);
  if (!moving) throw new Error(`Collage has no piece ${pieceId}`);
  const rest = ordered.filter((piece) => piece.id !== pieceId);
  const stacked = end === "front" ? [...rest, moving] : [moving, ...rest];
  return stacked.map((piece, index) => ({ ...piece, z: index }));
}

function swapWithNeighbor(
  pieces: readonly CollagePiece[],
  pieceId: string,
  direction: 1 | -1,
): CollagePiece[] {
  const ordered = normalizeStack(pieces);
  const index = ordered.findIndex((piece) => piece.id === pieceId);
  if (index === -1) {
    throw new Error(`Collage has no piece ${pieceId}`);
  }
  const target = index + direction;
  if (target < 0 || target >= ordered.length) return ordered;
  const swapped = [...ordered];
  const moving = swapped[index];
  const neighbor = swapped[target];
  swapped[index] = { ...neighbor, z: index };
  swapped[target] = { ...moving, z: target };
  return swapped;
}
