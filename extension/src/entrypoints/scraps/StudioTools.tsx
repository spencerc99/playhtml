// ABOUTME: The small cluster of studio-wide tools floating at the frame's top-left.
// ABOUTME: Undo, redo and the shortcut list, beside the canvas rather than across the drawer.

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

interface StudioToolsProps {
  canUndo: boolean;
  canRedo: boolean;
  keysOpen: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onKeys: () => void;
}

export function StudioTools({
  canUndo,
  canRedo,
  keysOpen,
  onUndo,
  onRedo,
  onKeys,
}: StudioToolsProps) {
  return (
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
        className={`collage-glyph${keysOpen ? " collage-glyph--on" : ""}`}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
        aria-pressed={keysOpen}
        onClick={onKeys}
      >
        {KEYS}
      </button>
    </div>
  );
}
