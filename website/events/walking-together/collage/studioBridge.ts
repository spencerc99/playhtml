// ABOUTME: Translates between table pieces and the scrap studio's pieces, so the table reuses the studio's tools.
// ABOUTME: Table pieces are center-based fractions of the table; studio pieces are top-left pixels.

import type { CollagePiece } from "@extension/entrypoints/scraps/collageRecord";
import {
  FULL_CROP,
  type CropFraction,
} from "@extension/entrypoints/scraps/collageGeometry";
import {
  moveGroupBackward,
  moveGroupForward,
  moveGroupToBack,
  moveGroupToFront,
} from "@extension/entrypoints/scraps/pieceGroup";
import { sourceDomain, type Piece, type PieceTransform, type Pieces, type Placer } from "./pieces";

export interface TableSize {
  width: number;
  height: number;
}

export type OrderMove = "forward" | "backward" | "front" | "back";

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

/** The new stacking for a layer move, as only the z values that change.
 * The studio renumbers the whole stack, so this keeps shared writes small. */
export function reorderedZ(
  pieces: Pieces,
  id: string,
  to: OrderMove,
): Record<string, number> {
  const stack = Object.values(pieces).map((piece) => ({ id: piece.id, z: piece.z }));
  const move = {
    forward: moveGroupForward,
    backward: moveGroupBackward,
    front: moveGroupToFront,
    back: moveGroupToBack,
  }[to];
  // The group helpers only read ids and z, so the light stand-ins are enough.
  const next = move(stack as unknown as CollagePiece[], [id]);
  const changed: Record<string, number> = {};
  for (const piece of next) {
    if (pieces[piece.id]?.z !== piece.z) changed[piece.id] = piece.z;
  }
  return changed;
}

/** A copy of a piece, nudged down and right so both stay visible, owned by
 * whoever made the copy and placed on top. */
export function duplicatedPiece(
  piece: Piece,
  placer: Placer,
  options: { id: string; now: number; z: number },
): Piece {
  // A copy starts free to move; spread leaves `locked` out rather than
  // writing an undefined value into shared data.
  // Nested fields are copied so the copy shares no object with the original
  // in shared data.
  const { locked: _locked, ...rest } = JSON.parse(JSON.stringify(piece)) as Piece;
  return {
    ...rest,
    id: options.id,
    placedByPid: placer.pid,
    placedByName: placer.name,
    placedByColor: placer.color,
    x: Math.min(1, piece.x + 0.02),
    y: Math.min(1, piece.y + 0.03),
    z: options.z,
    placedAt: options.now,
  };
}
