// ABOUTME: Converts collage pieces to tldraw shapes and assets for the tldraw studio prototype, and back.
// ABOUTME: Plain images become native image shapes; everything else becomes a scrap-piece shape.

import {
  AssetRecordType,
  createShapeId,
  getIndices,
  type IndexKey,
  type JsonObject,
  type TLAssetId,
  type TLImageAsset,
  type TLShapeCrop,
} from "tldraw";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import type { CollagePiece } from "../collageRecord";
import { createPieceId } from "../collageRecord";
import {
  FULL_CROP,
  fitWithin,
  isFullCrop,
  type CropFraction,
  type Point,
} from "../collageGeometry";
import { naturalScrapSize } from "../pieceLettering";
import { parseCutout, type PieceCutout } from "../backgroundCutout";

export const SCRAP_PIECE_TYPE = "scrap-piece";

/** Longest side a freshly placed piece takes, matching the hand-built studio. */
export const PLACED_MAX_SIDE = 220;

/** What every piece shape carries so it can be turned back into a collage piece. */
export interface PieceShapeMeta extends JsonObject {
  scrapId: string;
  scrap: JsonObject;
}

export interface ScrapPieceShapeProps {
  w: number;
  h: number;
  crop: TLShapeCrop | null;
  flipX: boolean;
  flipY: boolean;
  /** The piece's background cutout, or null when its backdrop was left alone. */
  cutout: JsonObject | null;
}

/** The fields of a tldraw image or scrap-piece shape this conversion reads and writes. */
export type PieceShape =
  | {
      id: string;
      type: "image";
      x: number;
      y: number;
      rotation: number;
      index: IndexKey;
      meta: PieceShapeMeta;
      props: {
        w: number;
        h: number;
        assetId: TLAssetId | null;
        crop: TLShapeCrop | null;
        flipX: boolean;
        flipY: boolean;
        playing: boolean;
        url: string;
        altText: string;
      };
    }
  | {
      id: string;
      type: typeof SCRAP_PIECE_TYPE;
      x: number;
      y: number;
      rotation: number;
      index: IndexKey;
      meta: PieceShapeMeta;
      props: ScrapPieceShapeProps;
    };

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function rotate(point: Point, radians: number): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

export function cropToShapeCrop(crop: CropFraction): TLShapeCrop | null {
  if (isFullCrop(crop)) return null;
  return {
    topLeft: { x: crop.x, y: crop.y },
    bottomRight: { x: crop.x + crop.width, y: crop.y + crop.height },
  };
}

export function shapeCropToCrop(crop: TLShapeCrop | null): CropFraction {
  if (!crop) return { ...FULL_CROP };
  return {
    x: crop.topLeft.x,
    y: crop.topLeft.y,
    width: crop.bottomRight.x - crop.topLeft.x,
    height: crop.bottomRight.y - crop.topLeft.y,
  };
}

/**
 * A stable asset id per image source, so every piece cut from the same scrap
 * image shares one asset record.
 */
export function assetIdForSrc(src: string): TLAssetId {
  // FNV-1a over the source, written in base 36.
  let hash = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    hash ^= src.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return AssetRecordType.createId(`scrap-${hash.toString(36)}-${src.length}`);
}

export function imageAssetFor(
  scrap: Extract<ScrapItem, { kind: "image" }>,
): TLImageAsset {
  return AssetRecordType.create({
    id: assetIdForSrc(scrap.src),
    type: "image",
    props: {
      name: scrap.alt || scrap.pageTitle || scrap.domain,
      src: scrap.src,
      w: scrap.naturalWidth,
      h: scrap.naturalHeight,
      mimeType: null,
      isAnimated: false,
    },
    meta: {},
  }) as TLImageAsset;
}

/**
 * The scrap as plain JSON for a shape's meta, which tldraw validates strictly:
 * a field present but undefined is dropped rather than rejected.
 */
function jsonScrap(scrap: ScrapItem): JsonObject {
  return JSON.parse(JSON.stringify(scrap)) as JsonObject;
}

/** Whether a piece is drawn by tldraw's own image shape rather than our scrap shape. */
function drawsAsImage(
  scrap: ScrapItem,
  cutout: PieceCutout | undefined,
): scrap is Extract<ScrapItem, { kind: "image" }> {
  return scrap.kind === "image" && cutout === undefined;
}

