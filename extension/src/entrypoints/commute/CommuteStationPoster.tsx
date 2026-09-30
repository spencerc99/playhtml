// ABOUTME: Adds an install poster to commute station platforms on public web pages.
// ABOUTME: Opens an accessible transit-pass overlay with the extension link.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useExtensionInstallState } from "./commuteInstallState";

export function CommuteStationPoster({
  stationVisible,
}: {
  stationVisible: boolean;
}) {
  const installState = useExtensionInstallState();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  if (installState !== "missing") return null;

  return (
    <>
      {stationVisible && (
        <button
          className="station-install-poster"
          type="button"
          aria-label="Open the internet transit pass poster"
          onClick={() => setOpen(true)}
        >
          <span className="station-install-poster__stripe" aria-hidden />
          <span className="station-install-poster__copy">
            <span>internet transit pass</span>
            <strong>join the ride</strong>
            <i aria-hidden />
          </span>
        </button>
      )}

      {open &&
        createPortal(
          <div
            className="commute-poster-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <section
              className="commute-poster-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="commute-poster-title"
            >
              <span className="commute-poster-dialog__stripe" aria-hidden />
              <span
                className="commute-poster-dialog__tape commute-poster-dialog__tape--left"
                aria-hidden
              />
              <span
                className="commute-poster-dialog__tape commute-poster-dialog__tape--right"
                aria-hidden
              />
              <button
                className="commute-poster-dialog__close"
                type="button"
                aria-label="Close the internet transit pass poster"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
              <span className="commute-poster-dialog__label">
                internet transit pass
              </span>
              <h2 id="commute-poster-title">join the ride</h2>
              <p>
                this line runs on the stops of riders like you — install we were
                online and the places you visit become stations on everyone's
                commute.
              </p>
              <a href="https://wewere.online/" target="_blank" rel="noreferrer">
                get the extension →
              </a>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
