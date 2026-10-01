// ABOUTME: The small panel shown while a piece is being cropped: back to the whole picture, or done.
// ABOUTME: It takes the piece strip's place beside the piece until the crop is committed.

import React from "react";
import type { CollagePiece } from "./collageRecord";
import {
  isFullCrop,
  sourceBoxForCrop,
  type CropFraction,
} from "./collageGeometry";
import { useBesidePiece } from "./PieceActions";

interface CropControlProps {
  piece: CollagePiece;
  /** The crop being edited in the session. */
  crop: CropFraction;
  scale: number;
  frame: { width: number; height: number };
  /** Opens the crop out to the whole picture, still inside the session. */
  onWhole: () => void;
  onDone: () => void;
}

export function CropControl({
  piece,
  crop,
  scale,
  frame,
  onWhole,
  onDone,
}: CropControlProps) {
  // While cropping, the whole source is on show, so the panel sits beside
  // that rather than beside the piece's kept box.
  const shown = { ...piece, ...sourceBoxForCrop(piece, piece.crop) };
  const placement = useBesidePiece(shown, scale, frame);
  return (
    <div
      ref={placement.ref}
      className="collage-tolerance"
      role="group"
      aria-label="Crop"
      style={placement.style}
      // Using the panel must not reach the frame beneath and end the crop.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="collage-studio__label">crop</span>
      <button
        type="button"
        className="collage-tolerance__button"
        disabled={isFullCrop(crop)}
        onClick={onWhole}
      >
        whole picture
      </button>
      <button
        type="button"
        className="collage-tolerance__button collage-tolerance__button--done"
        onClick={onDone}
      >
        done
      </button>
    </div>
  );
}
