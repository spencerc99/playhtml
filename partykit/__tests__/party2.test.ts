// ABOUTME: Exercises the version 2 PartyServer operation and persistence lifecycle.
// ABOUTME: Covers hydration, conversion, deduplication, presence, limits, and restart safety.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ClientOperationMessage, RoomSnapshot } from "@playhtml/common";
import { encodeDocToBase64, jsonToDoc } from "../docUtils";

class FakeDurableObject {
  constructor(
    public ctx: unknown,
    public env: unknown,
  ) {}
}

const workerEnv: Record<string, string> = {
  SUPABASE_LOAD_ATTEMPTS: "1",
  SUPABASE_LOAD_RETRY_DELAY_MS: "1",
  SUPABASE_LOAD_TIMEOUT_MS: "100",
};

mock.module("cloudflare:workers", () => ({
  env: workerEnv,
  DurableObject: FakeDurableObject,
  WorkerEntrypoint: class {},
}));

type PersistedRow = {
  document: string | null;
  document_json: unknown;
  protocol_version: number;
};

let persistedRow: PersistedRow | null = null;
let readError: Error | null = null;
let upsertError: Error | null = null;
let upsertCalls: Array<Record<string, unknown>> = [];
let readSignals: AbortSignal[] = [];
let hangReads = false;

const supabaseStub = {
  from() {
    return {
      select() {
        return {
          eq() {
            return {
              abortSignal(signal: AbortSignal) {
                readSignals.push(signal);
                return {
                  async maybeSingle() {
                    if (hangReads) {
                      return new Promise((_, reject) => {
                        signal.addEventListener("abort", () => {
                          reject(signal.reason);
                        });
                      });
                    }
                    if (readError) {
                      return {
                        data: null,
                        error: { message: readError.message },
                      };
                    }
                    return { data: structuredClone(persistedRow), error: null };
                  },
                };
              },
            };
          },
        };
      },
      async upsert(row: Record<string, unknown>) {
        upsertCalls.push(structuredClone(row));
        if (upsertError) return { error: { message: upsertError.message } };
        persistedRow = structuredClone(row) as PersistedRow;
        return { error: null };
      },
    };
  },
};

mock.module(`${import.meta.dir}/../db.ts`, () => ({ supabase: supabaseStub }));

const { PartyServerV2 } = await import(`${import.meta.dir}/../party2.ts`);

