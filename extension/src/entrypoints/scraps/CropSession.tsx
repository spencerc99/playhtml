// ABOUTME: Direct crop editing: the full source shows dimmed under a bright kept box.
// ABOUTME: The eight grips resize the box and dragging inside slides the source under it.

import React, { useRef } from "react";
import {
  dragCropGrip,
  sourceBoxForCrop,
  toLocalPoint,
  type CropFraction,
  type CropGrip,
  type PieceBox,
  type Point,
} from "./collageGeometry";
import type { CollagePiece } from "./collageRecord";
import { PieceMaterial } from "./PieceMaterial";

/** Where each grip sits on the crop box, as a fraction of its own size. */
const GRIPS: { grip: CropGrip; left: string; top: string; cursor: string }[] = [
  { grip: "top-left", left: "0%", top: "0%", cursor: "nwse-resize" },
  { grip: "top", left: "50%", top: "0%", cursor: "ns-resize" },
  { grip: "top-right", left: "100%", top: "0%", cursor: "nesw-resize" },
  { grip: "right", left: "100%", top: "50%", cursor: "ew-resize" },
  { grip: "bottom-right", left: "100%", top: "100%", cursor: "nwse-resize" },
  { grip: "bottom", left: "50%", top: "100%", cursor: "ns-resize" },
  { grip: "bottom-left", left: "0%", top: "100%", cursor: "nesw-resize" },
  { grip: "left", left: "0%", top: "50%", cursor: "ew-resize" },
];

interface CropSessionProps {
  piece: CollagePiece;
  /** The crop being edited, which is live until the session commits. */
  crop: CropFraction;
  onChange: (crop: CropFraction) => void;
  onCommit: () => void;
  framePoint: (event: { clientX: number; clientY: number }) => Point;
}

/**
 * While cropping, the piece is drawn at its whole source box so the material
 * outside the crop is visible to drag back in.
 */
export function CropSession({
  piece,
  crop,
  onChange,
  onCommit,
  framePoint,
}: CropSessionProps) {
  const dragRef = useRef<{ grip: CropGrip; last: Point } | null>(null);
  const source = sourceBoxForCrop(piece, piece.crop);
  const sourceBox: PieceBox = {
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
  };

  const kept = {
    left: crop.x * source.width,
    top: crop.y * source.height,
    width: crop.width * source.width,
    height: crop.height * source.height,
  };

  const beginDrag = (grip: CropGrip, event: React.PointerEvent) => {
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragRef.current = {
      grip,
      last: toLocalPoint(framePoint(event), sourceBox, piece.rotation),
    };
  };

  const onMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const local = toLocalPoint(framePoint(event), sourceBox, piece.rotation);
    onChange(
      dragCropGrip(
        crop,
        drag.grip,
        { x: local.x - drag.last.x, y: local.y - drag.last.y },
        source,
      ),
    );
    dragRef.current = { grip: drag.grip, last: local };
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <div
      className="collage-crop"
      style={{
        left: source.x,
        top: source.y,
        width: source.width,
        height: source.height,
        transform: `rotate(${piece.rotation}deg)`,
        transformOrigin: "center",
      }}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onCommit();
      }}
    >
      <div className="collage-crop__source">
        <PieceMaterial piece={piece} />
      </div>
      <div className="collage-crop__shade" />
      <div
        className="collage-crop__kept"
        style={kept}
        onPointerDown={(event) => beginDrag("inside", event)}
      >
        <div className="collage-crop__window">
          <div
            className="collage-crop__reveal"
            style={{
              left: -kept.left,
              top: -kept.top,
              width: source.width,
              height: source.height,
            }}
          >
            <PieceMaterial piece={piece} />
          </div>
        </div>
      </div>
      {GRIPS.map(({ grip, left, top, cursor }) => (
        <button
          key={grip}
          type="button"
          aria-label={`Crop from the ${grip.replace("-", " ")}`}
          className="collage-handle collage-handle--crop"
          style={{
            left: `${kept.left + (parseFloat(left) / 100) * kept.width}px`,
            top: `${kept.top + (parseFloat(top) / 100) * kept.height}px`,
            cursor,
          }}
          onPointerDown={(event) => beginDrag(grip, event)}
        />
      ))}
    </div>
  );
}
