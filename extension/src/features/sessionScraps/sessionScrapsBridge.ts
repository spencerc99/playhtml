// ABOUTME: The message contract a hosted collage page uses to ask for this browsing session's image scraps.
// ABOUTME: Matches the walking-together collage table's page side; the extension decides what "this session" is.

import type { SessionScrap, SessionWindow } from "./sessionScraps";

/**
 * Both directions are posted to the page's own window and origin:
 *  - page → extension: { source, type: "request-scraps", requestId, since?, until? }
 *  - extension → page: { source, type: "scraps-response", requestId, scraps, window }
 * `since`/`until` are optional epoch milliseconds; without them the session is
 * the latest burst of browsing. `scope: "library"` asks instead for the newest
 * image scraps from the whole history, which only a shared collage page may do.
 * A page elsewhere gets no answer at all.
 */
export const SESSION_SCRAPS_BRIDGE_SOURCE = "wwo-session-scraps";
export const SESSION_SCRAPS_REQUEST = "request-scraps";
export const SESSION_SCRAPS_RESPONSE = "scraps-response";

export interface SessionScrapsRequestMessage {
  source: typeof SESSION_SCRAPS_BRIDGE_SOURCE;
  type: typeof SESSION_SCRAPS_REQUEST;
  requestId: string;
  since?: number;
  until?: number;
  scope?: SessionScrapsScope;
}

/** "session" is one stretch of browsing; "library" is everything, newest first. */
export type SessionScrapsScope = "session" | "library";

export interface SessionScrapsResponseMessage {
  source: typeof SESSION_SCRAPS_BRIDGE_SOURCE;
  type: typeof SESSION_SCRAPS_RESPONSE;
  requestId: string;
  scraps: SessionScrap[];
  window: SessionWindow | null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function isLocalPage(url: URL, allowLocal: boolean): boolean {
  return allowLocal && url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
}

/**
 * Shared collage pages on wewere.online, plus local dev servers when
 * `allowLocal` is set (never in a store build). Only these may ask for the
 * whole scraps library, since they show it to no one but the person whose
 * library it is: other people only see the scraps they place.
 */
export function isSharedCollagePageUrl(value: string, allowLocal = false): boolean {
  try {
    const url = new URL(value);
    if (url.origin === "https://wewere.online") {
      return url.pathname === "/together" || url.pathname.startsWith("/together/");
    }
    return isLocalPage(url, allowLocal) && url.pathname.startsWith("/together");
  } catch {
    return false;
  }
}

/**
 * Pages allowed to ask for scraps: playhtml.fun event pages and shared
 * collage pages, plus local dev servers when `allowLocal` is set (never in a
 * store build).
 */
export function isSessionScrapsPageUrl(value: string, allowLocal = false): boolean {
  try {
    const url = new URL(value);
    if (url.origin === "https://playhtml.fun") {
      return url.pathname.startsWith("/events/");
    }
    if (isSharedCollagePageUrl(value, allowLocal)) return true;
    return isLocalPage(url, allowLocal);
  } catch {
    return false;
  }
}

/** Whether this build may serve local dev pages. */
export const ALLOW_LOCAL_SESSION_SCRAPS_PAGES =
  import.meta.env.MODE !== "production";

function isTime(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

export function isSessionScrapsRequest(
  value: unknown,
): value is SessionScrapsRequestMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<SessionScrapsRequestMessage>;
  return (
    message.source === SESSION_SCRAPS_BRIDGE_SOURCE &&
    message.type === SESSION_SCRAPS_REQUEST &&
    typeof message.requestId === "string" &&
    isTime(message.since) &&
    isTime(message.until) &&
    (message.scope === undefined ||
      message.scope === "session" ||
      message.scope === "library")
  );
}
