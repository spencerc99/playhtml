// ABOUTME: Converts collage pieces to tldraw shapes and back without losing anything tldraw does not model.
// ABOUTME: Each piece is remembered with the shape written for it, so untouched fields return exactly as they were.

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
import { createPieceId, setPieceLocked } from "../collageRecord";
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

/** Longest side a freshly placed piece takes, matching the regular editor. */
export const PLACED_MAX_SIDE = 220;

/** What every piece shape carries so it can be drawn and turned back into a piece. */
export interface PieceShapeMeta extends JsonObject {
  /** The piece this shape was made from; a duplicate keeps its original's. */
  pieceId: string;
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

interface ImageShapeProps {
  w: number;
  h: number;
  assetId: TLAssetId | null;
  crop: TLShapeCrop | null;
  flipX: boolean;
  flipY: boolean;
  playing: boolean;
  url: string;
  altText: string;
}

interface ShapeBase {
  id: string;
  x: number;
  y: number;
  rotation: number;
  index: IndexKey;
  /** A locked piece is tldraw's locked shape: it cannot be selected or moved. */
  isLocked: boolean;
  meta: PieceShapeMeta;
}

/** The fields of a tldraw image or scrap-piece shape this conversion reads and writes. */
export type PieceShape =
  | (ShapeBase & { type: "image"; props: ImageShapeProps })
  | (ShapeBase & { type: typeof SCRAP_PIECE_TYPE; props: ScrapPieceShapeProps });

/** A piece as it was handed to tldraw, with the shape that was written for it. */
export interface PieceSource {
  piece: CollagePiece;
  written: PieceShape;
}

/** Every piece handed to tldraw this session, by piece id. */
export type PieceSources = Map<string, PieceSource>;

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

export function pieceIdOf(shapeId: string): string {
  return shapeId.replace(/^shape:/, "");
}

/**
 * A collage piece as a tldraw shape. A piece's x/y is its unrotated box turned
 * about its center, while a tldraw shape turns about its own top-left corner,
 * so the corner is found by turning the half-size offset about the center.
 */
export function pieceToShape(piece: CollagePiece, index: IndexKey): PieceShape {
  const radians = (piece.rotation * Math.PI) / 180;
  const center = {
    x: piece.x + piece.width / 2,
    y: piece.y + piece.height / 2,
  };
  const corner = rotate({ x: -piece.width / 2, y: -piece.height / 2 }, radians);
  const common: ShapeBase = {
    id: createShapeId(piece.id),
    x: center.x + corner.x,
    y: center.y + corner.y,
    rotation: radians,
    index,
    isLocked: piece.locked === true,
    meta: {
      pieceId: piece.id,
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

/** Pieces stacked lowest first; pieces at the same height keep their order in the record. */
function stacked(pieces: readonly CollagePiece[]): CollagePiece[] {
  return pieces
    .map((piece, order) => ({ piece, order }))
    .sort((a, b) => a.piece.z - b.piece.z || a.order - b.order)
    .map(({ piece }) => piece);
}

/**
 * Every piece of a collage as shapes stacked in the collage's own order, the
 * image assets they draw from, and the sources that let them come back intact.
 */
export function piecesToShapes(pieces: readonly CollagePiece[]): {
  shapes: PieceShape[];
  assets: TLImageAsset[];
  sources: PieceSources;
} {
  const ordered = stacked(pieces);
  const indices = getIndices(ordered.length);
  const sources: PieceSources = new Map();
  const assets = new Map<TLAssetId, TLImageAsset>();
  const shapes = ordered.map((piece, i) => {
    const written = pieceToShape(piece, indices[i]);
    sources.set(piece.id, { piece, written });
    if (drawsAsImage(piece.scrap, piece.cutout)) {
      const asset = imageAssetFor(piece.scrap);
      assets.set(asset.id, asset);
    }
    return written;
  });
  return { shapes, assets: [...assets.values()], sources };
}

function sameShapeCrop(a: TLShapeCrop | null, b: TLShapeCrop | null): boolean {
  return sameJson(a, b);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function cutoutOf(shape: PieceShape): PieceCutout | undefined {
  return shape.type === SCRAP_PIECE_TYPE && shape.props.cutout
    ? parseCutout(shape.props.cutout)
    : undefined;
}

/** The box a shape covers, in a piece's terms: unrotated, turning about its center. */
function geometryOf(shape: PieceShape) {
  const { w, h } = shape.props;
  const half = rotate({ x: w / 2, y: h / 2 }, shape.rotation);
  const center = { x: shape.x + half.x, y: shape.y + half.y };
  const degrees = (shape.rotation * 180) / Math.PI;
  const turned = ((degrees % 360) + 360) % 360;
  return {
    x: center.x - w / 2,
    y: center.y - h / 2,
    width: w,
    height: h,
    rotation: turned > 180 ? turned - 360 : turned,
  };
}

/**
 * The piece a shape draws, enough to render it. It is read from the shape
 * alone, so it can be drawn before the studio has looked up its source.
 */
export function pieceForDrawing(shape: PieceShape): CollagePiece {
  const cutout = cutoutOf(shape);
  return {
    id: pieceIdOf(shape.id),
    scrapId: shape.meta.scrapId,
    scrap: shape.meta.scrap as unknown as ScrapItem,
    ...geometryOf(shape),
    z: 0,
    crop: shapeCropToCrop(shape.props.crop),
    flipX: shape.props.flipX,
    flipY: shape.props.flipY,
    ...(cutout ? { cutout } : {}),
    ...(shape.isLocked ? { locked: true as const } : {}),
  };
}

/**
 * The collage piece a shape stands for. Starting from the piece it was made
 * from, only what was changed in tldraw is rewritten: position and size come
 * back exactly as stored until the piece is moved, and every field tldraw
 * knows nothing about is carried through as it was. A duplicate starts from
 * its original under an id of its own; a shape with no known source, such as
 * one pasted in from elsewhere, is rebuilt from what it carries.
 */
export function shapeToPiece(shape: PieceShape, sources: PieceSources): CollagePiece {
  const id = pieceIdOf(shape.id);
  const source = sources.get(shape.meta.pieceId);
  if (!source) return pieceForDrawing(shape);

  const { written } = source;
  let piece: CollagePiece =
    id === source.piece.id ? source.piece : { ...source.piece, id };

  const moved =
    shape.x !== written.x ||
    shape.y !== written.y ||
    shape.rotation !== written.rotation ||
    shape.props.w !== written.props.w ||
    shape.props.h !== written.props.h;
  if (moved) piece = { ...piece, ...geometryOf(shape) };

  if (!sameShapeCrop(shape.props.crop, written.props.crop)) {
    piece = { ...piece, crop: shapeCropToCrop(shape.props.crop) };
  }
  if (shape.props.flipX !== written.props.flipX) piece = { ...piece, flipX: shape.props.flipX };
  if (shape.props.flipY !== written.props.flipY) piece = { ...piece, flipY: shape.props.flipY };

  if (shape.isLocked !== written.isLocked) piece = setPieceLocked(piece, shape.isLocked);

  const cutout = cutoutOf(shape);
  if (!sameJson(cutout, cutoutOf(written))) {
    if (cutout) {
      piece = { ...piece, cutout };
    } else {
      const { cutout: _removed, ...rest } = piece;
      piece = rest;
    }
  }
  return piece;
}

/**
 * The collage's pieces from its shapes. Pieces keep their place in the
 * record, with new ones after them, and keep their stored stacking heights
 * while the stacking order is the one they were opened with; once it changes,
 * heights are renumbered from the bottom up.
 */
export function shapesToPieces(
  shapes: readonly PieceShape[],
  sources: PieceSources,
  recordOrder: readonly string[],
): CollagePiece[] {
  const byIndex = [...shapes].sort((a, b) =>
    a.index < b.index ? -1 : a.index > b.index ? 1 : 0,
  );
  const pieces = byIndex.map((shape) => shapeToPiece(shape, sources));

  const opened = recordOrder.filter((id) => sources.has(id));
  const openedStack = stacked(opened.map((id) => sources.get(id)!.piece)).map(
    (piece) => piece.id,
  );
  const presentIds = pieces.map((piece) => piece.id);
  const keepsHeights =
    presentIds.every((id) => opened.includes(id)) &&
    sameJson(
      openedStack.filter((id) => presentIds.includes(id)),
      presentIds,
    );
  const withHeights = keepsHeights
    ? pieces
    : pieces.map((piece, z) => (piece.z === z ? piece : { ...piece, z }));

  const place = new Map(recordOrder.map((id, i) => [id, i] as const));
  return withHeights
    .map((piece, i) => ({ piece, rank: place.get(piece.id) ?? recordOrder.length + i }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ piece }) => piece);
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
