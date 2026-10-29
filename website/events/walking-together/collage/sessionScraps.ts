// ABOUTME: The scraps the extension collected during this browsing session, for the studio's drawer.
// ABOUTME: Refetched whenever the tab comes back into view; null without the extension.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import { requestSessionScraps, type SessionScrap } from "./scrapsBridge";
import { measureImage } from "./measureImage";
import { sessionScrapItem } from "./studioBridge";

/** Newest first, so what someone just saved on the walk is at hand. */
export function newestFirst(scraps: SessionScrap[]): SessionScrap[] {
  return [...scraps].sort((a, b) => b.capturedAt - a.capturedAt);
}

type Size = { width: number; height: number };

/**
 * This person's walk scraps as drawer items, or null when no extension
 * answered. A scrap the extension sent without a size is measured first, so
 * it lands on the table in its own proportions.
 */
export function useSessionScraps(windowMs?: number): ScrapItem[] | null {
  const [scraps, setScraps] = useState<SessionScrap[] | null>(null);
  const [sizes, setSizes] = useState<Record<string, Size | null>>({});
  const inFlight = useRef(false);
  const measuring = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    // With a window, everything saved inside it counts, not just the latest
    // browsing session. The extension still clamps it to its own lookback.
    const since = windowMs === undefined ? undefined : Date.now() - windowMs;
    const result = await requestSessionScraps(window, since);
    inFlight.current = false;
    // A missed answer on a later refresh keeps what we already have.
    if (result) setScraps(newestFirst(result));
  }, [windowMs]);

  // People come back to this tab from walking, so fetch again whenever it
  // regains focus rather than asking them to refresh.
  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onFocus = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    for (const scrap of scraps ?? []) {
      if ((scrap.width && scrap.height) || measuring.current.has(scrap.src))
        continue;
      measuring.current.add(scrap.src);
      void measureImage(scrap.src).then((size) =>
        setSizes((known) => ({ ...known, [scrap.src]: size })),
      );
    }
  }, [scraps]);

  return useMemo(
    () =>
      scraps === null
        ? null
        : scraps.map((scrap) =>
            sessionScrapItem(scrap, sizes[scrap.src] ?? null),
          ),
    [scraps, sizes],
  );
}
