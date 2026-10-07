// ABOUTME: The collage's document settings: its fixed size and the paper it is made on.
// ABOUTME: Two small buttons in the bottom bar (size, paper) and the zoom, opening one popover.

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
  const customColor = !PAPER_TONES.some((tone) => tone.color === paper.color);

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
      <button
        type="button"
        className={`collage-setting${open ? " collage-setting--open" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Size: ${current.label}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {current.label}
        <span className="collage-setting__caret" aria-hidden="true">
          &#9662;
        </span>
      </button>
      <button
        ref={buttonRef}
        type="button"
        className={`collage-setting${open ? " collage-setting--open" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="paper"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span
          className="collage-paper-button__swatch"
          style={{ background: paper.color }}
          aria-hidden="true"
        />
        paper
        <span className="collage-setting__caret" aria-hidden="true">
          &#9662;
        </span>
      </button>
      <span
        className="collage-studio__label"
        title={`${current.width} × ${current.height}`}
      >
        {Math.round(zoom * 100)}%
      </span>

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
            {/* A rainbow swatch reads as "pick any color", unlike a plain
                swatch of the current paper that looks like one more tone. */}
            <label
              className={`collage-swatch collage-color-picker${
                customColor ? " collage-swatch--on" : ""
              }`}
              title="pick any color"
            >
              {customColor && (
                <span
                  className="collage-color-picker__chosen"
                  style={{ background: paper.color }}
                  aria-hidden="true"
                />
              )}
              <input
                type="color"
                value={toColorInputValue(paper.color)}
                aria-label="Pick any paper color"
                onChange={(event) => {
                  const next = event.target.value;
                  if (isPaperColor(next)) {
                    onPaper({ ...paper, color: next.toLowerCase() });
                  }
                }}
              />
            </label>
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

/** A color input only takes six-digit hex, so a short "#abc" is spelled out. */
function toColorInputValue(color: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  return short
    ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
    : color;
}
