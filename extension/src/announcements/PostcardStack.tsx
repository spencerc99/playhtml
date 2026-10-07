// ABOUTME: Stack of pending announcement postcards rendered at top of popup home.
// ABOUTME: Loads candidates, counts a view per popup open, retires cards on CTA or view limit.

import { useEffect, useState, useCallback } from "react";
import { AnnouncementPostcard } from "./AnnouncementPostcard";
import {
  getPostcardCandidates,
  recordPostcardView,
  setState,
} from "./announcement-storage";
import type { Announcement } from "./announcements";
import "./announcements.scss";

export function PostcardStack() {
  const [items, setItems] = useState<Announcement[]>([]);

  // The stack is a short column of collapsed rows at the top of popup home,
  // so every card rendered on open is in view and counts as one view. The
  // candidates are read before this open's view is recorded, so the limit-th
  // open still shows the card and the next open does not.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const candidates = await getPostcardCandidates();
      if (cancelled) return;
      setItems(candidates);
      for (const a of candidates) await recordPostcardView(a.id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onDismiss = useCallback(
    async (id: string) => {
      await setState(id, "dismissed");
      setItems((prev) => prev.filter((a) => a.id !== id));
    },
    [],
  );

  // Opening a tab closes the popup, so the dismissal is written before the
  // tab opens rather than after the card's exit animation.
  const onCtaClick = useCallback((id: string, href: string) => {
    void setState(id, "dismissed");
    window.open(href, "_blank", "noopener,noreferrer");
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="announcement-stack">
      {items.map((a) => (
        <AnnouncementPostcard
          key={a.id}
          announcement={a}
          onDismiss={onDismiss}
          onCtaClick={onCtaClick}
        />
      ))}
    </div>
  );
}
