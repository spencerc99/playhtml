// ABOUTME: Shape of a saved scrap collage, its pieces, and its provenance list.
// ABOUTME: Converts between the in-memory studio state and the stored record.

import type { ScrapItem } from "@movement/components/ScrapCollage";
import type { CropFraction } from "./collageGeometry";
import { FULL_CROP } from "./collageGeometry";

/** Logical coordinate space every saved collage is laid out in. */
export const COLLAGE_FRAME = { width: 1200, height: 800 } as const;

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
}

export interface CollageRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  frame: CollageFrame;
  pieces: CollagePiece[];
  preview: Blob;
}

/** One source page a collage drew material from. */
export interface CollageProvenance {
  pageUrl: string;
  domain: string;
  pageTitle: string;
  firstSeenAt: number;
  pieceCount: number;
}

export interface CollageSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pieceCount: number;
  preview: Blob;
}

export function createPieceId(): string {
  return `piece_${crypto.randomUUID()}`;
}

export function createCollageId(): string {
  return `collage_${crypto.randomUUID()}`;
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
    const { pageUrl, domain, pageTitle, ts } = piece.scrap;
    const existing = byPage.get(pageUrl);
    if (existing) {
      existing.pieceCount += 1;
      existing.firstSeenAt = Math.min(existing.firstSeenAt, ts);
      if (!existing.pageTitle && pageTitle) existing.pageTitle = pageTitle;
      continue;
    }
    byPage.set(pageUrl, {
      pageUrl,
      domain,
      pageTitle,
      firstSeenAt: ts,
      pieceCount: 1,
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
  const preview = record.preview;
  if (!isBlobLike(preview)) {
    throw new Error("Collage record is missing its baked preview");
  }
  return {
    id: readString(record, "id"),
    title: typeof record.title === "string" ? record.title : "",
    createdAt: readNumber(record, "createdAt"),
    updatedAt: readNumber(record, "updatedAt"),
    frame: {
      width: readNumber(frame as Record<string, unknown>, "width"),
      height: readNumber(frame as Record<string, unknown>, "height"),
    },
    pieces: record.pieces.map(parseCollagePiece),
    preview,
  };
}

export function summarizeCollage(record: CollageRecord): CollageSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    pieceCount: record.pieces.length,
    preview: record.preview,
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
