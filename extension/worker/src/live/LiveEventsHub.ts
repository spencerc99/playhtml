// ABOUTME: Durable Object that holds website WebSocket connections and a ring buffer.
// ABOUTME: Replays recent cursor events on connect, then broadcasts live events from ingest.

import type { Env } from '../lib/supabase';
import type { CollectionEvent } from '@playhtml/extension-types';

const BUFFER_SIZE = 200;

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
    if (this.buffer.length > BUFFER_SIZE) {
      this.buffer = this.buffer.slice(this.buffer.length - BUFFER_SIZE);
    }
    this.send({ events });
  }

  private handleWebSocket(): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    this.sockets.add(server);

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
