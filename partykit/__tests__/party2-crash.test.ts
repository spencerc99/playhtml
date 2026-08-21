// ABOUTME: Exercises PartyServerV2 recovery when accepted operations have not persisted.
// ABOUTME: Verifies clean persisted prefixes and mutation-id deduplication after restart.

import fc from "fast-check";
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
      path: [],
      value: { text },
      arrays: [],
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

function parsedMessages(
  connection: FakeConnection,
): Array<Record<string, unknown>> {
  return connection.sent.map((message) => JSON.parse(message));
}

function copyPersistedRow(): PersistedRow {
  if (persistedRow === null) throw new Error("Expected a persisted room");
  return structuredClone(persistedRow);
}

function persistedSnapshot(): RoomSnapshot {
  return (copyPersistedRow().document_json as { snapshot: RoomSnapshot })
    .snapshot;
}

async function closeRoom(
  room: InstanceType<typeof PartyServerV2>,
  connections: FakeConnection[],
  connection: FakeConnection,
): Promise<void> {
  connections.splice(connections.indexOf(connection), 1);
  await room.onClose(connection as never, 1000, "", true);
}

function simulateCrash(
  room: InstanceType<typeof PartyServerV2>,
  connections: FakeConnection[],
): void {
  const internals = room as unknown as {
    autosaveTimer: ReturnType<typeof setTimeout> | null;
  };
  if (internals.autosaveTimer !== null) {
    clearTimeout(internals.autosaveTimer);
    internals.autosaveTimer = null;
  }
  connections.length = 0;
}

beforeEach(() => {
  persistedRow = null;
  upsertCalls = [];
});

describe("PartyServerV2 crash recovery", () => {
  test("recovers the last persisted prefix and deduplicates pending replay after a debounce crash", async () => {
    const seed = createRoom();
    await startRoom(seed.room);
    const seedConnection = await connectRoom(seed.room, seed.connections);
    await seed.room.onMessage(
      seedConnection as never,
      JSON.stringify(rootSetMessage("writer", 1, "persisted")),
    );
    await closeRoom(seed.room, seed.connections, seedConnection);
    const persistedPrefix = copyPersistedRow();

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          values: fc.array(fc.string({ maxLength: 32 }), {
            minLength: 1,
            maxLength: 16,
          }),
          crashAfter: fc.integer({ min: 1, max: 16 }),
        }),
        async ({ values, crashAfter }) => {
          const acceptedValues = values.slice(
            0,
            Math.min(values.length, crashAfter),
          );
          persistedRow = structuredClone(persistedPrefix);
          upsertCalls = [];

          const live = createRoom();
          await startRoom(live.room);
          const liveConnection = await connectRoom(
            live.room,
            live.connections,
            createConnection("writer-connection"),
          );
          liveConnection.sent = [];
          const pending = acceptedValues.map((value, index) =>
            nestedSetMessage("writer", index + 2, value),
          );

          for (const message of pending) {
            await live.room.onMessage(
              liveConnection as never,
              JSON.stringify(message),
            );
          }

          expect(parsedMessages(liveConnection)).toHaveLength(
            acceptedValues.length,
          );
          await new Promise((resolve) => setTimeout(resolve, 5));
          expect(upsertCalls).toEqual([]);
          simulateCrash(live.room, live.connections);

          const recovered = createRoom();
          await startRoom(recovered.room);
          const recoveredConnection = await connectRoom(
            recovered.room,
            recovered.connections,
            createConnection("recovered-connection"),
          );
          const recoveredSnapshot = parsedMessages(recoveredConnection).find(
            (message) => message.type === "snapshot",
          );
          expect(recoveredSnapshot).toEqual({
            type: "snapshot",
            protocolVersion: 2,
            sequence: 1,
            generation: 0,
            snapshot: persistedSnapshot(),
          });
          expect(recoveredSnapshot.sequence).toBe(
            (persistedPrefix.document_json as { sequence: number }).sequence,
          );

          recoveredConnection.sent = [];
          const replay = [
            rootSetMessage("writer", 1, "persisted"),
            ...pending,
          ];
          for (const message of replay) {
            await recovered.room.onMessage(
              recoveredConnection as never,
              JSON.stringify(message),
            );
          }

          const replayedOperations = parsedMessages(recoveredConnection);
          expect(replayedOperations).toHaveLength(acceptedValues.length);
          let previousSequence = 1;
          for (const message of replayedOperations) {
            expect(message.type).toBe("operation");
            const sequence = (message.payload as { sequence: number })
              .sequence;
            expect(sequence).toBeGreaterThan(previousSequence);
            previousSequence = sequence;
          }

          await recovered.room.onMessage(
            recoveredConnection as never,
            JSON.stringify({ type: "snapshot-request", protocolVersion: 2 }),
          );
          const finalSnapshot = parsedMessages(recoveredConnection).at(
            -1,
          ) as {
            snapshot: RoomSnapshot;
            sequence: number;
          };
          expect(finalSnapshot.snapshot).toEqual({
            state: {
              "can-play": {
                counter: { text: acceptedValues[acceptedValues.length - 1] },
              },
            },
            arrays: [],
            lastMutationIds: { writer: acceptedValues.length + 1 },
          });
          expect(finalSnapshot.sequence).toBe(acceptedValues.length + 1);
          await closeRoom(
            recovered.room,
            recovered.connections,
            recoveredConnection,
          );
          expect(persistedSnapshot()).toEqual(finalSnapshot.snapshot);
        },
      ),
      { numRuns: 32 },
    );
  });
});
