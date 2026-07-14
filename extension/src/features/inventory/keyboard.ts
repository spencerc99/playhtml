// ABOUTME: Registers runtime-message controls for opening and arming the inventory.
// ABOUTME: Supports manifest commands and development surfaces without exposing inventory state to the page.

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
  browser.runtime.onMessage.addListener(handler);
  return () => browser.runtime.onMessage.removeListener(handler);
}