class FakeStorage {
  values = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.values.get(key);
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

type FakeConnection = {
  id: string;
  sent: string[];
  state: Record<string, unknown> | null;
  send(message: string): void;
  close(): void;
  setState(
    next:
      | Record<string, unknown>
      | null
      | ((previous: Record<string, unknown> | null) => Record<string, unknown>),
  ): Record<string, unknown> | null;
};

function createConnection(id = "connection-1"): FakeConnection {
  return {
    id,
    sent: [],
    state: null,
    send(message) {
      this.sent.push(message);
    },
    close() {},
    setState(next) {
      this.state = typeof next === "function" ? next(this.state) : next;
      return this.state;
    },
  };
}

function createRoom(name = "example-room") {
  const storage = new FakeStorage();
  let blockConcurrencyCalls = 0;
  const ctx = {
    storage,
    id: { name },
    async blockConcurrencyWhile(operation: () => Promise<void>) {
      blockConcurrencyCalls += 1;
      await operation();
    },
    waitUntil() {},
    getWebSockets: () => [],
    acceptWebSocket() {},
    getTags: () => [],
  };
  const room = new PartyServerV2(ctx as never, workerEnv as never);
  const connections: FakeConnection[] = [];
  Object.defineProperty(room, "getConnections", {
    value: () => connections,
  });
  Object.defineProperty(room, "broadcast", {
    value: (message: string, without: string[] = []) => {
      for (const connection of connections) {
        if (!without.includes(connection.id)) connection.send(message);
      }
    },
  });
  return {
    room,
    connections,
    getBlockConcurrencyCalls: () => blockConcurrencyCalls,
  };
}

async function startRoom(
  room: InstanceType<typeof PartyServerV2>,
): Promise<void> {
  await room.__unsafe_ensureInitialized();
}

async function connectRoom(
  room: InstanceType<typeof PartyServerV2>,
  connections: FakeConnection[],
  connection = createConnection(),
): Promise<FakeConnection> {
  connections.push(connection);
  await room.onConnect(connection as never, {
    request: new Request("https://example.com/parties/v2/example-room"),
  });
  return connection;
}

function operationMessage(
  overrides: Partial<ClientOperationMessage> = {},
): ClientOperationMessage {
  return {
    type: "operation",
    protocolVersion: 2,
    generation: 0,
    clientId: "client-1",
    mutationId: 1,
    operation: {
      type: "set",
      capability: "can-play",
      elementId: "counter",
      path: [],
      value: { count: 1 },
      arrays: [],
    },
    ...overrides,
  };
}

function parsedMessages(
  connection: FakeConnection,
): Array<Record<string, unknown>> {
  return connection.sent.map((message) => JSON.parse(message));
}

async function closeRoom(
  room: InstanceType<typeof PartyServerV2>,
  connections: FakeConnection[],
  connection: FakeConnection,
): Promise<void> {
  connections.splice(connections.indexOf(connection), 1);
  await room.onClose(connection as never, 1000, "", true);
}

function persistedSnapshot(): RoomSnapshot {
  const documentJson = persistedRow?.document_json as {
    snapshot: RoomSnapshot;
  };
  return documentJson.snapshot;
}

beforeEach(() => {
  persistedRow = null;
  readError = null;
  upsertError = null;
  upsertCalls = [];
  readSignals = [];
  hangReads = false;
  workerEnv.SUPABASE_LOAD_ATTEMPTS = "1";
  workerEnv.SUPABASE_LOAD_TIMEOUT_MS = "100";
  delete workerEnv.V2_MAX_OPERATION_BYTES;
});

describe("PartyServerV2 protocol", () => {
  test("hydrates under the PartyServer concurrency gate and snapshots on connect", async () => {
    const { room, connections, getBlockConcurrencyCalls } = createRoom();
    await startRoom(room);
    const connection = await connectRoom(room, connections);

    expect(getBlockConcurrencyCalls()).toBe(1);
    expect(readSignals).toHaveLength(1);
    expect(readSignals[0].aborted).toBe(false);
    expect(parsedMessages(connection)).toContainEqual({
      type: "snapshot",
      protocolVersion: 2,
      sequence: 0,
      generation: 0,
      snapshot: { state: {}, arrays: [], lastMutationIds: {} },
    });
  });

  test("accepts an operation and broadcasts its ordered echo to every connection", async () => {
    const { room, connections } = createRoom();
    await startRoom(room);
    const sender = await connectRoom(
      room,
      connections,
      createConnection("sender"),
    );
    const peer = await connectRoom(room, connections, createConnection("peer"));
    sender.sent = [];
    peer.sent = [];

    await room.onMessage(sender as never, JSON.stringify(operationMessage()));

    const expected = {
      type: "operation",
      protocolVersion: 2,
      payload: {
        sequence: 1,
        generation: 0,
        clientId: "client-1",
        mutationId: 1,
        operation: operationMessage().operation,
      },
    };
    expect(parsedMessages(sender)).toEqual([expected]);
    expect(parsedMessages(peer)).toEqual([expected]);
    await closeRoom(room, connections, sender);
    await closeRoom(room, connections, peer);
  });

  test("deduplicates a replay by client and mutation id", async () => {
    const { room, connections } = createRoom();
    await startRoom(room);
    const connection = await connectRoom(room, connections);
    connection.sent = [];
    const message = JSON.stringify(operationMessage());

    await room.onMessage(connection as never, message);
    await room.onMessage(connection as never, message);

    expect(parsedMessages(connection)).toHaveLength(1);
    await closeRoom(room, connections, connection);
    expect(persistedSnapshot().lastMutationIds).toEqual({ "client-1": 1 });
  });

  test("rejects a stale room generation", async () => {
    const { room, connections } = createRoom();
    await startRoom(room);
    const connection = await connectRoom(room, connections);
    connection.sent = [];

    await room.onMessage(
      connection as never,
      JSON.stringify(operationMessage({ generation: 1 })),
    );

    expect(parsedMessages(connection)).toEqual([
      expect.objectContaining({
        type: "operation-rejected",
        code: "stale-generation",
        sequence: 0,
      }),
    ]);
  });

  test("sends apply failures only to the operation sender", async () => {
    const { room, connections } = createRoom();
    await startRoom(room);
    const sender = await connectRoom(
      room,
      connections,
      createConnection("sender"),
    );
    const peer = await connectRoom(room, connections, createConnection("peer"));
    sender.sent = [];
    peer.sent = [];
    const invalid = operationMessage({
      operation: {
        type: "increment",
        capability: "can-play",
        elementId: "missing",
        path: [],
        delta: 1,
      },
    });

    await room.onMessage(sender as never, JSON.stringify(invalid));

    expect(parsedMessages(sender)).toEqual([
      expect.objectContaining({ code: "invalid-operation", sequence: 0 }),
    ]);
    expect(peer.sent).toEqual([]);
  });

  test("rejects an operation over the configured size limit", async () => {
    workerEnv.V2_MAX_OPERATION_BYTES = "128";
    const { room, connections } = createRoom();
    await startRoom(room);
    const connection = await connectRoom(room, connections);
    connection.sent = [];
    const message = operationMessage({
      operation: {
        type: "set",
        capability: "can-play",
        elementId: "large",
        path: [],
        value: "x".repeat(512),
        arrays: [],
      },
    });

    await room.onMessage(connection as never, JSON.stringify(message));

    expect(parsedMessages(connection)).toEqual([
      expect.objectContaining({ code: "size-limit", sequence: 0 }),
    ]);
  });

  test("rejects operations before hydration", async () => {
    const { room } = createRoom();
    const connection = createConnection();

    await room.onMessage(
      connection as never,
      JSON.stringify(operationMessage()),
    );

    expect(parsedMessages(connection)).toEqual([
      expect.objectContaining({ code: "room-unavailable", sequence: 0 }),
    ]);
    expect(upsertCalls).toEqual([]);
  });

  test("aborts a timed-out load and enters transient mode without writing", async () => {
    hangReads = true;
    workerEnv.SUPABASE_LOAD_TIMEOUT_MS = "5";
    const { room } = createRoom();
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await startRoom(room);
    } finally {
      console.error = originalError;
    }

    expect(readSignals).toHaveLength(1);
    expect(readSignals[0].aborted).toBe(true);
    expect(errors).toHaveLength(1);
    expect(upsertCalls).toEqual([]);
  });

  test("keeps presence active while transient and never saves operations", async () => {
    readError = new Error("database offline");
    const { room, connections } = createRoom();
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await startRoom(room);
    } finally {
      console.error = originalError;
    }
    const connection = await connectRoom(room, connections);
    connection.sent = [];

    await room.onMessage(
      connection as never,
      JSON.stringify({
        type: "presence-update",
        channel: "status",
        value: "here",
      }),
    );
    await room.onMessage(
      connection as never,
      JSON.stringify(operationMessage()),
    );
    await closeRoom(room, connections, connection);

    expect(parsedMessages(connection)).toContainEqual(
      expect.objectContaining({ type: "presence-changes" }),
    );
    expect(parsedMessages(connection)).toContainEqual(
      expect.objectContaining({ code: "room-unavailable" }),
    );
    expect(errors).toHaveLength(1);
    expect(upsertCalls).toEqual([]);
  });

