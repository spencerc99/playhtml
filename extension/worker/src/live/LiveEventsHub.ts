// ABOUTME: Durable Object that holds website WebSocket connections and a ring buffer.
// ABOUTME: Replays recent cursor events on connect, then broadcasts live events from ingest.

import type { Env } from '../lib/supabase';
import type { CollectionEvent } from '@playhtml/extension-types';

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

export class LiveEventsHub {
  private buffer: CollectionEvent[] = [];
  private sockets = new Set<WebSocket>();

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
      return this.handleWebSocket();
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

  private handleWebSocket(): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    this.sockets.add(server);

    // Drop anything that aged out since the last ingest so a freshly-connected
    // client only ever receives recent activity.
    this.pruneBuffer();
    if (this.buffer.length > 0) {
      try {
        server.send(JSON.stringify({ events: this.buffer } as StreamFrame));
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
    const payload = JSON.stringify(frame);
    for (const ws of [...this.sockets]) {
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
    return [...this.sockets];
  }
}
