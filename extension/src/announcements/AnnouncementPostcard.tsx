// ABOUTME: Letter-styled announcement notification shown in the extension popup home.
// ABOUTME: Collapsed by default (dot + subject); click to expand into body + CTA + dismiss.

import { useState } from "react";
import type { Announcement } from "./announcements";

interface Props {
  announcement: Announcement;
  onDismiss: (id: string) => void;
  onCtaClick: (id: string, href: string) => void;
}

// Format the shippedAt timestamp like "MAY 2026" for the cancellation watermark.
function formatPostmark(ts: number): string {
  const d = new Date(ts);
  const month = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const year = d.getFullYear();
  return `${month} ${year}`;
}

export function AnnouncementPostcard({ announcement, onDismiss, onCtaClick }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [exiting, setExiting] = useState(false);

  function handleDismiss(e?: React.MouseEvent) {
    e?.stopPropagation();
    setExiting(true);
    setTimeout(() => onDismiss(announcement.id), 200);
  }

  function handleCardClick() {
    if (!expanded) setExpanded(true);
  }

  function handleCta(e: React.MouseEvent) {
    if (!announcement.cta) return;
    e.preventDefault();
    e.stopPropagation();
    onCtaClick(announcement.id, announcement.cta.href);
    setExiting(true);
    setTimeout(() => onDismiss(announcement.id), 200);
  }

  const postmark = formatPostmark(announcement.shippedAt);

  return (
    <article
      className={`announcement-postcard ${exiting ? "is-exiting" : ""} ${
        expanded ? "is-expanded" : "is-collapsed"
      }`}
      onClick={handleCardClick}
      role="button"
      aria-expanded={expanded}
      aria-label={expanded ? undefined : `open: ${announcement.title}`}
    >
      <div className="announcement-postcard__cancel" aria-hidden>
        <span className="announcement-postcard__cancel-mark">wwo</span>
        <span className="announcement-postcard__cancel-arc" />
        <span className="announcement-postcard__cancel-date">{postmark}</span>
      </div>

      <div className="announcement-postcard__row">
        <span className="announcement-postcard__dot-slot" aria-hidden>
          <span className="announcement-postcard__dot" />
        </span>
        <h3 className="announcement-postcard__title">{announcement.title}</h3>
        {expanded ? (
          <button
            type="button"
            className="announcement-postcard__close"
            aria-label="dismiss"
            onClick={handleDismiss}
          >
            ×
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="announcement-postcard__body-wrap">
          <p className="announcement-postcard__body">{announcement.body}</p>
          {announcement.cta ? (
            <a
              className="announcement-postcard__cta"
              href={announcement.cta.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleCta}
            >
              {announcement.cta.label}
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
