// ABOUTME: Drives a real PartyServer through connect, message, close, and alarm.
// ABOUTME: Checks the per-message and per-connect paths skip storage and attachment work.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import { Buffer } from "node:buffer";

const kvStore = new Map<string, string>();

mock.module("cloudflare:workers", () => ({
  env: {
    QUARANTINE_CONTROL: {
      async get(key: string) {
        return kvStore.get(key) ?? null;
      },
      async put(key: string, value: string) {
        kvStore.set(key, value);
      },
      async delete(key: string) {
        kvStore.delete(key);
      },
    },
    ADMIN_TOKEN: "test-admin-token",
  },
  DurableObject: class {
    constructor(
      public ctx: unknown,
      public env: unknown
    ) {}
  },
  WorkerEntrypoint: class {},
}));

const persistedRow: { document: string | null } = { document: null };

const supabaseStub = {
  from() {
    return {
      select() {
        return {
          eq() {
            const maybeSingle = async () => ({
              data:
                persistedRow.document === null
                  ? null
                  : { document: persistedRow.document },
              error: null,
            });
            return {
              maybeSingle,
              abortSignal() {
                return { maybeSingle };
              },
            };
          },
        };
      },
      async upsert(row: { name: string; document: string }) {
        persistedRow.document = row.document;
        return { error: null };
      },
    };
  },
};

mock.module(`${import.meta.dir}/../db.ts`, () => ({ supabase: supabaseStub }));

const { PartyServer } = await import(`${import.meta.dir}/../party.ts`);

// Durable Object storage stand-in that logs every operation, so tests can
// assert which reads and writes a code path performs.
class RecordingStorage {
  values = new Map<string, unknown>();
  alarm: number | null = null;
  log: string[] = [];

  async get(key: string) {
    this.log.push(`get:${key}`);
    return this.values.get(key);
  }
  async put(key: string, value: unknown) {
    this.log.push(`put:${key}`);
    this.values.set(key, value);
  }
  async delete(key: string) {
    this.log.push(`delete:${key}`);
    return this.values.delete(key);
  }
  async list() {
    return new Map();
  }
  async getAlarm() {
    this.log.push("getAlarm");
    return this.alarm;
  }
  async setAlarm(time: number) {
    this.log.push("setAlarm");
    this.alarm = time;
  }
  async deleteAlarm() {
    this.log.push("deleteAlarm");
    this.alarm = null;
  }
}

type FakeConnection = {
  id: string;
  readyState: number;
  state: Record<string, unknown> | null;
  setStateCalls: number;
  closes: Array<{ code: number; reason: string }>;
  send(message: unknown): void;
  close(code: number, reason: string): void;
  setState(next: unknown): unknown;
};

function createConnection(id: string): FakeConnection {
  return {
    id,
    readyState: 1,
    state: null,
    setStateCalls: 0,
    closes: [],
    send() {},
    close(code: number, reason: string) {
      this.closes.push({ code, reason });
    },
    // Mirrors partyserver's hibernating connection: every call serializes the
    // attachment, so the count is the number of attachment writes.
    setState(next: unknown) {
      this.setStateCalls += 1;
      this.state = (
        typeof next === "function" ? next(this.state) : next
      ) as Record<string, unknown> | null;
      return this.state;
    },
  };
}

/**
 * Builds a server the way the platform does and runs its real initialization
 * (onStart -> onLoad -> startup alarm scheduling) over the given storage.
 */
async function startServer(
  storage: RecordingStorage,
  name = "example-room"
): Promise<{ server: any; open: FakeConnection[] }> {
  const ctx = {
    storage,
    id: { name },
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
    waitUntil: () => {},
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    getTags: () => [],
  };
  const server = new PartyServer(ctx as never, {} as never) as any;
  const open: FakeConnection[] = [];
  Object.defineProperty(server, "getConnections", { value: () => open });
  await server.__unsafe_ensureInitialized();
  return { server, open };
}

async function connect(
  server: any,
  open: FakeConnection[],
  id: string,
  query = ""
): Promise<FakeConnection> {
  const connection = createConnection(id);
  await server.onConnect(connection, {
    request: new Request(
      `https://example.com/parties/main/example-room?_pk=${id}${query}`
    ),
  });
  open.push(connection);
  return connection;
}

async function disconnect(
  server: any,
  open: FakeConnection[],
  connection: FakeConnection
): Promise<void> {
  open.splice(open.indexOf(connection), 1);
  await server.onClose(connection, 1000, "", true);
}

function awarenessMessage(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarUint8Array(encoder, new Uint8Array([0]));
  return encoding.toUint8Array(encoder);
}

function sharedReferencesQuery(elementId: string): string {
  return `&sharedReferences=${encodeURIComponent(
    JSON.stringify([{ domain: "source.example", path: "/", elementId }])
  )}`;
}

const SMALL_DOCUMENT = (() => {
  const doc = new Y.Doc();
  doc.getMap("play").set("greeting", "hello");
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
})();

const realDateNow = Date.now;
let now = 1_800_000_000_000;

beforeEach(() => {
  persistedRow.document = SMALL_DOCUMENT;
  kvStore.clear();
  now = 1_800_000_000_000;
  Date.now = () => now;
});

afterEach(() => {
  Date.now = realDateNow;
});

describe("message rate limiting", () => {
  test("messages do not write the connection attachment and the limit still trips", async () => {
    const storage = new RecordingStorage();
    const { server, open } = await startServer(storage);
    const connection = await connect(server, open, "chatty");
    const attachmentWritesAfterConnect = connection.setStateCalls;
    const { maxMessagesPerWindow } = server.getServerLimits();

    for (let index = 0; index < maxMessagesPerWindow; index += 1) {
      await server.onMessage(connection, awarenessMessage());
    }

    expect(connection.setStateCalls).toBe(attachmentWritesAfterConnect);
    expect(connection.closes).toEqual([]);

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (message: string) => warnings.push(message);
    try {
      await server.onMessage(connection, awarenessMessage());
    } finally {
      console.warn = originalWarn;
    }

    expect(connection.closes).toEqual([
      { code: 1008, reason: "Message Rate Limit Exceeded" },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("message-rate");
    expect(connection.setStateCalls).toBe(attachmentWritesAfterConnect);
  });

  test("a new window starts after the window elapses", async () => {
    const storage = new RecordingStorage();
    const { server, open } = await startServer(storage);
    const connection = await connect(server, open, "steady");
    const { maxMessagesPerWindow, messageRateWindowMs } =
      server.getServerLimits();

    for (let index = 0; index < maxMessagesPerWindow; index += 1) {
      await server.onMessage(connection, awarenessMessage());
    }
    now += messageRateWindowMs;
    for (let index = 0; index < maxMessagesPerWindow; index += 1) {
      await server.onMessage(connection, awarenessMessage());
    }

    expect(connection.closes).toEqual([]);
  });

  test("each connection has its own window", async () => {
    const storage = new RecordingStorage();
    const { server, open } = await startServer(storage);
    const first = await connect(server, open, "first");
    const second = await connect(server, open, "second");
    const { maxMessagesPerWindow } = server.getServerLimits();

    for (let index = 0; index < maxMessagesPerWindow; index += 1) {
      await server.onMessage(first, awarenessMessage());
      await server.onMessage(second, awarenessMessage());
    }

    expect(first.closes).toEqual([]);
    expect(second.closes).toEqual([]);
  });
});
