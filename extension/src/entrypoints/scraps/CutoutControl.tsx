// ABOUTME: The edge control for a background cutout, shown while the cutout is being tuned.
// ABOUTME: It takes the piece strip's place beside the piece until it is done.

import React from "react";
import type { CollagePiece } from "./collageRecord";
import { useBesidePiece } from "./PieceActions";

interface CutoutControlProps {
  piece: CollagePiece;
  /** How much of the edge color is cut away, from 0 to 1. */
  tolerance: number;
  scale: number;
  frame: { width: number; height: number };
  onTolerance: (tolerance: number) => void;
  /** Takes the cutout off and puts the background back. */
  onKeepBackground: () => void;
  onDone: () => void;
}

export function CutoutControl({
  piece,
  tolerance,
  scale,
  frame,
  onTolerance,
  onKeepBackground,
  onDone,
}: CutoutControlProps) {
  const placement = useBesidePiece(piece, scale, frame);
  return (
    <div
      ref={placement.ref}
      className="collage-tolerance"
      role="group"
      aria-label="Background cutout"
      style={placement.style}
      // Tuning the edge must not reach the frame beneath and end the session.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="collage-studio__label">edge</span>
      <input
        type="range"
        min={0}
        max={60}
        value={Math.round(tolerance * 100)}
        aria-label="Background cutout tolerance"
        onChange={(event) => onTolerance(Number(event.target.value) / 100)}
      />
      <button
        type="button"
        className="collage-tolerance__button"
        onClick={onKeepBackground}
      >
        keep background
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
