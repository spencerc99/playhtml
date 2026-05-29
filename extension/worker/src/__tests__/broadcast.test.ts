// ABOUTME: Tests for the ingest→DO broadcast forwarder.
// ABOUTME: Verifies only cursor events are forwarded and failures never throw.

import { describe, it, expect, vi } from 'vitest';
import { broadcastLiveEvents } from '../live/broadcast';
import type { CollectionEvent } from '@playhtml/extension-types';

function ev(id: string, type: CollectionEvent['type']): CollectionEvent {
  return { id, type, ts: 1, data: {}, meta: { pid: 'p', sid: 's' } } as CollectionEvent;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeNamespace(stubFetch: ReturnType<typeof vi.fn<any>>) {
  return {
    idFromName: vi.fn(() => 'id'),
    get: vi.fn(() => ({ fetch: stubFetch })),
  } as unknown as DurableObjectNamespace;
}

describe('broadcastLiveEvents', () => {
  it('forwards only cursor events to the DO', async () => {
    const stubFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const ns = fakeNamespace(stubFetch);

    await broadcastLiveEvents(ns, [ev('a', 'cursor'), ev('b', 'navigation'), ev('c', 'cursor')]);

    expect(stubFetch).toHaveBeenCalledTimes(1);
    const sentReq = (stubFetch.mock.calls[0] as unknown[])[0] as Request;
    const body = (await sentReq.json()) as { events: CollectionEvent[] };
    expect(body.events.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('does nothing when there are no cursor events', async () => {
    const stubFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const ns = fakeNamespace(stubFetch);
    await broadcastLiveEvents(ns, [ev('b', 'navigation')]);
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it('never throws when the DO fetch rejects', async () => {
    const stubFetch = vi.fn(async () => {
      throw new Error('DO unreachable');
    });
    const ns = fakeNamespace(stubFetch);
    await expect(broadcastLiveEvents(ns, [ev('a', 'cursor')])).resolves.toBeUndefined();
  });
});
