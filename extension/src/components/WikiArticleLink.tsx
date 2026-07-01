// ABOUTME: A Wikipedia article link that shows a hovercard preview on hover.
// ABOUTME: Builds its own card from the page/summary REST API (Wikipedia's native popup can't reach our shadow DOM).

import { useEffect, useRef, useState, useCallback } from "react";
import {
  fetchWikiSummary,
  getCachedSummary,
  wikipediaUrlForTitle,
  type WikiSummary,
} from "../features/wiki-summary";

const HOVER_OPEN_DELAY_MS = 350;
const HOVER_CLOSE_DELAY_MS = 150;
// Keep in sync with .wiki-hovercard width in wikipedia.ts CHAT_PANEL_CSS.
const HOVERCARD_WIDTH = 240;
const HOVERCARD_MAX_HEIGHT = 220;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

type CardPos =
  | { left: number; bottom: number; top?: undefined }
  | { left: number; top: number; bottom?: undefined };

interface Props {
  title: string;
  className?: string;
}

export function WikiArticleLink({ title, className }: Props) {
  const [summary, setSummary] = useState<WikiSummary | null | undefined>(() =>
    getCachedSummary(title),
  );
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CardPos | null>(null);
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => {
    clearTimers();
    setSummary(getCachedSummary(title));
    setOpen(false);
    setPos(null);
  }, [clearTimers, title]);

  const computePos = useCallback((): CardPos | null => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: prefer the link's left edge, but clamp so the full card
    // stays within the viewport (this is what was getting cut off on the
    // right-anchored chat panel).
    const maxLeft = vw - HOVERCARD_WIDTH - VIEWPORT_MARGIN;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft));

    // Vertical: prefer above the link; flip below if there isn't room.
    const spaceAbove = rect.top;
    if (spaceAbove >= HOVERCARD_MAX_HEIGHT + ANCHOR_GAP) {
      return { left, bottom: vh - rect.top + ANCHOR_GAP };
    }
    return { left, top: rect.bottom + ANCHOR_GAP };
  }, []);

  const onEnter = useCallback(() => {
    clearTimers();
    openTimer.current = window.setTimeout(() => {
      setPos(computePos());
      setOpen(true);
      if (summary === undefined) {
        void fetchWikiSummary(title).then((s) => setSummary(s));
      }
    }, HOVER_OPEN_DELAY_MS);
  }, [clearTimers, computePos, summary, title]);

  const onLeave = useCallback(() => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  }, [clearTimers]);

  return (
    <span className="wiki-link-wrap" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <a
        ref={anchorRef}
        className={className}
        href={wikipediaUrlForTitle(title)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {title}
      </a>
      {open && summary && pos ? (
        <span
          className="wiki-hovercard"
          role="tooltip"
          style={
            pos.bottom !== undefined
              ? { left: `${pos.left}px`, bottom: `${pos.bottom}px` }
              : { left: `${pos.left}px`, top: `${pos.top}px` }
          }
        >
          {summary.thumbnail ? (
            <img
              className="wiki-hovercard__thumb"
              src={summary.thumbnail.source}
              alt=""
              loading="lazy"
            />
          ) : null}
          <span className="wiki-hovercard__text">
            <span className="wiki-hovercard__title">{summary.title}</span>
            {summary.description ? (
              <span className="wiki-hovercard__desc">{summary.description}</span>
            ) : null}
            <span className="wiki-hovercard__extract">{summary.extract}</span>
          </span>
        </span>
      ) : null}
    </span>
  );
}
