// ABOUTME: Opens inventory from the manifest command or its direct page shortcut fallback.
// ABOUTME: Keeps the shortcut working when a browser leaves the extension command unassigned.

import browser from "webextension-polyfill";

export function registerKeyboardSummon(onOpen: () => void): () => void {
  const handler = (msg: unknown) => {
    if (typeof msg === "object" && msg !== null && (msg as { type?: string }).type === "wwo:open-inventory") {
      onOpen();
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (
      !event.shiftKey ||
      event.altKey ||
      (!event.metaKey && !event.ctrlKey) ||
      (key !== "i" && key !== "b")
    ) {
      return;
    }
    event.preventDefault();
    onOpen();
  };
  browser.runtime.onMessage.addListener(handler);
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    browser.runtime.onMessage.removeListener(handler);
    window.removeEventListener("keydown", onKeyDown, true);
  };
}
