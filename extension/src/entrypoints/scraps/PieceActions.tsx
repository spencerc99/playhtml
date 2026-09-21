// ABOUTME: The compact strip of actions that appears while a piece is selected.
// ABOUTME: Small inline-SVG glyphs so the tools stay out of the material's way.

import React from "react";
import type { CollagePiece } from "./collageRecord";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {children}
    </svg>
  );
}

const GLYPHS = {
  toFront: (
    <Glyph>
      <rect x="2.5" y="2.5" width="8" height="8" {...STROKE} />
      <path d="M5.5 13.5h8v-8" {...STROKE} />
    </Glyph>
  ),
  forward: (
    <Glyph>
      <rect x="2.5" y="4.5" width="7" height="7" {...STROKE} />
      <path d="M8 8.5h5.5V3" {...STROKE} />
    </Glyph>
  ),
  backward: (
    <Glyph>
      <rect x="6.5" y="4.5" width="7" height="7" {...STROKE} />
      <path d="M8 7.5H2.5V13" {...STROKE} />
    </Glyph>
  ),
  toBack: (
    <Glyph>
      <rect x="5.5" y="5.5" width="8" height="8" {...STROKE} />
      <path d="M10.5 2.5h-8v8" {...STROKE} />
    </Glyph>
  ),
  flipX: (
    <Glyph>
      <path d="M8 1.5v13" {...STROKE} strokeDasharray="2 2" />
      <path d="M6 4L2 8l4 4z" {...STROKE} />
      <path d="M10 4l4 4-4 4z" {...STROKE} />
    </Glyph>
  ),
  flipY: (
    <Glyph>
      <path d="M1.5 8h13" {...STROKE} strokeDasharray="2 2" />
      <path d="M4 6L8 2l4 4z" {...STROKE} />
      <path d="M4 10l4 4 4-4z" {...STROKE} />
    </Glyph>
  ),
  crop: (
    <Glyph>
      <path d="M4.5 1.5v10h10" {...STROKE} />
      <path d="M1.5 4.5h10v10" {...STROKE} />
    </Glyph>
  ),
  uncrop: (
    <Glyph>
      <rect x="2.5" y="2.5" width="11" height="11" {...STROKE} />
      <path d="M5.5 8h5M8 5.5v5" {...STROKE} />
    </Glyph>
  ),
  cutOut: (
    <Glyph>
      <circle cx="4" cy="12" r="1.8" {...STROKE} />
      <circle cx="12" cy="12" r="1.8" {...STROKE} />
      <path d="M5.3 10.7L12 2M10.7 10.7L4 2" {...STROKE} />
    </Glyph>
  ),
  duplicate: (
    <Glyph>
      <rect x="2.5" y="2.5" width="8" height="8" {...STROKE} />
      <rect x="5.5" y="5.5" width="8" height="8" {...STROKE} />
    </Glyph>
  ),
  remove: (
    <Glyph>
      <path d="M3 4.5h10M6.5 4.5V2.5h3v2" {...STROKE} />
      <path d="M4.5 4.5l.7 9h5.6l.7-9" {...STROKE} />
    </Glyph>
  ),
};

export interface PieceActionsProps {
  piece: CollagePiece;
  canUncrop: boolean;
  canCutOut: boolean;
  onOrder: (to: "forward" | "backward" | "front" | "back") => void;
  onFlip: (axis: "x" | "y") => void;
  onCrop: () => void;
  onUncrop: () => void;
  onCutOut: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

/**
 * The actions that only make sense with something selected. They live apart
 * from the always-present title and save so the bottom bar stays one row.
 */
export function PieceActions({
  piece,
  canUncrop,
  canCutOut,
  onOrder,
  onFlip,
  onCrop,
  onUncrop,
  onCutOut,
  onDuplicate,
  onRemove,
}: PieceActionsProps) {
  const actions: {
    key: string;
    label: string;
    hint: string;
    glyph: React.ReactNode;
    run: () => void;
    disabled?: boolean;
    danger?: boolean;
    on?: boolean;
  }[] = [
    {
      key: "back",
      label: "Send to back",
      hint: "cmd + shift + [",
      glyph: GLYPHS.toBack,
      run: () => onOrder("back"),
    },
    {
      key: "backward",
      label: "Send back",
      hint: "cmd + [",
      glyph: GLYPHS.backward,
      run: () => onOrder("backward"),
    },
    {
      key: "forward",
      label: "Bring forward",
      hint: "cmd + ]",
      glyph: GLYPHS.forward,
      run: () => onOrder("forward"),
    },
    {
      key: "front",
      label: "Bring to front",
      hint: "cmd + shift + ]",
      glyph: GLYPHS.toFront,
      run: () => onOrder("front"),
    },
    {
      key: "flip-x",
      label: "Flip across",
      hint: "H",
      glyph: GLYPHS.flipX,
      run: () => onFlip("x"),
      on: piece.flipX,
    },
    {
      key: "flip-y",
      label: "Flip down",
      hint: "V",
      glyph: GLYPHS.flipY,
      run: () => onFlip("y"),
      on: piece.flipY,
    },
    {
      key: "crop",
      label: "Crop",
      hint: "double-click or C",
      glyph: GLYPHS.crop,
      run: onCrop,
    },
    {
      key: "uncrop",
      label: "Undo the crop",
      hint: "restores the whole picture",
      glyph: GLYPHS.uncrop,
      run: onUncrop,
      disabled: !canUncrop,
    },
    {
      key: "cut-out",
      label: piece.cutout ? "Keep the background" : "Cut out the background",
      hint: "B",
      glyph: GLYPHS.cutOut,
      run: onCutOut,
      disabled: !canCutOut,
      on: piece.cutout !== undefined,
    },
    {
      key: "duplicate",
      label: "Duplicate",
      hint: "cmd + D",
      glyph: GLYPHS.duplicate,
      run: onDuplicate,
    },
    {
      key: "remove",
      label: "Remove",
      hint: "delete",
      glyph: GLYPHS.remove,
      run: onRemove,
      danger: true,
    },
  ];

  return (
    <div className="collage-piece-actions" role="toolbar" aria-label="Piece">
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          className={`collage-glyph${action.on ? " collage-glyph--on" : ""}${
            action.danger ? " collage-glyph--danger" : ""
          }`}
          title={`${action.label} (${action.hint})`}
          aria-label={action.label}
          aria-pressed={action.on === undefined ? undefined : action.on}
          disabled={action.disabled}
          onClick={action.run}
        >
          {action.glyph}
        </button>
      ))}
    </div>
  );
}
