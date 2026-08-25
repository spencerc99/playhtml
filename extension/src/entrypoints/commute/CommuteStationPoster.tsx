// ABOUTME: Displays rotating advertisements on Internet Commute station platforms.
// ABOUTME: Opens each campaign poster in an accessible readable overlay.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "@fontsource/source-serif-4/latin-400-italic.css";
import "@fontsource/source-serif-4/latin-600.css";
import { getCommuteAd, type CommuteAd } from "./commuteAds";
import { useExtensionInstallState } from "./commuteInstallState";

function PosterArtwork({ ad }: { ad: CommuteAd }) {
  if (ad.id === "transit-pass") {
    return (
      <>
        <span className="station-install-poster__stripe" aria-hidden />
        <span className="station-install-poster__copy">
          <span>{ad.copy.label}</span>
          <strong>{ad.copy.headline}</strong>
          <i aria-hidden />
        </span>
      </>
    );
  }

  return (
    <>
      <span
        className="station-install-poster__accent"
        style={{ backgroundColor: ad.palette.accent }}
        aria-hidden
      />
      <img src={ad.artwork} alt="" />
    </>
  );
}

function PosterLink({ ad }: { ad: CommuteAd }) {
  return (
    <a
      href={ad.href}
      target="_blank"
      rel="noreferrer"
      style={{
        backgroundColor: ad.palette.ctaBackground,
        color: ad.palette.ctaText,
      }}
    >
      {ad.copy.cta}
    </a>
  );
}

function PosterContent({ ad }: { ad: CommuteAd }) {
  switch (ad.id) {
    case "playhtml":
      return (
        <>
          <img
            className="commute-poster-dialog__artwork"
            src={ad.artwork}
            alt=""
          />
          <div className="commute-poster-dialog__content">
            <span className="commute-poster-dialog__wordmark">
              play<span>html</span>
            </span>
            <h2 id="commute-poster-title">{ad.copy.headline}</h2>
            <div
              className="commute-poster-dialog__chips"
              aria-label="playhtml capabilities"
            >
              <span>can-move</span>
              <span>can-spin</span>
              <span>can-play</span>
            </div>
            <PosterLink ad={ad} />
          </div>
        </>
      );
    case "class":
      return (
        <>
          <img
            className="commute-poster-dialog__artwork"
            src={ad.artwork}
            alt=""
          />
          <div className="commute-poster-dialog__content">
            <span className="commute-poster-dialog__label">
              {ad.copy.label}
            </span>
            <h2 id="commute-poster-title">{ad.copy.headline}</h2>
            <PosterLink ad={ad} />
          </div>
        </>
      );
    case "benches":
      return (
        <>
          <img
            className="commute-poster-dialog__artwork"
            src={ad.artwork}
            alt=""
          />
          <div className="commute-poster-dialog__content">
            <span className="commute-poster-dialog__label">
              {ad.copy.label}
            </span>
            <h2 id="commute-poster-title">{ad.copy.headline}</h2>
            <span className="commute-poster-dialog__byline">
              an essay by spencer chang · news.spencer.place
            </span>
            <PosterLink ad={ad} />
          </div>
        </>
      );
    case "alive":
      return (
        <>
          <div className="commute-poster-dialog__artwork-frame">
            <img
              className="commute-poster-dialog__artwork"
              src={ad.artwork}
              alt=""
            />
          </div>
          <div className="commute-poster-dialog__content">
            <span className="commute-poster-dialog__label">
              {ad.copy.label}
            </span>
            <h2 id="commute-poster-title">{ad.copy.headline}</h2>
            <p>
              every stop on this line is a page somebody real just visited —
              you're riding with them now
            </p>
            <PosterLink ad={ad} />
          </div>
        </>
      );
    case "transit-pass":
      return (
        <>
          <span className="commute-poster-dialog__stripe" aria-hidden />
          <span className="commute-poster-dialog__label">{ad.copy.label}</span>
          <h2 id="commute-poster-title">{ad.copy.headline}</h2>
          <p>
            this line runs on the stops of riders like you — install we were
            online and the places you visit become stations on everyone's
            commute.
          </p>
          <PosterLink ad={ad} />
        </>
      );
    default: {
      const unhandledAd: never = ad;
      return unhandledAd;
    }
  }
}

export function CommuteStationPoster({
  domain,
  stationVisible,
}: {
  domain: string;
  stationVisible: boolean;
}) {
  const installState = useExtensionInstallState();
  const [open, setOpen] = useState(false);
  const ad =
    installState === "checking"
      ? null
      : getCommuteAd(domain, installState === "missing");

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  if (ad === null) return null;

  return (
    <>
      {stationVisible && (
        <button
          className={`station-install-poster station-install-poster--${ad.id}`}
          type="button"
          aria-label={
            ad.id === "transit-pass"
              ? "Open the internet transit pass poster"
              : `Open the poster: ${ad.copy.headline}`
          }
          style={{ backgroundColor: ad.palette.background }}
          onClick={() => setOpen(true)}
        >
          <PosterArtwork ad={ad} />
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
              className={`commute-poster-dialog commute-poster-dialog--${ad.id}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="commute-poster-title"
              style={{
                backgroundColor: ad.palette.background,
                color: ad.palette.text,
              }}
            >
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
                aria-label={
                  ad.id === "transit-pass"
                    ? "Close the internet transit pass poster"
                    : `Close the poster: ${ad.copy.headline}`
                }
                onClick={() => setOpen(false)}
              >
                ×
              </button>
              <PosterContent ad={ad} />
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
