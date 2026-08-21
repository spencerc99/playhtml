// ABOUTME: Exercises PartyServerV2 persistence under continuous same-path writes.
// ABOUTME: Verifies bounded snapshots, linear array storage, and live-room health.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ClientOperationMessage, RoomSnapshot } from "@playhtml/common";

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
let upsertCalls: Array<Record<string, unknown>> = [];

const supabaseStub = {
  from() {
    return {
      select() {
        return {
          eq() {
            return {
              abortSignal() {
                return {
                  async maybeSingle() {
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
  return { room, connections };
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

function rootSetMessage(
  clientId: string,
  mutationId: number,
  value: { text: string } | { items: [] },
): ClientOperationMessage {
  return {
    type: "operation",
    protocolVersion: 2,
    generation: 0,
    clientId,
    mutationId,
    operation: {
      type: "set",
      capability: "can-play",
      elementId: "counter",
      path: [],
      value,
      arrays:
        "items" in value
          ? [{ path: ["items"], itemIds: [] }]
          : [],
    },
  };
}

function nestedSetMessage(
  clientId: string,
  mutationId: number,
  text: string,
): ClientOperationMessage {
  return {
    type: "operation",
    protocolVersion: 2,
    generation: 0,
    clientId,
    mutationId,
    operation: {
      type: "set",
      capability: "can-play",
      elementId: "counter",
      path: ["text"],
      value: text,
      arrays: [],
    },
  };
}

function insertMessage(
  clientId: string,
  mutationId: number,
  index: number,
): ClientOperationMessage {
  const itemId = `item-${index}`;
  return {
    type: "operation",
    protocolVersion: 2,
    generation: 0,
    clientId,
    mutationId,
    operation: {
      type: "insert",
      capability: "can-play",
      elementId: "counter",
      path: ["items"],
      value: { id: itemId, text: "item" },
      arrays: [],
      target: { kind: "array", index, itemId },
    },
  };
}

function parsedMessages(
  connection: FakeConnection,
): Array<Record<string, unknown>> {
  return connection.sent.map((message) => JSON.parse(message));
}

function copyPersistedRow(): PersistedRow {
  if (persistedRow === null) throw new Error("Expected a persisted room");
  return structuredClone(persistedRow);
}

function documentBytes(row = copyPersistedRow()): number {
  return new TextEncoder().encode(JSON.stringify(row.document_json)).byteLength;
}

async function closeRoom(
  room: InstanceType<typeof PartyServerV2>,
  connections: FakeConnection[],
  connection: FakeConnection,
): Promise<void> {
  connections.splice(connections.indexOf(connection), 1);
  await room.onClose(connection as never, 1000, "", true);
}

beforeEach(() => {
  persistedRow = null;
  upsertCalls = [];
});

describe("PartyServerV2 persistence soak", () => {
  test("bounds same-path set history and keeps a second client healthy", async () => {
    const baseline = createRoom();
    await startRoom(baseline.room);
    const baselineConnection = await connectRoom(
      baseline.room,
      baseline.connections,
      createConnection("baseline-connection"),
    );
    await baseline.room.onMessage(
      baselineConnection as never,
      JSON.stringify(rootSetMessage("writer", 1, { text: "seed" })),
    );
    await closeRoom(
      baseline.room,
      baseline.connections,
      baselineConnection,
    );
    const before = copyPersistedRow();
    const beforeBytes = documentBytes(before);

    const room = createRoom();
    await startRoom(room.room);
    const writer = await connectRoom(
      room.room,
      room.connections,
      createConnection("writer-connection"),
    );
    const peer = await connectRoom(
      room.room,
      room.connections,
      createConnection("peer-connection"),
    );
    writer.sent = [];
    peer.sent = [];

    const writeCount = 3000;
    for (let index = 0; index < writeCount; index += 1) {
      await room.room.onMessage(
        writer as never,
        JSON.stringify(
          nestedSetMessage(
            "writer",
            index + 2,
            `value-${String(index).padStart(4, "0")}`,
          ),
        ),
      );
    }

    expect(parsedMessages(writer)).toHaveLength(writeCount);
    expect(parsedMessages(peer)).toHaveLength(writeCount);
    await closeRoom(room.room, room.connections, writer);
    await closeRoom(room.room, room.connections, peer);

    const afterWrites = copyPersistedRow();
    const afterBytes = documentBytes(afterWrites);
    const beforeSequence = (before.document_json as { sequence: number })
      .sequence;
    const afterDocument = afterWrites.document_json as {
      sequence: number;
      snapshot: RoomSnapshot;
    };
    expect(afterDocument.sequence).toBeGreaterThan(beforeSequence);
    expect(Object.keys(afterDocument.snapshot.lastMutationIds)).toEqual([
      "writer",
    ]);
    expect(afterDocument.snapshot.lastMutationIds.writer).toBe(writeCount + 1);
    expect(afterBytes).toBeLessThan(beforeBytes + 256);

    const healthyRoom = createRoom();
    await startRoom(healthyRoom.room);
    const healthyWriter = await connectRoom(
      healthyRoom.room,
      healthyRoom.connections,
      createConnection("healthy-writer"),
    );
    const healthyPeer = await connectRoom(
      healthyRoom.room,
      healthyRoom.connections,
      createConnection("healthy-peer"),
    );
    healthyWriter.sent = [];
    healthyPeer.sent = [];

    const peerOperation = nestedSetMessage("peer", 1, "peer-value");
    await healthyRoom.room.onMessage(
      healthyPeer as never,
      JSON.stringify(peerOperation),
    );

    const peerBroadcast = {
      type: "operation",
      protocolVersion: 2,
      payload: {
        sequence: writeCount + 2,
        generation: 0,
        clientId: "peer",
        mutationId: 1,
        operation: peerOperation.operation,
      },
    };
    expect(parsedMessages(healthyWriter)).toEqual([peerBroadcast]);
    expect(parsedMessages(healthyPeer)).toEqual([peerBroadcast]);
    await closeRoom(
      healthyRoom.room,
      healthyRoom.connections,
      healthyWriter,
    );
    await closeRoom(healthyRoom.room, healthyRoom.connections, healthyPeer);
  });

  test("stores array append bursts linearly without operation history", async () => {
    const baseline = createRoom();
    await startRoom(baseline.room);
    const baselineConnection = await connectRoom(
      baseline.room,
      baseline.connections,
      createConnection("baseline-connection"),
    );
    await baseline.room.onMessage(
      baselineConnection as never,
      JSON.stringify(rootSetMessage("writer", 1, { items: [] })),
    );
    await closeRoom(
      baseline.room,
      baseline.connections,
      baselineConnection,
    );
    const baselineBytes = documentBytes();

    const firstRoom = createRoom();
    await startRoom(firstRoom.room);
    const firstConnection = await connectRoom(
      firstRoom.room,
      firstRoom.connections,
      createConnection("first-connection"),
    );
    const firstBurstCount = 1000;
    for (let index = 0; index < firstBurstCount; index += 1) {
      await firstRoom.room.onMessage(
        firstConnection as never,
        JSON.stringify(insertMessage("writer", index + 2, index)),
      );
    }
    await closeRoom(firstRoom.room, firstRoom.connections, firstConnection);
    const firstBytes = documentBytes();

    const secondRoom = createRoom();
    await startRoom(secondRoom.room);
    const secondConnection = await connectRoom(
      secondRoom.room,
      secondRoom.connections,
      createConnection("second-connection"),
    );
    const secondBurstCount = 2000;
    for (let index = firstBurstCount; index < firstBurstCount + secondBurstCount; index += 1) {
      await secondRoom.room.onMessage(
        secondConnection as never,
        JSON.stringify(insertMessage("writer", index + 2, index)),
      );
    }
    await closeRoom(
      secondRoom.room,
      secondRoom.connections,
      secondConnection,
    );
    const finalRow = copyPersistedRow();
    const finalBytes = documentBytes(finalRow);
    const firstDelta = firstBytes - baselineBytes;
    const secondDelta = finalBytes - firstBytes;
    const firstBytesPerItem = firstDelta / firstBurstCount;
    const secondBytesPerItem = secondDelta / secondBurstCount;
    const finalDocument = finalRow.document_json as {
      sequence: number;
      snapshot: RoomSnapshot;
    };

    expect(firstDelta).toBeGreaterThan(0);
    expect(secondDelta).toBeGreaterThan(0);
    expect(secondBytesPerItem).toBeGreaterThan(firstBytesPerItem * 0.8);
    expect(secondBytesPerItem).toBeLessThan(firstBytesPerItem * 1.2);
    expect(finalBytes - baselineBytes).toBeLessThan(firstDelta * 3.4);
    expect(finalDocument.sequence).toBe(3001);
    expect(finalDocument.snapshot.state["can-play"]?.counter).toEqual({
      items: Array.from({ length: 3000 }, (_, index) => ({
        id: `item-${index}`,
        text: "item",
      })),
    });
    expect(Object.keys(finalDocument.snapshot.lastMutationIds)).toEqual([
      "writer",
    ]);
    expect(finalDocument.snapshot.lastMutationIds.writer).toBe(3001);
  });
});
