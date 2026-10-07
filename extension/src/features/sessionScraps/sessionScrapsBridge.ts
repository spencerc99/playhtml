// ABOUTME: The message contract a hosted collage page uses to ask for this browsing session's image scraps.
// ABOUTME: Matches the walking-together collage table's page side; the extension decides what "this session" is.

import type { SessionScrap, SessionWindow } from "./sessionScraps";

/**
 * Both directions are posted to the page's own window and origin:
 *  - page → extension: { source, type: "request-scraps", requestId, since?, until? }
 *  - extension → page: { source, type: "scraps-response", requestId, scraps, window }
 * `since`/`until` are optional epoch milliseconds; without them the session is
 * the latest burst of browsing. A page elsewhere gets no answer at all.
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
}

export interface SessionScrapsResponseMessage {
  source: typeof SESSION_SCRAPS_BRIDGE_SOURCE;
  type: typeof SESSION_SCRAPS_RESPONSE;
  requestId: string;
  scraps: SessionScrap[];
  window: SessionWindow | null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Pages allowed to ask for scraps: playhtml.fun event pages, plus local dev
 * servers when `allowLocal` is set (never in a store build).
 */
export function isSessionScrapsPageUrl(value: string, allowLocal = false): boolean {
  try {
    const url = new URL(value);
    if (url.origin === "https://playhtml.fun") {
      return url.pathname.startsWith("/events/");
    }
    return allowLocal && url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
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
    isTime(message.until)
  );
}
