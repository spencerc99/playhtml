// ABOUTME: The stage's top-left row: the way back to the collages, then the studio-wide tools.
// ABOUTME: Undo, redo, turning the collage over, and the shortcut list, beside the canvas.

import React from "react";

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

const UNDO = (
  <Glyph>
    <path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7H6" {...STROKE} />
    <path d="M5.5 3.5l-3 3 3 3" {...STROKE} />
  </Glyph>
);

const REDO = (
  <Glyph>
    <path d="M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H10" {...STROKE} />
    <path d="M10.5 3.5l3 3-3 3" {...STROKE} />
  </Glyph>
);

const KEYS = (
  <Glyph>
    <rect x="1.5" y="4.5" width="13" height="8" rx="1.5" {...STROKE} />
    <path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 10h6" {...STROKE} />
  </Glyph>
);

/** A card with an arrow swinging around it: turn the collage over. */
const TURN_OVER = (
  <Glyph>
    <rect x="4.5" y="3.5" width="7" height="9" rx="0.8" {...STROKE} />
    <path d="M2 9.5a6 3 0 0 0 12 0" {...STROKE} />
    <path d="M12.2 11.4l1.8-1.9.5 2.4" {...STROKE} />
  </Glyph>
);

interface StudioToolsProps {
  canUndo: boolean;
  canRedo: boolean;
  keysOpen: boolean;
  /** Whether the collage is showing its back. */
  turnedOver: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onKeys: () => void;
  onTurnOver: () => void;
  /** Leaves the studio for the history, writing pending work first. */
  onBack: () => void;
}

export function StudioTools({
  canUndo,
  canRedo,
  keysOpen,
  turnedOver,
  onUndo,
  onRedo,
  onKeys,
  onTurnOver,
  onBack,
}: StudioToolsProps) {
  return (
    <div className="collage-stage-top">
      <button
        type="button"
        className="collage-leave"
        aria-label="back to collages"
        onClick={onBack}
      >
        &#8592; collages
      </button>
      <div className="collage-tools" role="toolbar" aria-label="Studio">
        <button
          type="button"
          className="collage-glyph"
          title="Undo (cmd + Z)"
          aria-label="Undo"
          disabled={!canUndo}
          onClick={onUndo}
        >
          {UNDO}
        </button>
        <button
          type="button"
          className="collage-glyph"
          title="Redo (cmd + shift + Z)"
          aria-label="Redo"
          disabled={!canRedo}
          onClick={onRedo}
        >
          {REDO}
        </button>
        <span className="collage-piece-actions__rule" aria-hidden="true" />
        <button
          type="button"
          className={`collage-glyph${turnedOver ? " collage-glyph--on" : ""}`}
          title={turnedOver ? "Turn face up (T or esc)" : "Turn over to read the sources (T)"}
          aria-label="Turn the collage over"
          aria-pressed={turnedOver}
          onClick={onTurnOver}
        >
          {TURN_OVER}
        </button>
        <button
          type="button"
          className={`collage-glyph${keysOpen ? " collage-glyph--on" : ""}`}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          aria-pressed={keysOpen}
          onClick={onKeys}
        >
          {KEYS}
        </button>
      </div>
    </div>
  );
}
