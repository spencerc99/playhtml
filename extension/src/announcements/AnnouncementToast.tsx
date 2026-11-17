// ABOUTME: System-styled toast surfacing a new announcement on a matching page.
// ABOUTME: Its link opens the CTA and dismisses; × dismisses; auto-dismisses after 8s (paused on hover).

import { useEffect, useRef, useState } from "react";
import type { Announcement } from "./announcements";

const AUTO_DISMISS_MS = 8000;

interface Props {
  announcement: Announcement;
  onShown: (id: string) => void;
  onDismiss: () => void;
  onCtaClick: (id: string, href: string) => void;
}

export function AnnouncementToast({ announcement, onShown, onDismiss, onCtaClick }: Props) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    onShown(announcement.id);
    armTimer();
    return () => clearTimer();
  }, []);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function armTimer() {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      dismiss();
    }, AUTO_DISMISS_MS);
  }

  function dismiss() {
    if (exiting) return;
    setExiting(true);
    setTimeout(onDismiss, 200);
  }

  // Extension-page CTAs only appear on popup postcards; a page toast can only
  // link out to the web.
  const ctaHref = announcement.cta?.href;

  function handleClose() {
    dismiss();
  }

  return (
    <div
      className={`announcement-toast ${exiting ? "is-exiting" : ""}`}
      onMouseEnter={clearTimer}
      onMouseLeave={armTimer}
      role="alert"
    >
      <div className="announcement-toast__chrome">
        <span className="announcement-toast__title">
          <span className="announcement-toast__new-badge">NEW</span>
          {announcement.title}
        </span>
        <button
          type="button"
          className="announcement-toast__close"
          aria-label="dismiss"
          onClick={handleClose}
        >
          ×
        </button>
      </div>
      <p className="announcement-toast__body">{announcement.body}</p>
      {ctaHref && (
        <a
          className="announcement-toast__cta"
          href={ctaHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            event.preventDefault();
            onCtaClick(announcement.id, ctaHref);
            dismiss();
          }}
        >
          {announcement.cta?.label}
        </a>
      )}
    </div>
  );
}
