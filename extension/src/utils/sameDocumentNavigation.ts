// ABOUTME: Tells a tab's content script when its page changed URL without loading (history.pushState/replaceState).
// ABOUTME: The background relays webNavigation events; the content script handles each new URL once.

/** Background → content script: the main frame's URL changed through the History API. */
export const SAME_DOCUMENT_NAVIGATION_MESSAGE = "wwo:same-document-navigation";

interface HistoryStateDetails {
  tabId: number;
  frameId: number;
  url: string;
}

/** The part of `browser.webNavigation` the relay uses. */
export interface HistoryStateEvents {
  onHistoryStateUpdated?: {
    addListener(callback: (details: HistoryStateDetails) => void): void;
  };
}

type SendToTab = (
  tabId: number,
  message: { type: typeof SAME_DOCUMENT_NAVIGATION_MESSAGE; url: string },
  options: { frameId: number },
) => Promise<unknown>;

/** True for the error a tab without a listening content script answers with. */
function isMissingReceiver(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Receiving end does not exist");
}

/**
 * Forwards main-frame History API navigations to that tab's content script.
 * A content script's own `history.pushState` patch runs in its isolated world
 * and never sees the page's calls, so the background is the only place these
 * are observable. Returns false when the browser has no
 * `webNavigation.onHistoryStateUpdated` (Safari, which lacks the permission);
 * there the content script only sees back/forward through `popstate`.
 *
 * A tab whose content script is absent or not listening yet (browser pages,
 * a page still loading) is skipped quietly.
 */
export function relaySameDocumentNavigations(
  webNavigation: HistoryStateEvents | undefined,
  sendToTab: SendToTab,
): boolean {
  const onHistoryStateUpdated = webNavigation?.onHistoryStateUpdated;
  if (!onHistoryStateUpdated) return false;

  onHistoryStateUpdated.addListener(({ tabId, frameId, url }) => {
    if (frameId !== 0) return;
    sendToTab(
      tabId,
      { type: SAME_DOCUMENT_NAVIGATION_MESSAGE, url },
      { frameId: 0 },
    ).catch((error: unknown) => {
      if (isMissingReceiver(error)) return;
      console.warn("[Navigation] Could not tell the tab about a page change:", error);
    });
  });
  return true;
}

/**
 * Wraps a content-script navigation handler so it runs once per URL. One
 * back/forward step reaches the content script twice (its `popstate` and the
 * background's relay), and a `replaceState` that keeps the URL reaches it
 * once with nothing to do.
 */
export function onEachNewUrl(
  handle: () => void,
  currentHref: () => string = () => window.location.href,
): () => void {
  let lastHref = currentHref();
  return () => {
    const href = currentHref();
    if (href === lastHref) return;
    lastHref = href;
    handle();
  };
}
