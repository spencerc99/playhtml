// ABOUTME: Relays a shared collage page's name and "keep this collage" messages through the content script.
// ABOUTME: The background checks the tab's address again, so a page elsewhere can do neither.

import browser from "webextension-polyfill";
import {
  ALLOW_LOCAL_SESSION_SCRAPS_PAGES,
  isSharedCollagePageUrl,
} from "../sessionScraps/sessionScrapsBridge";
import { isRememberMessage, isSetNameMessage } from "./sharedCollageEntry";

export function initSharedCollageContentBridge(): () => void {
  if (
    !isSharedCollagePageUrl(
      window.location.href,
      ALLOW_LOCAL_SESSION_SCRAPS_PAGES,
    )
  ) {
    return () => {};
  }

  const receivePageMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    if (isSetNameMessage(event.data)) {
      void browser.runtime
        .sendMessage({ type: "SET_PLAYER_NAME", name: event.data.name })
        .catch(() => {});
    } else if (isRememberMessage(event.data)) {
      void browser.runtime
        .sendMessage({
          type: "REMEMBER_SHARED_COLLAGE",
          collage: event.data.collage,
        })
        .catch(() => {});
    }
  };

  window.addEventListener("message", receivePageMessage);
  return () => window.removeEventListener("message", receivePageMessage);
}
