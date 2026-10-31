// ABOUTME: Asks the we were online extension for this person's own image scraps, for the shared studio's drawer.
// ABOUTME: Only the extension can answer; without it the drawer stays empty and the collage can still be arranged.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  SESSION_SCRAPS_BRIDGE_SOURCE,
  SESSION_SCRAPS_REQUEST,
  SESSION_SCRAPS_RESPONSE,
} from "@extension/features/sessionScraps/sessionScrapsBridge";

/** Scraps whose size the extension did not record land in this shape. */
const FALLBACK_SIZE = { width: 400, height: 300 };
const RETRY_MS = 250;
/** The first read of a large library can take a few seconds. */
const GIVE_UP_MS = 12000;

function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The extension's answer as drawer items, newest first, dropping anything malformed. */
export function libraryItems(scraps: unknown): ScrapItem[] {
  if (!Array.isArray(scraps)) return [];
  return scraps.flatMap((value): ScrapItem[] => {
    if (!value || typeof value !== "object") return [];
    const scrap = value as Record<string, unknown>;
    if (typeof scrap.id !== "string" || !isWebUrl(scrap.src)) return [];
    const pageUrl = isWebUrl(scrap.pageUrl) ? scrap.pageUrl : "";
    const width =
      typeof scrap.width === "number" && scrap.width > 0
        ? scrap.width
        : FALLBACK_SIZE.width;
    const height =
      typeof scrap.height === "number" && scrap.height > 0
        ? scrap.height
        : FALLBACK_SIZE.height;
    return [
      {
        kind: "image",
        id: scrap.id,
        key: scrap.id,
        src: scrap.src,
        ...(typeof scrap.alt === "string" && scrap.alt
          ? { alt: scrap.alt }
          : {}),
        naturalWidth: width,
        naturalHeight: height,
        pageTitle: "",
        domain: hostOf(pageUrl || scrap.src),
        pageUrl,
        ts: typeof scrap.capturedAt === "number" ? scrap.capturedAt : 0,
      },
    ];
  });
}

/** Asks once, retrying while the content script may still be loading; null when nothing answers. */
export function requestLibrary(
  win: Window = window,
): Promise<ScrapItem[] | null> {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: ScrapItem[] | null) => {
      if (done) return;
      done = true;
      win.clearInterval(retry);
      win.clearTimeout(giveUp);
      win.removeEventListener("message", onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== win) return;
      const data = event.data as Record<string, unknown> | null;
      if (
        !data ||
        data.source !== SESSION_SCRAPS_BRIDGE_SOURCE ||
        data.type !== SESSION_SCRAPS_RESPONSE ||
        data.requestId !== requestId
      ) {
        return;
      }
      finish(libraryItems(data.scraps));
    };
    const send = () =>
      win.postMessage(
        {
          source: SESSION_SCRAPS_BRIDGE_SOURCE,
          type: SESSION_SCRAPS_REQUEST,
          requestId,
          scope: "library",
        },
        win.location.origin,
      );
    win.addEventListener("message", onMessage);
    const retry = win.setInterval(send, RETRY_MS);
    const giveUp = win.setTimeout(() => finish(null), GIVE_UP_MS);
    send();
  });
}

/**
 * This person's scraps for the drawer, or null when no extension answered.
 * Asks again whenever the tab comes back into view, so scraps collected in
 * another tab show up without a reload.
 */
export function useLibraryScraps(): ScrapItem[] | null {
  const [items, setItems] = useState<ScrapItem[] | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const result = await requestLibrary();
    inFlight.current = false;
    // A missed answer on a later refresh keeps what is already there.
    if (result) setItems(result);
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return items;
}
