// ABOUTME: Drives a real PartyServer through connect, message, close, and alarm.
// ABOUTME: Checks the per-message and per-connect paths skip storage and attachment work.
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
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

let now = 0;

// Freezes the clock (Date.now and new Date()) so alarm times are exact.
function setNow(time: number): void {
  now = time;
  setSystemTime(new Date(time));
}

beforeEach(() => {
  persistedRow.document = SMALL_DOCUMENT;
  kvStore.clear();
  setNow(1_800_000_000_000);
});

afterEach(() => {
  setSystemTime();
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
    setNow(now + messageRateWindowMs);
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

// Storage keys scheduleNextAlarm reads to decide the next alarm.
const ALARM_INPUT_READS = [
  "get:subscribers",
  "get:sharedReferences",
  "get:emptyRoomCompactAfter",
  "get:documentSaveRetry",
  "get:loadRetryAfter",
  "getAlarm",
];

function storageSnapshot(storage: RecordingStorage) {
  return {
    alarm: storage.alarm,
    values: Object.fromEntries(
      Array.from(storage.values.entries()).sort(([a], [b]) =>
        a.localeCompare(b)
      )
    ),
  };
}

function logSince(storage: RecordingStorage, mark: number): string[] {
  return storage.log.slice(mark);
}

/**
 * Runs the same script against two rooms. The "forced" room has its alarm
 * inputs marked changed before every connect, so each connect runs the full
 * scheduleNextAlarm exactly as it did before the connect-path skip existed.
 * After every step both rooms must hold the same alarm and the same keys.
 */
async function createTwins() {
  const optimized = { storage: new RecordingStorage() } as {
    storage: RecordingStorage;
    server: any;
    open: FakeConnection[];
  };
  const forced = { storage: new RecordingStorage() } as typeof optimized;
  Object.assign(optimized, await startServer(optimized.storage));
  Object.assign(forced, await startServer(forced.storage));
  const rooms = [optimized, forced];

  let connectionCount = 0;
  const twins = {
    optimized,
    forced,
    async connect(query = "") {
      connectionCount += 1;
      const id = `client-${connectionCount}`;
      forced.server.markAlarmInputsChanged();
      const mark = optimized.storage.log.length;
      const forcedMark = forced.storage.log.length;
      await connect(optimized.server, optimized.open, id, query);
      await connect(forced.server, forced.open, id, query);
      twins.expectSame();
      return {
        optimizedLog: logSince(optimized.storage, mark),
        forcedLog: logSince(forced.storage, forcedMark),
      };
    },
    async closeAll() {
      for (const room of rooms) {
        for (const connection of [...room.open]) {
          await disconnect(room.server, room.open, connection);
        }
      }
      twins.expectSame();
    },
    async both(step: (server: any, storage: RecordingStorage) => unknown) {
      for (const room of rooms) await step(room.server, room.storage);
      twins.expectSame();
    },
    expectSame() {
      expect(storageSnapshot(optimized.storage)).toEqual(
        storageSnapshot(forced.storage)
      );
    },
  };
  return twins;
}

function subscriber() {
  return {
    consumerRoomId: "consumer",
    elementIds: ["shared-a"],
    consumerResetEpoch: null,
    createdAt: new Date(now).toISOString(),
    lastSeen: new Date(now).toISOString(),
    leaseMs: 12 * 60 * 60 * 1000,
  };
}

describe("alarm scheduling on connect", () => {
  test("a connect with no state changes does no storage deletes or alarm reads", async () => {
    const twins = await createTwins();
    await twins.connect();

    const { optimizedLog, forcedLog } = await twins.connect();

    expect(optimizedLog.filter((entry) => entry.startsWith("delete:"))).toEqual(
      []
    );
    expect(
      optimizedLog.filter((entry) => ALARM_INPUT_READS.includes(entry))
    ).toEqual([]);
    expect(optimizedLog.filter((entry) => entry.includes("Alarm"))).toEqual([]);
    // The forced twin still does the full run, so the comparison is meaningful.
    expect(forcedLog).toContain("get:documentSaveRetry");
    expect(forcedLog).toContain("deleteAlarm");
  });

  test("every change that affects the alarm leaves the same alarm as the full run", async () => {
    const twins = await createTwins();
    const errors: unknown[][] = [];
    const logs: unknown[][] = [];
    const originalError = console.error;
    const originalLog = console.log;
    console.error = (...args: unknown[]) => errors.push(args);
    console.log = (...args: unknown[]) => logs.push(args);

    try {
      await twins.connect();
      expect(twins.optimized.storage.alarm).toBeNull();

      // Shared reference leases need a prune alarm.
      await twins.connect(sharedReferencesQuery("shared-a"));
      expect(twins.optimized.storage.alarm).toBe(now + 4 * 60 * 60 * 1000);
      setNow(now + 60_000);
      await twins.connect();

      // A subscriber written through the admin path.
      await twins.both((server) => server.setSubscribers([subscriber()]));
      await twins.connect();

      // The last close sets the empty-room compaction deadline; the next
      // connect clears it.
      await twins.closeAll();
      expect(twins.optimized.storage.values.has("emptyRoomCompactAfter")).toBe(
        true
      );
      const compactAlarm = twins.optimized.storage.alarm;
      expect(compactAlarm).toBe(now + 5 * 60 * 1000);
      await twins.connect();
      expect(twins.optimized.storage.values.has("emptyRoomCompactAfter")).toBe(
        false
      );
      await twins.connect();

      // A save retry is set and later cleared.
      await twins.both((server) => server.scheduleDocumentSaveRetry());
      await twins.connect();
      await twins.both((server) => server.clearDocumentSaveRetry());
      await twins.connect();

      // A load retry written by the circuit breaker.
      await twins.both((server) =>
        server.circuitBreaker.storage.put("loadRetryAfter", now + 30_000)
      );
      await twins.connect();
      expect(twins.optimized.storage.alarm).toBe(now + 30_000);
      await twins.both((server) =>
        server.circuitBreaker.storage.delete("loadRetryAfter")
      );
      await twins.connect();

      // The stored alarm comes due before it fires: the next connect re-arms.
      setNow((twins.optimized.storage.alarm as number) + 1);
      await twins.connect();
      expect(twins.optimized.storage.alarm).toBeGreaterThan(now);

      // The alarm fires: the platform consumes it, then onAlarm runs.
      setNow((twins.optimized.storage.alarm as number) + 1);
      await twins.both(async (server, storage) => {
        storage.alarm = null;
        await server.onAlarm();
      });
      await twins.connect();

      // The alarm fires but the handler bails out early before rescheduling.
      setNow(now + 60_000);
      await twins.both((server, storage) => {
        storage.alarm = null;
        server.circuitBreaker.storage.put("alarmRetryAfter", now + 60_000);
      });
      await twins.both((server) => server.onAlarm());
      await twins.connect();
      await twins.both((server) =>
        server.circuitBreaker.storage.delete("alarmRetryAfter")
      );
      await twins.connect();

      // Quarantine cancels the alarm; clearing it reschedules.
      await twins.both((server) =>
        server.circuitBreaker.enterQuarantine({
          reason: "manual",
          detail: "test",
          failureKind: null,
          failureCount: 0,
          skipExternalWrite: true,
        })
      );
      expect(twins.optimized.storage.alarm).toBeNull();
      await twins.connect();
      expect(twins.optimized.storage.alarm).toBeNull();
      await twins.both((server) =>
        server.circuitBreaker.clearQuarantine({ recoveryCompleted: true })
      );
      await twins.connect();

      // Pruning every lease removes the prune alarm, whichever lease goes last.
      await twins.both((server) => server.setSubscribers([subscriber()]));
      await twins.connect(sharedReferencesQuery("shared-a"));
      await twins.both((server) => server.setSharedReferences([]));
      await twins.connect();
      expect(twins.optimized.storage.alarm).not.toBeNull();
      await twins.both((server) => server.setSubscribers([]));
      await twins.connect();
      expect(twins.optimized.storage.alarm).toBeNull();
      await twins.both((server) =>
        server.mergeAndStoreSharedRefs([
          { sourceRoomId: "source.example-%2F", elementIds: ["shared-b"] },
        ])
      );
      await twins.connect();
      expect(twins.optimized.storage.alarm).not.toBeNull();
      await twins.both((server) => server.setSharedReferences([]));
      await twins.connect();
      expect(twins.optimized.storage.alarm).toBeNull();
      await twins.connect();
      expect(twins.optimized.storage.alarm).toBeNull();
    } finally {
      console.error = originalError;
      console.log = originalLog;
    }

    expect(errors.some((args) => String(args[0]).includes("QUARANTINE"))).toBe(
      true
    );
  });

  test("a room without leases drops the alarm once its only input clears", async () => {
    const twins = await createTwins();
    const logs: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    try {
      await twins.connect();
      await twins.closeAll();
      expect(twins.optimized.storage.alarm).toBe(now + 5 * 60 * 1000);

      await twins.connect();
      expect(twins.optimized.storage.values.has("emptyRoomCompactAfter")).toBe(
        false
      );
      expect(twins.optimized.storage.alarm).toBeNull();

      await twins.both((server) => server.scheduleDocumentSaveRetry());
      expect(twins.optimized.storage.alarm).toBe(now + 60_000);
      await twins.both((server) => server.clearDocumentSaveRetry());
      await twins.connect();
      expect(twins.optimized.storage.alarm).toBeNull();
    } finally {
      console.log = originalLog;
    }
    expect(
      logs.some((args) => String(args[0]).includes("Empty-room compaction"))
    ).toBe(true);
  });

  test("the first connect after an instance restart matches the full run", async () => {
    const original = { storage: new RecordingStorage() };
    const twin = { storage: new RecordingStorage() };
    const logs: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    try {
      for (const room of [original, twin]) {
        const { server, open } = await startServer(room.storage);
        const connection = await connect(
          server,
          open,
          "before-restart",
          sharedReferencesQuery("shared-a")
        );
        await disconnect(server, open, connection);
      }
    } finally {
      console.log = originalLog;
    }
    expect(original.storage.values.has("emptyRoomCompactAfter")).toBe(true);
    expect(original.storage.values.has("sharedReferences")).toBe(true);
    const compactAfter = original.storage.values.get("emptyRoomCompactAfter");
    // The alarm is lost, so only the restarted room can recreate it.
    original.storage.alarm = null;
    twin.storage.alarm = null;
    setNow(now + 60_000);

    const restarted = await startServer(original.storage);
    const restartedTwin = await startServer(twin.storage);
    restartedTwin.server.markAlarmInputsChanged();
    await connect(restarted.server, restarted.open, "after-restart");
    await connect(restartedTwin.server, restartedTwin.open, "after-restart");

    expect(storageSnapshot(original.storage)).toEqual(
      storageSnapshot(twin.storage)
    );
    expect(original.storage.values.has("emptyRoomCompactAfter")).toBe(false);
    // Startup re-armed the alarm for the compaction deadline. Clearing the
    // deadline on connect leaves that earlier alarm in place, as it always has.
    expect(original.storage.alarm).toBe(compactAfter as number);
  });
});
