// ABOUTME: Tests for the LiveEventsHub Durable Object ring buffer and broadcast.
// ABOUTME: Uses a fake WebSocketPair to exercise replay-on-connect and live fan-out.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Node's Response forbids body/init for a 101 status, but workerd allows it for
// WebSocket upgrades. Shim Response so a 101 upgrade response is constructible
// in the node test runner. The workerd-only `webSocket` init field is ignored.
const RealResponse = globalThis.Response;
class ShimResponse extends RealResponse {
  constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
    if (init?.status === 101) {
      super(null, { ...init, status: 200 });
      Object.defineProperty(this, 'status', { value: 101 });
      return;
    }
    super(body as BodyInit | null, init);
  }
}
(globalThis as unknown as { Response: unknown }).Response = ShimResponse;

// Minimal fake WebSocket capturing sent frames.
class FakeWebSocket {
  sent: string[] = [];
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  readyState = 1; // OPEN
  accept = vi.fn();
  send = (data: string) => {
    this.sent.push(data);
  };
  close = vi.fn(() => {
    this.readyState = 3;
  });
  addEventListener(type: string, fn: (ev: unknown) => void) {
    (this.listeners[type] ||= []).push(fn);
  }
  fire(type: string, ev: unknown) {
    (this.listeners[type] || []).forEach((fn) => fn(ev));
  }
}

beforeEach(() => {
  (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = function () {
    const client = new FakeWebSocket();
    const server = new FakeWebSocket();
    return { 0: client, 1: server } as unknown as Record<number, FakeWebSocket>;
  };
});

import { LiveEventsHub } from '../live/LiveEventsHub';
import type { CollectionEvent } from '@playhtml/extension-types';

function ev(id: string, ts: number = Date.now()): CollectionEvent {
  return {
    id,
    type: 'cursor',
    ts,
    data: { x: 0.5, y: 0.5 },
    meta: { pid: 'pk_x', sid: 'sid_y' },
  } as CollectionEvent;
}

function makeHub(): LiveEventsHub {
  return new LiveEventsHub({} as DurableObjectState, {} as never);
}

describe('LiveEventsHub', () => {
  it('keeps only events within the time window, dropping older ones', async () => {
    const hub = makeHub();
    const now = Date.now();
    const events = [
      ev('old', now - 6 * 60_000), // 6 min ago — well outside the time window
      ev('recent1', now - 60_000), // 1 min ago — kept
      ev('recent2', now), // now — kept
    ];
    await hub.fetch(
      new Request('https://do/broadcast', {
        method: 'POST',
        body: JSON.stringify({ events }),
      }),
    );
    expect(hub.bufferForTest().map((e) => e.id)).toEqual(['recent1', 'recent2']);
  });

  it('prunes old events even when they arrive out of ts order', async () => {
    // Regression: a recent event first, an old one after — an early-exit that
    // assumed the buffer was sorted would have kept the stale event.
    const hub = makeHub();
    const now = Date.now();
    const events = [
      ev('recent', now), // newest, but first in the batch
      ev('stale', now - 6 * 60_000), // old, but arrives after the recent one
    ];
    await hub.fetch(
      new Request('https://do/broadcast', {
        method: 'POST',
        body: JSON.stringify({ events }),
      }),
    );
    expect(hub.bufferForTest().map((e) => e.id)).toEqual(['recent']);
  });

  it('replays the buffer to a newly connected socket', async () => {
    const hub = makeHub();
    await hub.fetch(
      new Request('https://do/broadcast', {
        method: 'POST',
        body: JSON.stringify({ events: [ev('a'), ev('b')] }),
      }),
    );

    const res = await hub.fetch(
      new Request('https://do/ws', { headers: { Upgrade: 'websocket' } }),
    );
    expect(res.status).toBe(101);

    const server = hub.socketsForTest()[0] as unknown as FakeWebSocket;
    expect(server.accept).toHaveBeenCalled();
    const replay = JSON.parse(server.sent[0]);
    expect(replay.events.map((e: CollectionEvent) => e.id)).toEqual(['a', 'b']);
  });

  it('broadcasts new events to connected sockets', async () => {
    const hub = makeHub();
    await hub.fetch(new Request('https://do/ws', { headers: { Upgrade: 'websocket' } }));
    const server = hub.socketsForTest()[0] as unknown as FakeWebSocket;
    const beforeCount = server.sent.length;

    await hub.fetch(
      new Request('https://do/broadcast', {
        method: 'POST',
        body: JSON.stringify({ events: [ev('live1')] }),
      }),
    );

    const newFrames = server.sent.slice(beforeCount).map((s) => JSON.parse(s));
    expect(newFrames.some((f) => f.events?.[0]?.id === 'live1')).toBe(true);
  });
});
