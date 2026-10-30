// ABOUTME: Relays a hosted collage page's request for session scraps through the content script.
// ABOUTME: The background checks the tab's URL again, so a page elsewhere never receives scraps.

import browser from "webextension-polyfill";
import {
  ALLOW_LOCAL_SESSION_SCRAPS_PAGES,
  SESSION_SCRAPS_BRIDGE_SOURCE,
  SESSION_SCRAPS_RESPONSE,
  isSessionScrapsPageUrl,
  isSessionScrapsRequest,
  type SessionScrapsResponseMessage,
} from "./sessionScrapsBridge";
import type { SessionScrapsAnswer } from "./sessionScraps";

export function initSessionScrapsContentBridge(): () => void {
  if (!isSessionScrapsPageUrl(window.location.href, ALLOW_LOCAL_SESSION_SCRAPS_PAGES)) {
    return () => {};
  }
  // The page repeats a request until answered; each one is served once.
  const handled = new Set<string>();

  const receivePageMessage = (event: MessageEvent) => {
    if (event.source !== window || !isSessionScrapsRequest(event.data)) return;
    const { requestId, since, until } = event.data;
    if (handled.has(requestId)) return;
    handled.add(requestId);
    browser.runtime
      .sendMessage({ type: "GET_SESSION_SCRAPS", since, until })
      .then((answer: SessionScrapsAnswer | null) => {
        // No answer means this page is not allowed; staying silent looks
        // the same to the page as having no extension.
        if (!answer) return;
        window.postMessage(
          {
            source: SESSION_SCRAPS_BRIDGE_SOURCE,
            type: SESSION_SCRAPS_RESPONSE,
            requestId,
            scraps: answer.scraps,
            window: answer.window,
          } satisfies SessionScrapsResponseMessage,
          window.location.origin,
        );
      })
      .catch(() => {
        handled.delete(requestId);
      });
  };

  window.addEventListener("message", receivePageMessage);
  return () => window.removeEventListener("message", receivePageMessage);
}
