// ABOUTME: A Wikipedia article link that shows a hovercard preview on hover.
// ABOUTME: Builds its own card from the page/summary REST API (Wikipedia's native popup can't reach our shadow DOM).

import { useRef, useState, useCallback } from "react";
import {
  fetchWikiSummary,
  getCachedSummary,
  wikipediaUrlForTitle,
  type WikiSummary,
} from "../features/wiki-summary";

const HOVER_OPEN_DELAY_MS = 350;
const HOVER_CLOSE_DELAY_MS = 150;

interface Props {
  title: string;
  className?: string;
}

export function WikiArticleLink({ title, className }: Props) {
  const [summary, setSummary] = useState<WikiSummary | null | undefined>(() =>
    getCachedSummary(title),
  );
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const onEnter = useCallback(() => {
    clearTimers();
    openTimer.current = window.setTimeout(() => {
      // Anchor the fixed-position card just above the link so it escapes the
      // panel's scrolling/clipping body.
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) {
        setPos({ left: rect.left, bottom: window.innerHeight - rect.top + 6 });
      }
      setOpen(true);
      if (summary === undefined) {
        void fetchWikiSummary(title).then((s) => setSummary(s));
      }
    }, HOVER_OPEN_DELAY_MS);
  }, [clearTimers, summary, title]);

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
          style={{ left: `${pos.left}px`, bottom: `${pos.bottom}px` }}
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
