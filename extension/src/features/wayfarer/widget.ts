// ABOUTME: Injects the wayfarer map widget into host pages and records where the person goes.
// ABOUTME: The widget itself is an extension page in an iframe, so host-page CSP never blocks it.

import browser from "webextension-polyfill";
import { INTERNET_MAP_URL } from "@movement/config";
import { injectShadow } from "../../entrypoints/content/inject-ui";
import { WAYFARER_WIDGET_KEY, normalizeWidgetState } from "./journey";

const HOST_ID = "wwo-wayfarer-root";
const EXPANDED_HEIGHT = 184;
const COLLAPSED_HEIGHT = 28;
const WIDTH = 248;
const POLL_MS = 750;

const WIDGET_CSS = `
  :host { all: initial; }
  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    color-scheme: normal;
  }
`;

function hostStyleFor(height: number): string {
  return `position:fixed;right:16px;bottom:16px;z-index:2147483646;width:${WIDTH}px;height:${height}px;`;
}

/** The map page hosts the walker itself — no need to frame it inside itself. */
function isMapPage(href: string): boolean {
  try {
    const map = new URL(INTERNET_MAP_URL);
    return href.startsWith(`${map.origin}${map.pathname}`);
  } catch {
    return false;
  }
}

function isSupportedPage(): boolean {
  if (window.top !== window) return false;
  const protocol = window.location.protocol;
  if (protocol !== "http:" && protocol !== "https:") return false;
  if (isMapPage(window.location.href)) return false;
  return true;
}

/**
 * Show the walking map in the corner of this page and tell the background
 * where we are, now and whenever the person moves on. Returns a cleanup that
 * removes the widget and stops listening.
 */
export function initWayfarerWidget(): () => void {
  if (!isSupportedPage()) return () => {};
  if (document.getElementById(HOST_ID)) return () => {};

  const { host, shadow } = injectShadow({
    hostId: HOST_ID,
    hostStyle: hostStyleFor(EXPANDED_HEIGHT),
    css: WIDGET_CSS,
  });

  const frame = document.createElement("iframe");
  frame.src = browser.runtime.getURL("wayfarer.html");
  frame.title = "we were online map";
  frame.setAttribute("aria-label", "we were online map");
  shadow.appendChild(frame);

  const applyCollapsed = (collapsed: boolean) => {
    host.style.height = `${collapsed ? COLLAPSED_HEIGHT : EXPANDED_HEIGHT}px`;
  };

  void browser.storage.local
    .get(WAYFARER_WIDGET_KEY)
    .then((stored) => {
      applyCollapsed(normalizeWidgetState(stored?.[WAYFARER_WIDGET_KEY]).collapsed);
    })
    .catch(() => {});

  const onStorageChanged = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName !== "local") return;
    const change = changes[WAYFARER_WIDGET_KEY];
    if (!change) return;
    applyCollapsed(normalizeWidgetState(change.newValue).collapsed);
  };
  browser.storage.onChanged?.addListener(onStorageChanged);

  let lastHref = "";
  const recordVisit = () => {
    lastHref = window.location.href;
    void browser.runtime
      .sendMessage({
        type: "WAYFARER_VISIT",
        url: window.location.href,
        title: document.title,
      })
      .catch(() => {});
  };

  const recordIfMoved = () => {
    if (window.location.href === lastHref) return;
    recordVisit();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") recordVisit();
  };

  recordVisit();

  // Poll rather than patching history: content.ts already wraps pushState for
  // another feature, and a second wrapper on the same page is a good way to
  // lose someone else's calls.
  const pollId = window.setInterval(recordIfMoved, POLL_MS);
  window.addEventListener("popstate", recordIfMoved);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    window.clearInterval(pollId);
    window.removeEventListener("popstate", recordIfMoved);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    browser.storage.onChanged?.removeListener(onStorageChanged);
    host.remove();
  };
}
