// ABOUTME: Batches a provider's outgoing Yjs updates so rapid setData calls share messages.
// ABOUTME: Sends the first change right away, then at most one merged message per interval.
import * as Y from "yjs";

// 20 messages a second keeps remote views live while cutting a 60 Hz stream
// of writes to a third of the messages.
export const UPDATE_SEND_INTERVAL_MS = 50;

type UpdateHandler = (update: Uint8Array, origin: unknown) => void;

type CoalescableProvider = {
  doc: Y.Doc;
  _updateHandler: UpdateHandler;
};

export type UpdateCoalescer = {
  /** Sends any buffered updates now. */
  flush: () => void;
};

/**
 * Replaces the provider's doc update listener with one that merges updates
 * made within UPDATE_SEND_INTERVAL_MS into a single message. The provider's
 * own handler still does the sending, so its origin checks and transports are
 * unchanged. Buffered updates are also in the doc, so anything not yet sent
 * when the socket drops is covered by the next sync.
 */
export function coalesceProviderUpdates(
  provider: CoalescableProvider,
): UpdateCoalescer {
  const send = provider._updateHandler;
  if (typeof send !== "function") {
    throw new Error("Provider has no _updateHandler to coalesce");
  }
  const pending: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSentAt = -Infinity;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const merged = pending.length === 1 ? pending[0] : Y.mergeUpdates(pending);
    pending.length = 0;
    lastSentAt = Date.now();
    send(merged, null);
  };

  const handler: UpdateHandler = (update, origin) => {
    // Updates the provider applied from the server are never sent back.
    if (origin === provider) return;
    pending.push(update);
    if (timer !== null) return;
    const wait = lastSentAt + UPDATE_SEND_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      flush();
      return;
    }
    timer = setTimeout(flush, wait);
  };

  provider.doc.off("update", send);
  provider._updateHandler = handler;
  provider.doc.on("update", handler);
  return { flush };
}
