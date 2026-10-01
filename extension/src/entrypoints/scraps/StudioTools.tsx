// ABOUTME: The studio's controls around the canvas: the way back and undo/redo at the top-left,
// ABOUTME: the views (front/back, sources) at the top-right, and the shortcut list's button.

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

/** Two links of a chain: each piece has a page behind it. */
const SOURCES = (
  <Glyph>
    <path d="M7 9a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2L8.2 3.6" {...STROKE} />
    <path d="M9 7a3 3 0 0 0-4.2 0L2.5 9.3a3 3 0 0 0 4.2 4.2l1.1-1.1" {...STROKE} />
  </Glyph>
);

/** A card split down its middle, its far half dashed: the side you are not seeing. */
const TURN_OVER = (
  <Glyph>
    <path d="M8 2.5v11" {...STROKE} />
    <path d="M6 4H3.2a.7.7 0 0 0-.7.7v6.6a.7.7 0 0 0 .7.7H6" {...STROKE} />
    <path
      d="M10 4h2.8a.7.7 0 0 1 .7.7v6.6a.7.7 0 0 1-.7.7H10"
      {...STROKE}
      strokeDasharray="1.4 1.4"
    />
  </Glyph>
);

interface StudioToolsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Leaves the studio for the history, writing pending work first. */
  onBack: () => void;
}

export function StudioTools({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
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
      <div className="collage-tools" role="toolbar" aria-label="History">
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
      </div>
    </div>
  );
}

interface StudioViewsProps {
  /** Whether the collage is showing its back. */
  turnedOver: boolean;
  /** Whether the sources view is left on. */
  sourcesOn: boolean;
  canShowSources: boolean;
  onTurnOver: () => void;
  onSources: () => void;
}

/** Ways of looking at the collage: its back, and where each piece came from. */
export function StudioViews({
  turnedOver,
  sourcesOn,
  canShowSources,
  onTurnOver,
  onSources,
}: StudioViewsProps) {
  return (
    <div className="collage-views" role="toolbar" aria-label="Views">
      <button
        type="button"
        className={`collage-view${turnedOver ? " collage-view--on" : ""}`}
        title={turnedOver ? "Turn face up (T or esc)" : "Turn over to read the sources (T)"}
        aria-label="Turn the collage over"
        aria-pressed={turnedOver}
        onClick={onTurnOver}
      >
        {TURN_OVER}
        <span>front / back</span>
      </button>
      <span className="collage-piece-actions__rule" aria-hidden="true" />
      <button
        type="button"
        className={`collage-view${sourcesOn && canShowSources ? " collage-view--on" : ""}`}
        title="Show where each piece came from (or hold i)"
        aria-label="Show sources"
        aria-pressed={sourcesOn && canShowSources}
        disabled={!canShowSources}
        onClick={onSources}
      >
        {SOURCES}
        <span>sources</span>
      </button>
    </div>
  );
}

/** Opens the list of keyboard shortcuts; it sits with saving and export. */
export function KeysButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`collage-keys-button${open ? " collage-keys-button--on" : ""}`}
      title="Keyboard shortcuts (?)"
      aria-label="Keyboard shortcuts"
      aria-pressed={open}
      onClick={onToggle}
    >
      {KEYS}
      <span>keys</span>
    </button>
  );
}
