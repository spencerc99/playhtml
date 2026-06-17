// ABOUTME: Registers a listener for the manifest "open-inventory" command (forwarded from background).
// ABOUTME: Reliable across sites because it rides browser.commands, not a page keydown.

import browser from "webextension-polyfill";

export function registerKeyboardSummon(onOpen: () => void): () => void {
  const handler = (msg: unknown) => {
    if (typeof msg === "object" && msg !== null && (msg as { type?: string }).type === "wwo:open-inventory") {
      onOpen();
    }
  };
  browser.runtime.onMessage.addListener(handler);
  return () => browser.runtime.onMessage.removeListener(handler);
}
