// ABOUTME: tldraw shape for pieces tldraw's image shape cannot draw: headings, buttons, icons, cursors, cutouts.
// ABOUTME: Renders our own PieceMaterial inside a crop window, so it looks as it does in the hand-built studio.

import React from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  ImageShapeCrop,
  T,
  type RecordProps,
  type TLShape,
} from "tldraw";
import { PieceMaterial } from "../PieceMaterial";
import { pieceMaterialTransform } from "../collageRecord";
import { sourceBoxForCrop } from "../collageGeometry";
import {
  SCRAP_PIECE_TYPE,
  pieceForDrawing,
  type PieceShape,
  type ScrapPieceShapeProps,
} from "./pieceShapes";

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [SCRAP_PIECE_TYPE]: ScrapPieceShapeProps;
  }
}

type ScrapPieceShape = TLShape<typeof SCRAP_PIECE_TYPE>;

export class ScrapPieceShapeUtil extends BaseBoxShapeUtil<ScrapPieceShape> {
  static override type = SCRAP_PIECE_TYPE;
  static override props: RecordProps<ScrapPieceShape> = {
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
    crop: ImageShapeCrop.nullable(),
    flipX: T.boolean,
    flipY: T.boolean,
    cutout: T.jsonValue as never,
  };

  override getDefaultProps(): ScrapPieceShapeProps {
    return {
      w: 100,
      h: 100,
      crop: null,
      flipX: false,
      flipY: false,
      cutout: null,
    };
  }

  override canCrop(): boolean {
    return true;
  }

  override isAspectRatioLocked(): boolean {
    return true;
  }

  override component(shape: ScrapPieceShape) {
    // The shape's own position does not matter to the material, only its box.
    const piece = pieceForDrawing({
      ...shape,
      x: 0,
      y: 0,
      rotation: 0,
    } as unknown as PieceShape);
    const source = sourceBoxForCrop(piece, piece.crop);
    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          overflow: "hidden",
          pointerEvents: "all",
        }}
      >
        <div
          className="collage-piece__source"
          style={{
            left: source.x,
            top: source.y,
            width: source.width,
            height: source.height,
            transform: pieceMaterialTransform(piece),
            transformOrigin: "center",
            pointerEvents: "none",
          }}
        >
          <PieceMaterial piece={piece} />
        </div>
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: ScrapPieceShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
