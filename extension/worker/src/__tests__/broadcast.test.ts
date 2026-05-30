// ABOUTME: Tests for the ingest→DO broadcast forwarder.
// ABOUTME: Verifies cursor-only forwarding, cursor-color enrichment, and that failures never throw.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Supabase client so the color lookup is deterministic and offline.
const mockColorRows: { pid: string; cursor_color: string | null }[] = [];
vi.mock('../lib/supabase', () => ({
  createSupabaseClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        in: async () => ({ data: mockColorRows }),
      }),
    }),
  })),
}));

import { broadcastLiveEvents } from '../live/broadcast';
import type { Env } from '../lib/supabase';
import type { CollectionEvent } from '@playhtml/extension-types';

const ENV = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
} as unknown as Env;

function ev(id: string, type: CollectionEvent['type'], pid = 'p'): CollectionEvent {
  return { id, type, ts: 1, data: {}, meta: { pid, sid: 's' } } as CollectionEvent;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeNamespace(stubFetch: ReturnType<typeof vi.fn<any>>) {
  return {
    idFromName: vi.fn(() => 'id'),
    get: vi.fn(() => ({ fetch: stubFetch })),
  } as unknown as DurableObjectNamespace;
}

// Each test uses a unique pid so the module-level color cache doesn't leak
// between cases.
let pidCounter = 0;
function uniquePid(): string {
  return `pk_test_${pidCounter++}`;
}

describe('broadcastLiveEvents', () => {
  beforeEach(() => {
    mockColorRows.length = 0;
  });

  it('forwards only cursor events to the DO', async () => {
    const stubFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const ns = fakeNamespace(stubFetch);
    const pid = uniquePid();

    await broadcastLiveEvents(
      ns,
      ENV,
      [ev('a', 'cursor', pid), ev('b', 'navigation', pid), ev('c', 'cursor', pid)],
      1000,
    );

    expect(stubFetch).toHaveBeenCalledTimes(1);
    const sentReq = (stubFetch.mock.calls[0] as unknown[])[0] as Request;
    const body = (await sentReq.json()) as { events: CollectionEvent[] };
    expect(body.events.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('enriches forwarded events with the participant cursor color', async () => {
    const pid = uniquePid();
    mockColorRows.push({ pid, cursor_color: '#4a9a8a' });
    const stubFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const ns = fakeNamespace(stubFetch);

    await broadcastLiveEvents(ns, ENV, [ev('a', 'cursor', pid)], 1000);

    const sentReq = (stubFetch.mock.calls[0] as unknown[])[0] as Request;
    const body = (await sentReq.json()) as { events: CollectionEvent[] };
    expect(body.events[0].meta.cursor_color).toBe('#4a9a8a');
  });

  it('leaves events uncolored when the participant has no stored color', async () => {
    const pid = uniquePid();
    const stubFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const ns = fakeNamespace(stubFetch);

    await broadcastLiveEvents(ns, ENV, [ev('a', 'cursor', pid)], 1000);

    const sentReq = (stubFetch.mock.calls[0] as unknown[])[0] as Request;
    const body = (await sentReq.json()) as { events: CollectionEvent[] };
    expect(body.events[0].meta.cursor_color).toBeUndefined();
  });

  it('does nothing when there are no cursor events', async () => {
    const stubFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const ns = fakeNamespace(stubFetch);
    await broadcastLiveEvents(ns, ENV, [ev('b', 'navigation')], 1000);
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it('never throws when the DO fetch rejects', async () => {
    const stubFetch = vi.fn(async () => {
      throw new Error('DO unreachable');
    });
    const ns = fakeNamespace(stubFetch);
    await expect(
      broadcastLiveEvents(ns, ENV, [ev('a', 'cursor', uniquePid())], 1000),
    ).resolves.toBeUndefined();
  });
});
