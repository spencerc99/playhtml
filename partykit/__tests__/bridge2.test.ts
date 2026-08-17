// ABOUTME: Exercises version 2 shared-element operation forwarding between rooms.
// ABOUTME: Covers subscriptions, authority, failures, deduplication, and lease expiry.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ClientOperationMessage } from "@playhtml/common";
import { V2Store } from "../../packages/playhtml/src/v2/store";
import {
  V2_BRIDGE_STORAGE_KEYS,
  createBridge2Request,
  type Bridge2ForwardOperationRequest,
  type Bridge2Subscriber,
} from "../bridge2";

class FakeDurableObject {
  constructor(
    public ctx: unknown,
    public env: unknown,
  ) {}
}

type RoomServer = {
  onRequest(request: Request): Promise<Response>;
};

const rooms = new Map<string, RoomServer>();
const SOURCE_ROOM_ID = "source-%2Froom";
const deliveredRequests: Array<{ roomName: string; body: unknown }> = [];
const workerEnv: Record<string, unknown> = {
  SUPABASE_LOAD_ATTEMPTS: "1",
  SUPABASE_LOAD_RETRY_DELAY_MS: "1",
  SUPABASE_LOAD_TIMEOUT_MS: "100",
  V2: {
    idFromName(name: string) {
      return name;
    },
    get(name: string) {
      return {
        async setName() {},
        async fetch(request: Request) {
          const room = rooms.get(name);
          if (!room) throw new Error(`Room ${name} is unavailable`);
          const body = await request.clone().json();
          deliveredRequests.push({ roomName: name, body });
          return room.onRequest(request);
        },
      };
    },
  },
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

const persistedRows = new Map<string, PersistedRow>();
const readErrors = new Map<string, Error>();

const supabaseStub = {
  from() {
    return {
      select() {
        return {
          eq(_column: string, roomName: string) {
            return {
              abortSignal() {
                return {
                  async maybeSingle() {
                    const error = readErrors.get(roomName);
                    if (error) {
                      return { data: null, error: { message: error.message } };
                    }
                    return {
                      data: structuredClone(
                        persistedRows.get(roomName) ?? null,
                      ),
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
      async upsert(row: Record<string, unknown>) {
        persistedRows.set(
          row.name as string,
          structuredClone(row) as PersistedRow,
        );
        return { error: null };
      },
    };
  },
};

mock.module(`${import.meta.dir}/../db.ts`, () => ({ supabase: supabaseStub }));

const { PartyServerV2 } = await import(`${import.meta.dir}/../party2.ts`);

class FakeStorage {
  values = new Map<string, unknown>();
  alarm: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async setAlarm(timestamp: number): Promise<void> {
    this.alarm = timestamp;
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

function createConnection(id: string): FakeConnection {
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

function createRoom(name: string) {
  const storage = new FakeStorage();
  const ctx = {
    storage,
    id: { name },
    async blockConcurrencyWhile(operation: () => Promise<void>) {
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
  rooms.set(name, room);
  return { room, storage, connections };
}

function roomUrl(
  roomName: string,
  params: Record<string, unknown> = {},
): string {
  const url = new URL(`https://example.com/parties/v2/${roomName}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, JSON.stringify(value));
  }
  return url.toString();
}

async function startRoom(room: InstanceType<typeof PartyServerV2>) {
  await room.__unsafe_ensureInitialized();
}

async function connectRoom(
  roomState: ReturnType<typeof createRoom>,
  connectionId: string,
  params: Record<string, unknown> = {},
): Promise<FakeConnection> {
  const connection = createConnection(connectionId);
  roomState.connections.push(connection);
  await roomState.room.onConnect(connection as never, {
    request: new Request(roomUrl(roomState.room.name, params)),
  });
  return connection;
}

function setMessage(
  elementId: string,
  count: number,
  overrides: Partial<ClientOperationMessage> = {},
): ClientOperationMessage {
  return {
    type: "operation",
    protocolVersion: 2,
    generation: 0,
    clientId: "source-client",
    mutationId: count,
    operation: {
      type: "set",
      capability: "can-play",
      elementId,
      path: [],
      value: { count },
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

async function setupBridge(permission: "read-only" | "read-write") {
  const source = createRoom(SOURCE_ROOM_ID);
  const consumer = createRoom("consumer-room");
  await startRoom(source.room);
  await startRoom(consumer.room);
  const sourceConnection = await connectRoom(source, "source-client", {
    sharedElements: [{ elementId: "counter", permissions: permission }],
  });
  await source.room.onMessage(
    sourceConnection as never,
    JSON.stringify(setMessage("counter", 1)),
  );
  const consumerConnection = await connectRoom(consumer, "consumer-client", {
    sharedReferences: [
      { domain: "source", path: "/room", elementId: "counter" },
    ],
  });
  return { source, consumer, sourceConnection, consumerConnection };
}

beforeEach(() => {
  rooms.clear();
  deliveredRequests.length = 0;
  persistedRows.clear();
  readErrors.clear();
});

describe("PartyServerV2 shared-element bridge", () => {
  test("keeps consumer writes out of the client view until the source echo", () => {
    const sent: ClientOperationMessage[] = [];
    const store = new V2Store({
      snapshot: {
        state: { "can-play": { counter: { count: 1 } } },
        arrays: [],
        lastMutationIds: {},
      },
      generation: 0,
      sequence: 0,
      clientId: "consumer-writer",
      echoWaitElementIds: ["counter"],
      transport: {
        send(message) {
          sent.push(message);
        },
        requestSnapshot() {},
      },
    });

    store.mutate("can-play", "counter", (draft) => {
      (draft as { count: number }).count = 2;
    });
    expect(store.getSnapshot().state["can-play"].counter).toEqual({ count: 1 });

    store.applyServerOperation({
      sequence: 1,
      generation: 0,
      clientId: "consumer-writer",
      mutationId: 1,
      operation: sent[0].operation,
    });
    expect(store.getSnapshot().state["can-play"].counter).toEqual({ count: 2 });
  });

  test("subscribes, forwards a source operation, and broadcasts in the consumer", async () => {
    const bridge = await setupBridge("read-write");
    expect(parsedMessages(bridge.consumerConnection)).toContainEqual(
      expect.objectContaining({
        type: "snapshot",
        snapshot: expect.objectContaining({
          state: { "can-play": { counter: { count: 1 } } },
        }),
      }),
    );
    bridge.consumerConnection.sent = [];

    await bridge.source.room.onMessage(
      bridge.sourceConnection as never,
      JSON.stringify(setMessage("counter", 2)),
    );

    expect(parsedMessages(bridge.consumerConnection)).toEqual([
      expect.objectContaining({
        type: "operation",
        payload: expect.objectContaining({
          sequence: 1,
          operation: expect.objectContaining({
            elementId: "counter",
            value: { count: 2 },
          }),
        }),
      }),
    ]);
  });

  test("forwards a consumer write to the source and waits for its echoed operation", async () => {
    const bridge = await setupBridge("read-write");
    bridge.consumerConnection.sent = [];
    bridge.sourceConnection.sent = [];
    const write = setMessage("counter", 3, {
      clientId: "consumer-writer",
      mutationId: 1,
    });

    await bridge.consumer.room.onMessage(
      bridge.consumerConnection as never,
      JSON.stringify(write),
    );

    expect(parsedMessages(bridge.sourceConnection)).toEqual([
      expect.objectContaining({
        type: "operation",
        payload: expect.objectContaining({ clientId: "consumer-writer" }),
      }),
    ]);
    expect(parsedMessages(bridge.consumerConnection)).toEqual([
      expect.objectContaining({
        type: "operation",
        payload: expect.objectContaining({
          clientId: "consumer-writer",
          operation: expect.objectContaining({ value: { count: 3 } }),
        }),
      }),
    ]);
  });

  test("rejects consumer writes to a read-only source element", async () => {
    const bridge = await setupBridge("read-only");
    bridge.consumerConnection.sent = [];

    await bridge.consumer.room.onMessage(
      bridge.consumerConnection as never,
      JSON.stringify(
        setMessage("counter", 2, {
          clientId: "consumer-writer",
          mutationId: 1,
        }),
      ),
    );

    expect(parsedMessages(bridge.consumerConnection)).toEqual([
      expect.objectContaining({
        type: "operation-rejected",
        code: "permission-denied",
      }),
    ]);
  });

  test("rejects a consumer write when the source is transient", async () => {
    readErrors.set(SOURCE_ROOM_ID, new Error("database offline"));
    persistedRows.set("consumer-room", {
      document: null,
      protocol_version: 2,
      document_json: {
        sequence: 0,
        generation: 0,
        snapshot: {
          state: { "can-play": { counter: { count: 1 } } },
          arrays: [],
          lastMutationIds: {},
        },
      },
    });
    const source = createRoom(SOURCE_ROOM_ID);
    const consumer = createRoom("consumer-room");
    const originalError = console.error;
    console.error = () => {};
    try {
      await startRoom(source.room);
    } finally {
      console.error = originalError;
    }
    await startRoom(consumer.room);
    const connection = await connectRoom(consumer, "consumer-client", {
      sharedReferences: [
        { domain: "source", path: "/room", elementId: "counter" },
      ],
    });
    expect(parsedMessages(connection)).toContainEqual(
      expect.objectContaining({
        type: "snapshot",
        snapshot: expect.objectContaining({
          state: { "can-play": { counter: { count: 1 } } },
        }),
      }),
    );
    connection.sent = [];

    await consumer.room.onMessage(
      connection as never,
      JSON.stringify(
        setMessage("counter", 2, {
          clientId: "consumer-writer",
          mutationId: 1,
        }),
      ),
    );

    expect(parsedMessages(connection)).toEqual([
      expect.objectContaining({
        type: "operation-rejected",
        code: "room-unavailable",
      }),
    ]);
  });

  test("deduplicates a redelivered source operation by room and sequence", async () => {
    const bridge = await setupBridge("read-write");
    bridge.consumerConnection.sent = [];
    await bridge.source.room.onMessage(
      bridge.sourceConnection as never,
      JSON.stringify(setMessage("counter", 2)),
    );
    const delivery = deliveredRequests.findLast(
      ({ roomName, body }) =>
        roomName === "consumer-room" &&
        (body as { action?: string }).action === "bridge2-forward-operation",
    );
    expect(delivery).toBeDefined();

    const response = await bridge.consumer.room.onRequest(
      createBridge2Request(
        "/forward",
        delivery!.body as Bridge2ForwardOperationRequest,
      ),
    );

    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ ok: true, applied: false });
    expect(parsedMessages(bridge.consumerConnection)).toHaveLength(1);
  });

  test("removes expired subscriber leases on alarm", async () => {
    const bridge = await setupBridge("read-write");
    const subscribers = (await bridge.source.storage.get<Bridge2Subscriber[]>(
      V2_BRIDGE_STORAGE_KEYS.subscribers,
    ))!;
    subscribers[0].lastSeen = new Date(0).toISOString();
    await bridge.source.storage.put(
      V2_BRIDGE_STORAGE_KEYS.subscribers,
      subscribers,
    );

    await bridge.source.room.onAlarm();

    expect(
      await bridge.source.storage.get(V2_BRIDGE_STORAGE_KEYS.subscribers),
    ).toEqual([]);
  });
});
