// ABOUTME: The collage's document settings: its fixed size and the paper it is made on.
// ABOUTME: A quiet readout with the settings tucked into a popover beside it.

import React, { useEffect, useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const holderRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = COLLAGE_FORMATS[format];

  const close = () => {
    setOpen(false);
    setPending(null);
  };

  // Escape and a click outside both put the popover away, and escape hands
  // focus back to the button that opened it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const holder = holderRef.current;
      if (holder && !holder.contains(event.target as Node)) close();
    };
    // Capturing beats the studio's own Escape handler to the event, so a
    // press closes the popover rather than deselecting behind it.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const choose = (next: CollageFormatName) => {
    if (next === format) return;
    if (pieceCount === 0) {
      onFormat(next);
      return;
    }
    setPending(next);
  };

  return (
    <div className="collage-format" ref={holderRef}>
      <span className="collage-studio__label">
        {current.label} &#183; {current.width} &#215; {current.height} &#183;{" "}
        {Math.round(zoom * 100)}%
      </span>
      <button
        ref={buttonRef}
        type="button"
        className={`collage-chip collage-paper-button${
          open ? " collage-chip--active" : ""
        }`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span
          className="collage-paper-button__swatch"
          style={{ background: paper.color }}
          aria-hidden="true"
        />
        paper
      </button>

      {open && (
        <div
          className="collage-paper-popover"
          role="dialog"
          aria-label="Paper and size"
        >
          <p className="collage-studio__label">size</p>
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

          <p className="collage-studio__label">paper</p>
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
                onClick={() => onPaper({ ...paper, color: tone.color })}
              />
            ))}
            <input
              className="collage-swatch collage-swatch--custom"
              type="color"
              value={paper.color}
              aria-label="Custom paper color"
              onChange={(event) => {
                const next = event.target.value;
                if (isPaperColor(next)) {
                  onPaper({ ...paper, color: next.toLowerCase() });
                }
              }}
            />
          </div>

          <label className="collage-grain">
            <input
              type="checkbox"
              checked={paper.grain}
              onChange={(event) =>
                onPaper({ ...paper, grain: event.target.checked })
              }
            />
            <span className="collage-studio__label">grain</span>
          </label>
        </div>
      )}
    </div>
  );
}
