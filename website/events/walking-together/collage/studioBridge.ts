// ABOUTME: Translates between table pieces and the scrap studio's pieces, so the table reuses the studio's tools.
// ABOUTME: Table pieces are center-based fractions of the table; studio pieces are top-left pixels.

import type { CollagePiece } from "@extension/entrypoints/scraps/collageRecord";
import {
  FULL_CROP,
  type CropFraction,
} from "@extension/entrypoints/scraps/collageGeometry";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import type { PiecesChange } from "@extension/entrypoints/scraps/sharedCollage";
import {
  FALLBACK_ASPECT,
  pageLink,
  sortedPieces,
  sourceDomain,
  type Piece,
  type PieceTransform,
  type Pieces,
  type Placer,
} from "./pieces";
import type { SessionScrap } from "./scrapsBridge";

export interface TableSize {
  width: number;
  height: number;
}

/** The table piece as the studio sees it, at the table's current pixel size.
 * `transform` overrides the stored placement, for a gesture in progress. */
export function toStudioPiece(
  piece: Piece,
  size: TableSize,
  transform: PieceTransform = piece,
): CollagePiece {
  const width = transform.width * size.width;
  const height = width * piece.aspect;
  return {
    id: piece.id,
    scrapId: piece.id,
    scrap: {
      kind: "image",
      src: piece.src,
      alt: piece.alt,
      naturalWidth: 0,
      naturalHeight: 0,
      id: piece.id,
      key: piece.id,
      pageTitle: "",
      domain: sourceDomain(piece),
      pageUrl: piece.pageUrl,
      ts: piece.placedAt,
    },
    x: transform.x * size.width - width / 2,
    y: transform.y * size.height - height / 2,
    width,
    height,
    rotation: transform.rotation,
    z: piece.z,
    crop: piece.crop ?? FULL_CROP,
    flipX: !!piece.flipX,
    flipY: !!piece.flipY,
    ...(piece.cutout ? { cutout: piece.cutout } : {}),
    ...(piece.locked ? { locked: true as const } : {}),
  };
}

/** The placement fields a studio edit (such as a crop) changed, back in table
 * terms. */
export function placementFromStudio(
  studio: Pick<CollagePiece, "x" | "y" | "width" | "height" | "crop">,
  size: TableSize,
): Pick<Piece, "x" | "y" | "width" | "aspect"> & { crop: CropFraction } {
  return {
    x: (studio.x + studio.width / 2) / size.width,
    y: (studio.y + studio.height / 2) / size.height,
    width: studio.width / size.width,
    aspect: studio.height / studio.width,
    crop: { ...studio.crop },
  };
}

/**
 * The table's frame in the studio, in frame units. Pieces are stored as
 * fractions of it, so the size only sets the shape everyone shares.
 */
export const TABLE_FRAME: TableSize = { width: 1600, height: 1000 };

/** The table's pieces as the studio edits them, at the shared frame. */
export function studioPieces(pieces: Pieces): CollagePiece[] {
  return sortedPieces(pieces).map((piece) => toStudioPiece(piece, TABLE_FRAME));
}

/**
 * A studio piece back in table terms. A piece already on the table keeps who
 * placed it and when; a new one, such as a copy or a scrap from the drawer,
 * belongs to whoever made it. Optional fields are left out rather than set to
 * undefined, so shared data never holds an empty value.
 */
export function tablePiece(
  studio: CollagePiece,
  existing: Piece | undefined,
  placer: Placer,
  now: number,
): Piece {
  const placement = placementFromStudio(studio, TABLE_FRAME);
  const scrap = studio.scrap;
  const base: Piece = existing
    ? { ...existing }
    : {
        id: studio.id,
        src: scrap.kind === "image" ? scrap.src : "",
        pageUrl: pageLink(scrap.pageUrl),
        alt: scrap.kind === "image" ? scrap.alt ?? "" : "",
        placedByPid: placer.pid,
        placedByName: placer.name,
        placedByColor: placer.color,
        x: 0,
        y: 0,
        width: 0,
        aspect: FALLBACK_ASPECT,
        rotation: 0,
        z: 0,
        placedAt: now,
      };
  const { cutout: _cutout, locked: _locked, crop: _crop, ...rest } = base;
  return {
    ...rest,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    aspect: placement.aspect,
    rotation: studio.rotation,
    z: studio.z,
    flipX: studio.flipX,
    flipY: studio.flipY,
    ...(isWholeCrop(placement.crop) ? {} : { crop: placement.crop }),
    ...(studio.cutout ? { cutout: { ...studio.cutout } } : {}),
    ...(studio.locked ? { locked: true } : {}),
  } as Piece;
}

function isWholeCrop(crop: { x: number; y: number; width: number; height: number }) {
  return crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
}

/** The fields of a table piece one edit set, and the ones it took away. */
export interface PiecePatch {
  set: Partial<Piece>;
  unset: string[];
}

/** One person's studio edit, as the table pieces to write and the ids to drop. */
export function tableChange(
  change: PiecesChange,
  pieces: Pieces,
  placer: Placer,
  now: number,
): { write: Piece[]; remove: string[] } {
  return {
    write: change.upserts
      .filter((studio) => studio.scrap.kind === "image")
      .map((studio) => tablePiece(studio, pieces[studio.id], placer, now)),
    remove: change.removedIds.filter((id) => id in pieces),
  };
}

/**
 * What an edit changed on one table piece, found by laying out the piece as
 * it stood before the edit the same way as after it. A field the edit left
 * alone stays out of the patch, so writing the patch keeps whatever someone
 * else did to that field meanwhile.
 */
export function piecePatch(
  before: CollagePiece,
  after: CollagePiece,
  existing: Piece,
  placer: Placer,
  now: number,
): PiecePatch {
  const was = tablePiece(before, existing, placer, now) as unknown as Record<string, unknown>;
  const is = tablePiece(after, existing, placer, now) as unknown as Record<string, unknown>;
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(is)) {
    if (JSON.stringify(was[key]) !== JSON.stringify(value)) set[key] = value;
  }
  const unset = Object.keys(was).filter((key) => !(key in is));
  return { set: set as Partial<Piece>, unset };
}

/**
 * A scrap from this person's walk as the studio's drawer shows it, with the
 * page it came from so others can visit it once it is placed.
 */
export function sessionScrapItem(
  scrap: SessionScrap,
  size: { width: number; height: number } | null,
): ScrapItem {
  const width = size?.width ?? scrap.width ?? 400;
  const height = size?.height ?? scrap.height ?? 400 * FALLBACK_ASPECT;
  const pageUrl = pageLink(scrap.pageUrl);
  return {
    kind: "image",
    id: scrap.id,
    key: scrap.id,
    src: scrap.src,
    ...(scrap.alt ? { alt: scrap.alt } : {}),
    naturalWidth: width,
    naturalHeight: height,
    pageTitle: "",
    domain: sourceDomain({ pageUrl, src: scrap.src }),
    pageUrl,
    ts: scrap.capturedAt,
  };
}