  test("autosaves snapshot, sequence, and last mutation ids on last disconnect", async () => {
    const { room, connections } = createRoom();
    await startRoom(room);
    const connection = await connectRoom(room, connections);
    await room.onMessage(
      connection as never,
      JSON.stringify(operationMessage()),
    );

    await closeRoom(room, connections, connection);

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toEqual({
      name: "example-room",
      document: null,
      protocol_version: 2,
      document_json: {
        sequence: 1,
        generation: 0,
        snapshot: {
          state: { "can-play": { counter: { count: 1 } } },
          arrays: [],
          lastMutationIds: { "client-1": 1 },
        },
      },
    });
  });

  test("converts a v1 document once and stamps it without changing the original", async () => {
    const document = jsonToDoc({ "can-toggle": { light: { on: true } } });
    const base64 = encodeDocToBase64(document);
    document.destroy();
    persistedRow = {
      document: base64,
      document_json: null,
      protocol_version: 1,
    };

    const first = createRoom();
    await startRoom(first.room);

    expect(upsertCalls).toHaveLength(1);
    expect(persistedRow?.protocol_version).toBe(2);
    expect(persistedRow?.document).toBe(base64);
    expect(persistedSnapshot().state).toEqual({
      "can-toggle": { light: { on: true } },
    });

    upsertCalls = [];
    const restarted = createRoom();
    await startRoom(restarted.room);
    expect(upsertCalls).toEqual([]);
  });

  test("restart hydration prevents a saved mutation replay from applying twice", async () => {
    const first = createRoom();
    await startRoom(first.room);
    const firstConnection = await connectRoom(first.room, first.connections);
    await first.room.onMessage(
      firstConnection as never,
      JSON.stringify(operationMessage()),
    );
    await closeRoom(first.room, first.connections, firstConnection);

    upsertCalls = [];
    const restarted = createRoom();
    await startRoom(restarted.room);
    const replayConnection = await connectRoom(
      restarted.room,
      restarted.connections,
    );
    replayConnection.sent = [];
    await restarted.room.onMessage(
      replayConnection as never,
      JSON.stringify(operationMessage()),
    );
    await closeRoom(restarted.room, restarted.connections, replayConnection);

    expect(replayConnection.sent).toEqual([]);
    expect(upsertCalls).toEqual([]);
    expect(persistedSnapshot().state).toEqual({
      "can-play": { counter: { count: 1 } },
    });
  });
});
