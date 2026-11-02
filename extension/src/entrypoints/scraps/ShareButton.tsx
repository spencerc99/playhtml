// ABOUTME: The studio's "share to view" button, beside "export", opening a popover that makes a view-only link.
// ABOUTME: The popover holds the publish section: make the link, then copy, open, update or unshare it.

import React, { useEffect, useRef, useState } from "react";
import { PublishSection, type PublishSectionProps } from "./PublishSection";

export function ShareButton(props: PublishSectionProps) {
  const [open, setOpen] = useState(false);
  const holderRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="collage-export" ref={holderRef}>
      <button
        type="button"
        className={`collage-action${open ? " collage-action--primary" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        share to view
        <span className="collage-setting__caret" aria-hidden="true">
          {" "}
          &#9662;
        </span>
      </button>
      {/* Kept mounted while closed, so a share still uploading keeps its busy
          state and cannot be started a second time by reopening. */}
      <div
        className="collage-export__menu"
        role="dialog"
        aria-label="Share"
        style={open ? undefined : { display: "none" }}
      >
        <section className="collage-export__section" aria-label="Link">
          <p className="collage-studio__label">
            a view-only page — anyone with the link can look, not edit.
          </p>
          <PublishSection {...props} />
        </section>
      </div>
    </div>
  );
}
