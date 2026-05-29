// ABOUTME: Forwards newly ingested cursor events to the LiveEventsHub durable object.
// ABOUTME: Fire-and-forget — broadcast failures are logged and never fail ingest.

import type { CollectionEvent } from '@playhtml/extension-types';

/** Single global hub instance. */
const HUB_NAME = 'global';

export async function broadcastLiveEvents(
  namespace: DurableObjectNamespace,
  events: CollectionEvent[],
): Promise<void> {
  const cursorEvents = events.filter((e) => e.type === 'cursor');
  if (cursorEvents.length === 0) return;

  try {
    const id = namespace.idFromName(HUB_NAME);
    const stub = namespace.get(id);
    await stub.fetch(
      new Request('https://do/broadcast', {
        method: 'POST',
        body: JSON.stringify({ events: cursorEvents }),
      }),
    );
  } catch (err) {
    console.warn('[broadcast] live event forward failed:', err);
  }
}
