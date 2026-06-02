// ABOUTME: Stack of pending announcement postcards rendered at top of popup home.
// ABOUTME: Loads candidates from storage, hides itself when empty, alternates tilt.

import { useEffect, useState, useCallback } from "react";
import { AnnouncementPostcard } from "./AnnouncementPostcard";
import { getPostcardCandidates, setState } from "./announcement-storage";
import type { Announcement } from "./announcements";
import "./announcements.scss";

export function PostcardStack() {
  const [items, setItems] = useState<Announcement[]>([]);

  const load = useCallback(async () => {
    setItems(await getPostcardCandidates());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onDismiss = useCallback(
    async (id: string) => {
      await setState(id, "dismissed");
      setItems((prev) => prev.filter((a) => a.id !== id));
    },
    [],
  );

  const onCtaClick = useCallback((_id: string, href: string) => {
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
