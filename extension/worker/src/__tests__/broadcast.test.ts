// ABOUTME: Tests for the ingest→DO broadcast forwarder.
// ABOUTME: Verifies live payload privacy, cursor-color enrichment, and failure isolation.

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

function ev(
  id: string,
  type: CollectionEvent['type'],
  pid = 'p',
): CollectionEvent {
  return {
    id,
    type,
    ts: 1,
    data: {},
    meta: {
      pid,
      sid: 's',
      url: 'https://example.com/page',
      vw: 1440,
      vh: 900,
      tz: 'America/New_York',
    },
  } as CollectionEvent;
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

  it('forwards cursor, viewport, and keyboard events to the DO', async () => {
    const stubFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const ns = fakeNamespace(stubFetch);
    const pid = uniquePid();

    await broadcastLiveEvents(
      ns,
      ENV,
      [
        ev('a', 'cursor', pid),
        ev('b', 'navigation', pid),
        ev('c', 'viewport', pid),
        ev('d', 'keyboard', pid),
      ],
      1000,
    );

    expect(stubFetch).toHaveBeenCalledTimes(1);
    const sentReq = (stubFetch.mock.calls[0] as unknown[])[0] as Request;
    const body = (await sentReq.json()) as { events: CollectionEvent[] };
    expect(body.events.map((e) => e.id)).toEqual(['a', 'c', 'd']);
  });

  it('projects keyboard events to redacted live-only payloads', async () => {
    const stubFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const ns = fakeNamespace(stubFetch);
    const pid = uniquePid();
    const keyboardEvent = {
      ...ev('keyboard', 'keyboard', pid),
      data: {
        x: 0.25,
        y: 0.75,
        t: '#private-message',
        event: 'type',
        sequence: [
          {
            action: 'type',
            text: 'secret',
            timestamp: 0,
            unexpected: 'another secret',
          },
          { action: 'backspace', deletedCount: 2, timestamp: 140 },
          { action: 'type', text: 'o🙂', timestamp: 220 },
        ],
        style: { w: 320, h: 48, br: 8, bg: 0.9, bs: 1, font: 'private' },
        ce: true,
        unexpected: 'top-level secret',
      },
    } as CollectionEvent;

    await broadcastLiveEvents(ns, ENV, [keyboardEvent], 1000);

    const sentReq = (stubFetch.mock.calls[0] as unknown[])[0] as Request;
    const bodyText = await sentReq.text();
    const body = JSON.parse(bodyText) as { events: CollectionEvent[] };
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('#private-message');
    expect(bodyText).not.toContain('private');
    expect(body.events[0].data).toEqual({
      x: 0.25,
      y: 0.75,
      event: 'type',
      sequence: [
        {
          action: 'type',
          text: '\u2588\u2588\u2588\u2588\u2588\u2588',
          timestamp: 0,
        },
        { action: 'backspace', deletedCount: 2, timestamp: 140 },
        { action: 'type', text: '\u2588\u2588', timestamp: 220 },
      ],
      style: { w: 320, h: 48, br: 8, bg: 0.9, bs: 1 },
    });
  });

  it('preserves null keyboard sequences without copying other keyboard data', async () => {
    const stubFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const ns = fakeNamespace(stubFetch);
    const keyboardEvent = {
      ...ev('keyboard', 'keyboard', uniquePid()),
      data: {
        x: 0.1,
        y: 0.2,
        event: 'type',
        sequence: null,
        text: 'must not leave ingest',
      },
    } as CollectionEvent;

    await broadcastLiveEvents(ns, ENV, [keyboardEvent], 1000);

    const sentReq = (stubFetch.mock.calls[0] as unknown[])[0] as Request;
    const body = (await sentReq.json()) as { events: CollectionEvent[] };
    expect(body.events[0].data).toEqual({
      x: 0.1,
      y: 0.2,
      event: 'type',
      sequence: null,
    });
  });

  it('projects cursor and viewport events to renderer-only payloads', async () => {
    const stubFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const ns = fakeNamespace(stubFetch);
    const pid = uniquePid();
    const cursor = {
      ...ev('cursor', 'cursor', pid),
      data: {
        x: 0.3,
        y: 0.4,
        scrollX: 12,
        scrollY: 34,
        t: '#private-account',
        event: 'move',
        cursor: 'pointer',
        unexpected: 'cursor secret',
      },
      topLevelSecret: 'top-level secret',
    } as CollectionEvent;
    const viewport = {
      ...ev('viewport', 'viewport', pid),
      data: {
        event: 'scroll',
        scrollX: 0.1,
        scrollY: 0.8,
        scrollDistancePx: 200,
        unexpected: 'viewport secret',
      },
      meta: {
        ...ev('viewport', 'viewport', pid).meta,
        unexpected: 'meta secret',
      },
    } as CollectionEvent;

    await broadcastLiveEvents(ns, ENV, [cursor, viewport], 1000);

    const sentReq = (stubFetch.mock.calls[0] as unknown[])[0] as Request;
    const bodyText = await sentReq.text();
    const body = JSON.parse(bodyText) as { events: CollectionEvent[] };
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('#private-account');
    expect(body.events.map((event) => event.data)).toEqual([
      {
        x: 0.3,
        y: 0.4,
        scrollX: 12,
        scrollY: 34,
        event: 'move',
        cursor: 'pointer',
      },
      {
        event: 'scroll',
        scrollX: 0.1,
        scrollY: 0.8,
        scrollDistancePx: 200,
      },
    ]);
  });

  it('removes private URL components from every forwarded event', async () => {
    const stubFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const ns = fakeNamespace(stubFetch);
    const pid = uniquePid();
    const events = (['cursor', 'viewport', 'keyboard'] as const).map(
      (type, index) => ({
        ...ev(String(index), type, pid),
        normalizedUrl:
          'https://example.com/private/path?normalized=secret#part',
        meta: {
          ...ev(String(index), type, pid).meta,
          url: 'https://person:password@example.com/private/path?token=secret#part',
        },
      }),
    );

    await broadcastLiveEvents(ns, ENV, events, 1000);

    const sentReq = (stubFetch.mock.calls[0] as unknown[])[0] as Request;
    const bodyText = await sentReq.text();
    const body = JSON.parse(bodyText) as { events: CollectionEvent[] };
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('password');
    expect(body.events.map((event) => event.meta.url)).toEqual([
      'https://example.com/private/path',
      'https://example.com/private/path',
      'https://example.com/private/path',
    ]);
    expect(body.events.map((event) => event.normalizedUrl)).toEqual([
      'https://example.com/private/path',
      'https://example.com/private/path',
      'https://example.com/private/path',
    ]);
  });

  it('does not forward malformed URLs raw', async () => {
    const stubFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const ns = fakeNamespace(stubFetch);
    const event = {
      ...ev('cursor', 'cursor', uniquePid()),
      normalizedUrl: 'not a URL?secret=value',
      meta: {
        ...ev('cursor', 'cursor').meta,
        url: 'not a URL?token=secret',
      },
    };

    await broadcastLiveEvents(ns, ENV, [event], 1000);

    const sentReq = (stubFetch.mock.calls[0] as unknown[])[0] as Request;
    const bodyText = await sentReq.text();
    const body = JSON.parse(bodyText) as { events: CollectionEvent[] };
    expect(bodyText).not.toContain('secret');
    expect(body.events[0].meta.url).toBe('');
    expect(body.events[0].normalizedUrl).toBeUndefined();
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

  it('does nothing when there are no renderable live events', async () => {
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
    // The rejection is logged via console.warn — capture it so the test output
    // stays pristine and assert it surfaced.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      broadcastLiveEvents(ns, ENV, [ev('a', 'cursor', uniquePid())], 1000),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      '[broadcast] live event forward failed:',
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
