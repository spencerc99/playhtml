// ABOUTME: Postcard-styled announcement card shown in the extension popup home.
// ABOUTME: Slight hand-tilt, envelope chrome, title + body + optional CTA, dismissible.

import { useState } from "react";
import type { Announcement } from "./announcements";

interface Props {
  announcement: Announcement;
  tiltDeg: number; // -2..+2 for visual variety in a stack
  onDismiss: (id: string) => void;
  onCtaClick: (id: string, href: string) => void;
}

export function AnnouncementPostcard({ announcement, tiltDeg, onDismiss, onCtaClick }: Props) {
  const [exiting, setExiting] = useState(false);

  function handleDismiss() {
    setExiting(true);
    setTimeout(() => onDismiss(announcement.id), 200);
  }

  function handleCta(e: React.MouseEvent) {
    if (!announcement.cta) return;
    e.preventDefault();
    onCtaClick(announcement.id, announcement.cta.href);
    setExiting(true);
    setTimeout(() => onDismiss(announcement.id), 200);
  }

  return (
    <article
      className={`announcement-postcard ${exiting ? "is-exiting" : ""}`}
      style={{ transform: `rotate(${tiltDeg}deg)` }}
    >
      <header className="announcement-postcard__chrome">
        <span className="announcement-postcard__from">
          <span className="announcement-postcard__envelope" aria-hidden>
            ✉
          </span>{" "}
          from spencer
        </span>
        <button
          type="button"
          className="announcement-postcard__close"
          aria-label="dismiss"
          onClick={handleDismiss}
        >
          ×
        </button>
      </header>
      <div className="announcement-postcard__rule" />
      <h3 className="announcement-postcard__title">{announcement.title}</h3>
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
    </article>
  );
}
