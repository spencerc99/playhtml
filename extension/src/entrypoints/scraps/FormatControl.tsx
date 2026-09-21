// ABOUTME: Picks the collage's fixed size and the paper it is made on.
// ABOUTME: Names the true size and the zoom, so the window never looks like the canvas.

import React, { useState } from "react";
import {
  COLLAGE_FORMATS,
  FORMAT_NAMES,
  PAPER_TONES,
  isPaperColor,
  type CollageFormatName,
  type CollagePaper,
} from "./collageFormats";

interface FormatControlProps {
  format: CollageFormatName;
  paper: CollagePaper;
  /** Zoom the frame is shown at, so the readout can say so. */
  zoom: number;
  /** Switching with pieces already down asks first. */
  pieceCount: number;
  onFormat: (format: CollageFormatName) => void;
  onPaper: (paper: CollagePaper) => void;
}

export function FormatControl({
  format,
  paper,
  zoom,
  pieceCount,
  onFormat,
  onPaper,
}: FormatControlProps) {
  const [pending, setPending] = useState<CollageFormatName | null>(null);
  const current = COLLAGE_FORMATS[format];

  const choose = (next: CollageFormatName) => {
    if (next === format) return;
    if (pieceCount === 0) {
      onFormat(next);
      return;
    }
    setPending(next);
  };

  return (
    <div className="collage-format">
      <div className="collage-format__row">
        {FORMAT_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className={`collage-chip${name === format ? " collage-chip--active" : ""}`}
            onClick={() => choose(name)}
          >
            {COLLAGE_FORMATS[name].label}
          </button>
        ))}
      </div>

      <div className="collage-format__row">
        {PAPER_TONES.map((tone) => (
          <button
            key={tone.color}
            type="button"
            className={`collage-swatch${
              tone.color === paper.color ? " collage-swatch--on" : ""
            }`}
            style={{ background: tone.color }}
            title={tone.label}
            aria-label={`Paper: ${tone.label}`}
            aria-pressed={tone.color === paper.color}
            onClick={() => onPaper({ color: tone.color })}
          />
        ))}
        <input
          className="collage-swatch collage-swatch--custom"
          type="color"
          value={paper.color}
          aria-label="Custom paper color"
          onChange={(event) => {
            const next = event.target.value;
            if (isPaperColor(next)) onPaper({ color: next.toLowerCase() });
          }}
        />
        <span className="collage-studio__label">
          {current.label} &#183; {current.width} &#215; {current.height} &#183;{" "}
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {pending && (
        <p className="collage-format__confirm">
          <span>
            change to {COLLAGE_FORMATS[pending].label}? pieces keep their
            places.
          </span>
          <button
            type="button"
            className="collage-action"
            onClick={() => {
              onFormat(pending);
              setPending(null);
            }}
          >
            change it
          </button>
          <button
            type="button"
            className="collage-action"
            onClick={() => setPending(null)}
          >
            keep {current.label}
          </button>
        </p>
      )}
    </div>
  );
}
