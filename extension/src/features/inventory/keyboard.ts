// ABOUTME: Opens or arms inventory from runtime messages and direct page shortcuts.
// ABOUTME: Keeps development controls and browser shortcut fallbacks on one cleanup path.

import browser from "webextension-polyfill";

interface InventoryMessageHandlers {
  onOpen(): void;
  onArm(itemId: string): void;
}

export function registerInventoryMessages(
  handlers: InventoryMessageHandlers,
): () => void {
  const handler = (msg: unknown) => {
    if (typeof msg !== "object" || msg === null) return;
    const message = msg as { type?: string; itemId?: unknown };
    if (message.type === "wwo:open-inventory") {
      handlers.onOpen();
    } else if (
      message.type === "wwo:arm-inventory" &&
      typeof message.itemId === "string"
    ) {
      handlers.onArm(message.itemId);
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
    handlers.onOpen();
  };
  browser.runtime.onMessage.addListener(handler);
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    browser.runtime.onMessage.removeListener(handler);
    window.removeEventListener("keydown", onKeyDown, true);
  };
}
