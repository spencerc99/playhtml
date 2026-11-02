// ABOUTME: The studio's one "export" button, opening a menu with a section per kind of export.
// ABOUTME: Picture, video (when something moves) and the collage file; sharing a link has its own button.

import React, { useEffect, useRef, useState } from "react";

interface ExportMenuProps {
  /** False while the collage is empty, when nothing but the file can be made. */
  hasPieces: boolean;
  /** What the button says while an export runs, or null when none does. */
  running: string | null;
  /** Exports both sides, on the studio's mat with its caption or bare. */
  onPicture: (framed: boolean) => void;
  /** The video section, shown only when a piece animates. */
  video?: { ok: true } | { ok: false; reason: string };
  onVideo: () => void;
  onFile: () => void;
}

export function ExportMenu({
  hasPieces,
  running,
  onPicture,
  video,
  onVideo,
  onFile,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const holderRef = useRef<HTMLDivElement>(null);
  const busy = running !== null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!holderRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /** Runs an export and folds the menu away, so its progress shows on the button. */
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="collage-export" ref={holderRef}>
      <button
        type="button"
        className={`collage-action${open ? " collage-action--primary" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {running ?? "export"}
        <span className="collage-setting__caret" aria-hidden="true">
          {" "}
          &#9662;
        </span>
      </button>
      {open && (
        <div className="collage-export__menu" role="dialog" aria-label="Export">
          <section className="collage-export__section" aria-label="Picture">
            <p className="collage-studio__label">picture</p>
            <div className="collage-export__row">
              <button
                type="button"
                className="collage-action"
                disabled={busy || !hasPieces}
                title="Front and back, on the mat with the collage's name"
                onClick={run(() => onPicture(true))}
              >
                png · framed
              </button>
              <button
                type="button"
                className="collage-action"
                disabled={busy || !hasPieces}
                title="Front and back, just the paper"
                onClick={run(() => onPicture(false))}
              >
                png · paper only
              </button>
            </div>
          </section>
          {video && (
            <section className="collage-export__section" aria-label="Video">
              <p className="collage-studio__label">video</p>
              <div className="collage-export__row">
                <button
                  type="button"
                  className="collage-action"
                  disabled={busy}
                  title={video.ok ? undefined : video.reason}
                  onClick={run(onVideo)}
                >
                  mp4 · the moving pieces
                </button>
              </div>
            </section>
          )}
          <section className="collage-export__section" aria-label="File">
            <p className="collage-studio__label">file</p>
            <div className="collage-export__row">
              <button
                type="button"
                className="collage-action"
                disabled={busy}
                title="A file that opens this collage in another browser"
                onClick={run(onFile)}
              >
                .collage.json
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
