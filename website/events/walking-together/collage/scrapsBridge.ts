// ABOUTME: Page side of the bridge that lets the we were online extension hand this
// ABOUTME: browsing session's scraps to the collage table, over window.postMessage.

/**
 * Contract shared with the extension's content script (it owns which scraps
 * count as "this browsing session"):
 *  - page → extension: { source, type: "request-scraps", requestId }
 *  - extension → page: { source, type: "scraps-response", requestId, scraps }
 * Both are posted to window with the page's own origin. No answer means no
 * extension, and the table keeps its drag, paste, and link inputs.
 */
export const SESSION_SCRAPS_SOURCE = "wwo-session-scraps";
export const SESSION_SCRAPS_REQUEST = "request-scraps";
export const SESSION_SCRAPS_RESPONSE = "scraps-response";

/** One scrap the extension offers. `src` is the original public image URL,
 * since everyone else's browser renders it from the shared table. */
export interface SessionScrap {
  id: string;
  src: string;
  pageUrl?: string;
  alt?: string;
  width?: number;
  height?: number;
  capturedAt: number;
}

export interface SessionScrapsResponse {
  source: typeof SESSION_SCRAPS_SOURCE;
  type: typeof SESSION_SCRAPS_RESPONSE;
  requestId: string;
  scraps: SessionScrap[];
}

function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Keeps only well-formed scraps with a public image URL, newest first. */
export function cleanSessionScraps(scraps: unknown): SessionScrap[] {
  if (!Array.isArray(scraps)) return [];
  return scraps
    .filter(
      (s): s is SessionScrap =>
        !!s &&
        typeof s === "object" &&
        typeof (s as SessionScrap).id === "string" &&
        isWebUrl((s as SessionScrap).src),
    )
    .map((s) => ({
      id: s.id,
      src: s.src,
      ...(isWebUrl(s.pageUrl) ? { pageUrl: s.pageUrl } : {}),
      ...(typeof s.alt === "string" && s.alt ? { alt: s.alt } : {}),
      ...(typeof s.width === "number" && s.width > 0 ? { width: s.width } : {}),
      ...(typeof s.height === "number" && s.height > 0
        ? { height: s.height }
        : {}),
      capturedAt: typeof s.capturedAt === "number" ? s.capturedAt : 0,
    }))
    .sort((a, b) => b.capturedAt - a.capturedAt);
}

export function isSessionScrapsResponse(
  data: unknown,
  requestId: string,
): data is SessionScrapsResponse {
  return (
    !!data &&
    typeof data === "object" &&
    (data as SessionScrapsResponse).source === SESSION_SCRAPS_SOURCE &&
    (data as SessionScrapsResponse).type === SESSION_SCRAPS_RESPONSE &&
    (data as SessionScrapsResponse).requestId === requestId
  );
}

const RETRY_MS = 250;
const GIVE_UP_MS = 3000;

/**
 * Asks the extension for this browsing session's scraps. Retries while the
 * content script may still be loading; resolves null when nothing answers.
 */
export function requestSessionScraps(
  win: Window = window,
): Promise<SessionScrap[] | null> {
  const requestId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: SessionScrap[] | null) => {
      if (done) return;
      done = true;
      win.clearInterval(retry);
      win.clearTimeout(giveUp);
      win.removeEventListener("message", onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== win) return;
      if (!isSessionScrapsResponse(event.data, requestId)) return;
      finish(cleanSessionScraps(event.data.scraps));
    };
    const send = () =>
      win.postMessage(
        {
          source: SESSION_SCRAPS_SOURCE,
          type: SESSION_SCRAPS_REQUEST,
          requestId,
        },
        win.location.origin,
      );
    win.addEventListener("message", onMessage);
    const retry = win.setInterval(send, RETRY_MS);
    const giveUp = win.setTimeout(() => finish(null), GIVE_UP_MS);
    send();
  });
}
