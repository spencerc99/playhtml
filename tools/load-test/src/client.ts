// ABOUTME: Virtual user client that simulates a real playhtml user.
// ABOUTME: Uses SyncedStore + YPartyKitProvider to exercise the actual sync stack.

import * as Y from "yjs";
import { syncedStore, getYjsDoc } from "@syncedstore/core";
import YPartyKitProvider from "y-partykit/provider";

export interface ClientEvent {
  type:
    | "connect"
    | "first-sync"
    | "write"
    | "write-received"
    | "awareness-sent"
    | "awareness-received"
    | "disconnect"
    | "error";
  ts: number;
  data?: Record<string, unknown>;
}

export interface VirtualClientOptions {
  roomId: string;
  host: string; // e.g. "localhost:1999" or "playhtml.spencerc99.partykit.dev"
  clientId: string;
}

export class VirtualClient {
  readonly clientId: string;
  private doc: Y.Doc;
  private store: ReturnType<typeof syncedStore>;
  private provider: YPartyKitProvider;
  private events: ClientEvent[] = [];
  private connected = false;
  private firstSynced = false;
  private connectTime = 0;
  private lastWriteTs = 0;

  constructor(private opts: VirtualClientOptions) {
    this.clientId = opts.clientId;
    this.doc = new Y.Doc();
    this.store = syncedStore({ play: {} }, this.doc);
    this.provider = new YPartyKitProvider(opts.host, opts.roomId, this.doc, {
      connect: false,
    });

    this.provider.on("status", ({ status }: { status: string }) => {
      if (status === "connected") {
        this.connected = true;
        this.connectTime = Date.now();
        this.record("connect");
      } else if (status === "disconnected") {
        this.connected = false;
        this.record("disconnect");
      }
    });

    this.provider.on("sync", (isSynced: boolean) => {
      if (isSynced && !this.firstSynced) {
        this.firstSynced = true;
        this.record("first-sync", { connectToSyncMs: Date.now() - this.connectTime });
      }
    });

    // Track remote updates to measure write propagation latency.
    // When we receive an update from the server (not our own local write),
    // record the time since our last write as the round-trip time.
    this.doc.on("update", (_update: Uint8Array, origin: unknown) => {
      if (origin === this.provider && this.lastWriteTs > 0) {
        const rttMs = Date.now() - this.lastWriteTs;
        this.record("write-received", { rttMs });
      }
    });
  }

  connect() {
    this.connectTime = Date.now();
    this.provider.connect();
  }

  disconnect() {
    this.provider.destroy();
    this.doc.destroy();
  }

  isConnected() {
    return this.connected;
  }

  isSynced() {
    return this.firstSynced;
  }

  /** Write a value into the shared store and record the write timestamp. */
  write(path: string[], value: unknown) {
    const writeId = `${this.clientId}-${Date.now()}`;
    this.record("write", { writeId, path, valueSize: JSON.stringify(value).length });
    this.lastWriteTs = Date.now();

    // Navigate/create nested path in store.play
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node: any = this.store.play;
    for (let i = 0; i < path.length - 1; i++) {
      if (!node[path[i]]) node[path[i]] = {};
      node = node[path[i]];
    }
    node[path[path.length - 1]] = value;

    return writeId;
  }

  /** Append to a Y.Array path (for live-chat scenario). */
  appendToArray(path: string[], value: unknown) {
    const writeId = `${this.clientId}-${Date.now()}`;
    this.record("write", { writeId, path, valueSize: JSON.stringify(value).length });
    this.lastWriteTs = Date.now();

    // Use Y.Doc directly — SyncedStore's proxy doesn't support .push() on arrays.
    const yMap = this.doc.getMap("play");
    let current: Y.Map<unknown> = yMap;
    for (let i = 0; i < path.length - 1; i++) {
      if (!current.has(path[i])) {
        current.set(path[i], new Y.Map());
      }
      current = current.get(path[i]) as Y.Map<unknown>;
    }
    const arrayKey = path[path.length - 1];
    if (!current.has(arrayKey)) {
      current.set(arrayKey, new Y.Array());
    }
    const yArr = current.get(arrayKey) as Y.Array<unknown>;
    yArr.push([value]);

    return writeId;
  }

  /** Send awareness update (cursor position etc.) */
  setAwareness(data: Record<string, unknown>) {
    this.provider.awareness.setLocalStateField("user", {
      id: this.clientId,
      ...data,
    });
    this.record("awareness-sent");
  }

  getEvents(): ClientEvent[] {
    return [...this.events];
  }

  private record(type: ClientEvent["type"], data?: Record<string, unknown>) {
    this.events.push({ type, ts: Date.now(), data });
  }
}