/**
 * A collage piece as a tldraw shape. A piece's x/y is its unrotated box turned
 * about its center, while a tldraw shape turns about its own top-left corner,
 * so the corner is found by turning the half-size offset about the center.
 */
export function pieceToShape(piece: CollagePiece, index: IndexKey): PieceShape {
  const radians = degreesToRadians(piece.rotation);
  const center = {
    x: piece.x + piece.width / 2,
    y: piece.y + piece.height / 2,
  };
  const corner = rotate({ x: -piece.width / 2, y: -piece.height / 2 }, radians);
  const common = {
    id: createShapeId(piece.id),
    x: center.x + corner.x,
    y: center.y + corner.y,
    rotation: radians,
    index,
    meta: {
      scrapId: piece.scrapId,
      scrap: jsonScrap(piece.scrap),
    },
  };
  const crop = cropToShapeCrop(piece.crop);
  if (drawsAsImage(piece.scrap, piece.cutout)) {
    return {
      ...common,
      type: "image",
      props: {
        w: piece.width,
        h: piece.height,
        assetId: assetIdForSrc(piece.scrap.src),
        crop,
        flipX: piece.flipX,
        flipY: piece.flipY,
        playing: true,
        url: "",
        altText: piece.scrap.alt ?? "",
      },
    };
  }
  return {
    ...common,
    type: SCRAP_PIECE_TYPE,
    props: {
      w: piece.width,
      h: piece.height,
      crop,
      flipX: piece.flipX,
      flipY: piece.flipY,
      cutout: piece.cutout ? ({ ...piece.cutout } as JsonObject) : null,
    },
  };
}

/**
 * Every piece of a collage as shapes stacked in the collage's own order, plus
 * the image assets they draw from.
 */
export function piecesToRecords(pieces: readonly CollagePiece[]): {
  shapes: PieceShape[];
  assets: TLImageAsset[];
} {
  const stacked = [...pieces].sort((a, b) => a.z - b.z);
  const indices = getIndices(stacked.length);
  const shapes = stacked.map((piece, i) => pieceToShape(piece, indices[i]));
  const assets = new Map<TLAssetId, TLImageAsset>();
  for (const piece of stacked) {
    if (!drawsAsImage(piece.scrap, piece.cutout)) continue;
    const asset = imageAssetFor(piece.scrap);
    assets.set(asset.id, asset);
  }
  return { shapes, assets: [...assets.values()] };
}

/** The collage piece a tldraw shape stands for, stacked at the given height. */
export function shapeToPiece(shape: PieceShape, z: number): CollagePiece {
  const { w, h } = shape.props;
  const half = rotate({ x: w / 2, y: h / 2 }, shape.rotation);
  const center = { x: shape.x + half.x, y: shape.y + half.y };
  const scrap = shape.meta.scrap as unknown as ScrapItem;
  const cutout =
    shape.type === SCRAP_PIECE_TYPE && shape.props.cutout
      ? parseCutout(shape.props.cutout)
      : undefined;
  return {
    id: shape.id.replace(/^shape:/, ""),
    scrapId: shape.meta.scrapId,
    scrap,
    x: center.x - w / 2,
    y: center.y - h / 2,
    width: w,
    height: h,
    rotation: normalizeRotation(radiansToDegrees(shape.rotation)),
    z,
    crop: shapeCropToCrop(shape.props.crop),
    flipX: shape.props.flipX,
    flipY: shape.props.flipY,
    ...(cutout ? { cutout } : {}),
  };
}

function normalizeRotation(degrees: number): number {
  const turned = ((degrees % 360) + 360) % 360;
  return turned > 180 ? turned - 360 : turned;
}

/** Shapes back to collage pieces, with z following the shapes' stacking order. */
export function shapesToPieces(shapes: readonly PieceShape[]): CollagePiece[] {
  return [...shapes]
    .sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))
    .map((shape, z) => shapeToPiece(shape, z));
}

/** A fresh piece for a scrap, centered on a point in frame units. */
export function placedPiece(item: ScrapItem, at: Point): CollagePiece {
  const natural = naturalScrapSize(item);
  const size = fitWithin(natural.width, natural.height, PLACED_MAX_SIDE);
  return {
    id: createPieceId(),
    scrapId: item.id,
    scrap: item,
    x: at.x - size.width / 2,
    y: at.y - size.height / 2,
    width: size.width,
    height: size.height,
    rotation: 0,
    z: 0,
    crop: { ...FULL_CROP },
    flipX: false,
    flipY: false,
  };
}
