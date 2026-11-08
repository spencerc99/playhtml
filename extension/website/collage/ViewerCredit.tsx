// ABOUTME: The collage viewer's bottom-right credit: a small "i" that opens a card saying what internet scraps are.
// ABOUTME: The card links to we were online so someone who likes the collage can make their own.

import { useEffect, useRef, useState } from "react";

export const WWO_HOME_URL = "https://wewere.online/";

export function ViewerCredit() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  /** True while the card is open only because the mouse is over it. */
  const hoverOpenRef = useRef(false);

  // A click anywhere else, or Escape, puts the card away.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      hoverOpenRef.current = false;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      hoverOpenRef.current = false;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="viewer-credit"
      data-open={open}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse" || open) return;
        hoverOpenRef.current = true;
        setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse" || !hoverOpenRef.current) return;
        hoverOpenRef.current = false;
        setOpen(false);
      }}
    >
      {open && (
        <div
          className="viewer-credit__card"
          id="viewer-credit-card"
          role="dialog"
          aria-label="About this collage"
        >
          <div className="viewer-credit__about">
            <img
              className="viewer-credit__icon"
              src="/icon.png"
              alt=""
              width={28}
              height={28}
            />
            <p>
              This collage was made from internet scraps: images and bits of
              pages someone collected while browsing.
            </p>
          </div>
          <a
            className="viewer-credit__cta"
            href={WWO_HOME_URL}
            target="_blank"
            rel="noreferrer"
          >
            <span className="viewer-credit__cta-main">
              collect your own scraps
            </span>
            <span className="viewer-credit__cta-sub">
              we were online, a free browser extension
            </span>
            <span className="viewer-credit__cta-arrow" aria-hidden="true">
              →
            </span>
          </a>
        </div>
      )}
      <button
        type="button"
        className="viewer-credit__dot"
        aria-label="About this collage"
        aria-expanded={open}
        aria-controls="viewer-credit-card"
        onClick={() => {
          // A click on a card the mouse opened keeps it open after leaving.
          if (hoverOpenRef.current) {
            hoverOpenRef.current = false;
            setOpen(true);
          } else {
            setOpen((value) => !value);
          }
        }}
      >
        i
      </button>
    </div>
  );
}

export const VIEWER_CREDIT_STYLES = `
  .viewer-credit {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 40;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    font-family: "Martian Mono", ui-monospace, monospace;
  }

  .viewer-credit__dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--c-rule);
    border-radius: 50%;
    background: var(--c-frame);
    color: var(--c-ink);
    font-family: "Source Serif 4", "Lora", Georgia, serif;
    font-size: 16px;
    font-style: italic;
    line-height: 1;
    box-shadow: 0 3px 10px color-mix(in srgb, var(--c-ink) 14%, transparent);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .viewer-credit__dot:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
  }

  .viewer-credit[data-open="true"] .viewer-credit__dot {
    border-color: color-mix(in srgb, var(--c-ink) 40%, transparent);
  }

  .viewer-credit__card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 280px;
    max-width: calc(100vw - 32px);
    box-sizing: border-box;
    padding: 14px;
    border: 1px solid color-mix(in srgb, var(--c-ink) 18%, transparent);
    border-radius: 8px;
    background: var(--c-frame);
    box-shadow: 0 12px 28px color-mix(in srgb, var(--c-ink) 18%, transparent);
  }

  .viewer-credit__about {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .viewer-credit__icon {
    flex: none;
    border: 1px solid color-mix(in srgb, var(--c-ink) 16%, transparent);
    border-radius: 6px;
  }

  .viewer-credit__about p {
    margin: 0;
    color: var(--c-ink);
    font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.45;
  }

  .viewer-credit__cta {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 40px 10px 14px;
    border-radius: 6px;
    background: var(--c-ink);
    color: var(--c-frame);
    text-decoration: none;
    transition: transform 120ms ease, box-shadow 120ms ease;
  }

  .viewer-credit__cta:hover,
  .viewer-credit__cta:focus-visible {
    color: var(--c-frame);
    transform: translateY(-1px);
    box-shadow: 0 6px 14px color-mix(in srgb, var(--c-ink) 28%, transparent);
  }

  .viewer-credit__cta:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
  }

  .viewer-credit__cta-main {
    font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
    font-size: 14px;
    font-weight: 700;
  }

  .viewer-credit__cta-sub {
    color: color-mix(in srgb, var(--c-frame) 72%, transparent);
    font-size: 10px;
  }

  .viewer-credit__cta-arrow {
    position: absolute;
    top: 50%;
    right: 14px;
    font-size: 16px;
    transform: translateY(-50%);
  }

  @media (prefers-reduced-motion: reduce) {
    .viewer-credit__cta {
      transition: none;
    }
  }
`;
