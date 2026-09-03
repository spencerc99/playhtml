// ABOUTME: Durable Object that holds website WebSocket connections and a ring buffer.
// ABOUTME: Replays recent events on connect, then broadcasts live events filtered per socket.

import type { Env } from '../lib/supabase';
import { getValidEventTypes, type CollectionEvent } from '@playhtml/extension-types';

// The buffer is a TIME window, not a count: it holds (and replays on connect)
// only events from roughly the last couple of minutes, so the live portrait is
// a firehose of recent activity ("now") rather than a long rolling history.
const MAX_AGE_MS = 2 * 60_000;

// Hard cap on buffered events as a memory backstop for traffic spikes, applied
// on top of the time window. At ~10 events per trail this is roughly one
// canvas-worth (~60 trails); a viral burst is trimmed to the most recent.
const MAX_BUFFER = 600;

interface BroadcastBody {
  events: CollectionEvent[];
}

/** Frame sent to clients: a batch of events. Same shape for replay and live. */
interface StreamFrame {
  events: CollectionEvent[];
}

/** Sockets that connect without a `types` query param get cursor events only,
 * matching the behavior clients relied on before per-socket filtering. */
const DEFAULT_TYPES: ReadonlySet<string> = new Set(['cursor']);

/** Parse the `types` query param into a set of valid event types. Invalid or
 * empty selections fall back to the cursor-only default. */
function parseTypesParam(raw: string | null): ReadonlySet<string> {
  if (!raw) return DEFAULT_TYPES;
  const valid = new Set<string>(getValidEventTypes());
  const requested = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => valid.has(t));
  return requested.length > 0 ? new Set(requested) : DEFAULT_TYPES;
}

export class LiveEventsHub {
  private buffer: CollectionEvent[] = [];
  private sockets = new Map<WebSocket, ReadonlySet<string>>();

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const body = (await request.json()) as BroadcastBody;
      this.ingestBroadcast(body.events ?? []);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/ws') {
      return this.handleWebSocket(parseTypesParam(url.searchParams.get('types')));
    }

    return new Response('Not found', { status: 404 });
  }

  private ingestBroadcast(events: CollectionEvent[]): void {
    if (events.length === 0) return;
    this.buffer.push(...events);
    this.pruneBuffer();
    this.send({ events });
  }

  /** Drop events older than the time window, then enforce the memory backstop.
   * Always filters (no sorted-buffer assumption) — ingest order is only roughly
   * chronological, so an old event can sit behind a newer one. At MAX_BUFFER the
   * scan is trivially cheap. */
  private pruneBuffer(): void {
    const cutoff = Date.now() - MAX_AGE_MS;
    this.buffer = this.buffer.filter((e) => e.ts >= cutoff);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer = this.buffer.slice(this.buffer.length - MAX_BUFFER);
    }
  }

  private handleWebSocket(types: ReadonlySet<string>): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    this.sockets.set(server, types);

    // Drop anything that aged out since the last ingest so a freshly-connected
    // client only ever receives recent activity.
    this.pruneBuffer();
    const replay = this.buffer.filter((e) => types.has(e.type));
    if (replay.length > 0) {
      try {
        server.send(JSON.stringify({ events: replay } as StreamFrame));
      } catch {
        // connection may have closed instantly
      }
    }

    const drop = () => this.sockets.delete(server);
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    return new Response(null, { status: 101, webSocket: client });
  }

  private send(frame: StreamFrame): void {
    // Serialize once per distinct type selection, not per socket.
    const payloads = new Map<string, string | null>();
    for (const [ws, types] of [...this.sockets]) {
      const key = [...types].sort().join(',');
      let payload = payloads.get(key);
      if (payload === undefined) {
        const events = frame.events.filter((e) => types.has(e.type));
        payload = events.length > 0 ? JSON.stringify({ events } as StreamFrame) : null;
        payloads.set(key, payload);
      }
      if (payload === null) continue;
      try {
        ws.send(payload);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }

  bufferSizeForTest(): number {
    return this.buffer.length;
  }
  bufferForTest(): CollectionEvent[] {
    return this.buffer;
  }
  socketsForTest(): WebSocket[] {
    return [...this.sockets.keys()];
  }
}
