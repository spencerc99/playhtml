// ABOUTME: Drives PartyServer through the real platform entry points (alarm, fetch).
// ABOUTME: Catches guards that sit downstream of the hydration they are meant to prevent.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as Y from "yjs";
import { Buffer } from "node:buffer";

// The platform initializes a room before invoking any handler: alarm() and
// fetch() both call ensureInitialized() -> onStart() -> onLoad(), which
// hydrates. Tests that call onLoad()/onAlarm() directly therefore cannot see
// guards that are placed downstream of hydration. These tests go through the
// same entry points the runtime uses.

const kvStore = new Map<string, string>();

const quarantineKvStub = {
  async get(key: string) {
    return kvStore.get(key) ?? null;
  },
  async put(key: string, value: string) {
    kvStore.set(key, value);
  },
  async delete(key: string) {
    kvStore.delete(key);
  },
  async list({ prefix }: { prefix?: string }) {
    return {
      keys: Array.from(kvStore.keys())
        .filter((key) => !prefix || key.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true as const,
      cacheStatus: null,
    };
  },
};

mock.module("cloudflare:workers", () => ({
  env: { QUARANTINE_CONTROL: quarantineKvStub },
  DurableObject: class {
    constructor(
      public ctx: unknown,
      public env: unknown
    ) {}
  },
  WorkerEntrypoint: class {},
}));

const persistedRow: { document: string | null } = { document: null };
let documentReadCount = 0;
let upsertCalls: Array<{ name: string; document: string }> = [];

const supabaseStub = {
  from() {
    return {
      select() {
        return {
          eq() {
            return {
              abortSignal() {
                return {
                  maybeSingle: async () => {
                    documentReadCount += 1;
                    return {
                      data:
                        persistedRow.document === null
                          ? null
                          : { document: persistedRow.document },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
      async upsert(row: { name: string; document: string }) {
        upsertCalls.push(row);
        persistedRow.document = row.document;
        return { error: null };
      },
    };
  },
};

mock.module(`${import.meta.dir}/../db.ts`, () => ({ supabase: supabaseStub }));

const partyModule = await import(`${import.meta.dir}/../party.ts`);
const { PartyServer } = partyModule;
const worker = partyModule.default;

// Mirrors the Durable Object storage surface the server actually uses.
class FakeStorage {
  values = new Map<string, unknown>();
  alarm: number | null = null;

  async get(key: string) {
    return this.values.get(key);
  }
  async put(key: string, value: unknown) {
    this.values.set(key, value);
  }
  async delete(key: string) {
    this.values.delete(key);
  }
  async list() {
    return new Map();
  }
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(time: number) {
    this.alarm = time;
  }
  async deleteAlarm() {
    this.alarm = null;
  }
}

/**
 * Builds a server instance the way the platform does, then exposes the same
 * entry points the runtime calls. `blockConcurrencyWhile` and `id.name` are the
 * only pieces of DurableObjectState the initialization path touches.
 */
function createServer(
  name = "example-room",
  connections: Array<{
    readyState: number;
    send(message: unknown): void;
    close?(code: number, reason: string): void;
  }> = []
) {
  const storage = new FakeStorage();
  const ctx = {
    storage,
    id: { name },
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
    waitUntil: () => {},
    // The hibernating connection manager enumerates live sockets on start.
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    getTags: () => [],
  };

  const server = new PartyServer(ctx as never, {} as never);
  Object.defineProperty(server, "getConnections", {
    value: () => connections,
  });
  return { server, storage };
}

function encodeDoc(doc: Y.Doc): string {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

const SMALL_DOCUMENT = (() => {
  const doc = new Y.Doc();
  doc.getMap("play").set("greeting", "hello");
  return encodeDoc(doc);
})();

beforeEach(() => {
  persistedRow.document = SMALL_DOCUMENT;
  documentReadCount = 0;
  upsertCalls = [];
  kvStore.clear();
});

describe("alarm entry point", () => {
  // The platform initializes (and hydrates) before onAlarm runs, so a guard that
  // lives only in onAlarm never executes for a room that dies during hydration.
  test("a deferred room does not read the document when its alarm fires", async () => {
    const { server, storage } = createServer();
    storage.values.set("quarantineLoadAttempts", 2);
    const retryAfter = Date.now() + 10 * 60_000;
    storage.values.set("loadRetryAfter", retryAfter);

    await server.alarm();

    expect(documentReadCount).toBe(0);
    expect(server.circuitBreaker.isLoadDeferred()).toBe(true);
    expect(storage.alarm).toBe(retryAfter);
  });

  test("a KV-quarantined room does not hydrate when its alarm fires", async () => {
    const { server } = createServer();
    kvStore.set("quarantine:example-room", "operator stop");

    await server.alarm();

    expect(documentReadCount).toBe(0);
    expect(server.circuitBreaker.isQuarantined()).toBe(true);
    // Nothing may be written back over the untouched document.
    expect(upsertCalls).toEqual([]);
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  test("a healthy room still hydrates and runs its alarm work", async () => {
    const { server } = createServer();

    await server.alarm();

    expect(documentReadCount).toBe(1);
    expect(server.circuitBreaker.isQuarantined()).toBe(false);
    expect(server.circuitBreaker.isLoadDeferred()).toBe(false);
  });

  test("an alarm on a room past its deferral deadline retries exactly once", async () => {
    const { server, storage } = createServer();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() - 1000);

    await server.alarm();

    expect(documentReadCount).toBe(1);
    expect(server.circuitBreaker.isLoadDeferred()).toBe(false);
  });

  test("a recovery alarm hydrates a warm transient room without new traffic", async () => {
    const closeCalls: Array<{ code: number; reason: string }> = [];
    const { server, storage } = createServer("example-room", [
      {
        readyState: 1,
        send() {},
        close(code: number, reason: string) {
          closeCalls.push({ code, reason });
        },
      },
    ]);

    await server.fetch(
      new Request(
        "https://example.com/parties/main/example-room/admin/quarantine-status",
        { method: "GET" }
      )
    );
    documentReadCount = 0;
    (server as any).persistenceMode = {
      kind: "transient",
      reason: "database outage",
      failedAt: Date.now() - 60_000,
    };
    (server as any).documentLoadCompleted = false;
    storage.values.set("persistenceRecoveryPending", true);
    storage.values.set("quarantineLoadAttempts", 1);
    storage.values.set("loadRetryAfter", Date.now() - 1);
    server.circuitBreaker.setLoadDeferredUntil(Date.now() - 1);

    await server.alarm();

    expect(documentReadCount).toBe(1);
    expect(server.isPersistenceAvailable()).toBe(true);
    expect(storage.values.has("persistenceRecoveryPending")).toBe(false);
    expect(closeCalls).toEqual([
      { code: 4000, reason: "Room Persistence Restored" },
    ]);
  });

  test("clearing quarantine re-arms recovery without new traffic", async () => {
    const { server, storage } = createServer();
    kvStore.set("quarantine:example-room", "operator stop");

    await server.alarm();
    expect(server.circuitBreaker.isQuarantined()).toBe(true);
    expect(storage.alarm).toBeNull();

    await server.circuitBreaker.clearQuarantine();

    expect(storage.alarm).toBeNumber();
    expect(storage.alarm!).toBeLessThanOrEqual(Date.now());
    expect(server.isPersistenceAvailable()).toBe(false);
    expect(server.circuitBreaker.isQuarantined()).toBe(false);
    expect(storage.values.get("loadRetryAfter")).toBeLessThanOrEqual(
      Date.now()
    );

    documentReadCount = 0;
    await server.onAlarm();

    expect(documentReadCount).toBe(1);
    expect(server.isPersistenceAvailable()).toBe(true);
    expect(storage.values.has("persistenceRecoveryPending")).toBe(false);
  });
});

describe("persistence recovery admission", () => {
  test("a restarted isolate runs due persistence recovery through load backoff", async () => {
    const { server, storage } = createServer();
    storage.values.set("persistenceRecoveryPending", true);
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() - 1);

    await server.alarm();

    expect(documentReadCount).toBe(1);
    expect(server.isPersistenceAvailable()).toBe(true);
    expect(storage.values.has("persistenceRecoveryPending")).toBe(false);
  });

  test("a restarted isolate honors the durable recovery deadline", async () => {
    const { server, storage } = createServer();
    const retryAfter = Date.now() + 10 * 60_000;
    storage.values.set("persistenceRecoveryPending", true);
    storage.values.set("quarantineLoadAttempts", 1);
    storage.values.set("loadRetryAfter", retryAfter);
    storage.alarm = retryAfter;

    await server.fetch(
      new Request(
        "https://example.com/parties/main/example-room/admin/quarantine-status",
        { method: "GET" }
      )
    );

    expect(documentReadCount).toBe(0);
    expect((server as any).documentLoadCompleted).toBe(false);
    expect(storage.alarm).toBe(retryAfter);
  });
});

describe("fetch entry point", () => {
  test("a cold quarantined room completes Yjs startup without hydrating", async () => {
    const sentMessages: unknown[] = [];
    const connection = {
      readyState: 1,
      send: (message: unknown) => sentMessages.push(message),
    };
    const { server } = createServer("example-room", [connection]);
    kvStore.set("quarantine:example-room", "operator stop");

    await server.__unsafe_ensureInitialized?.();

    expect(documentReadCount).toBe(0);
    expect(server.circuitBreaker.isQuarantined()).toBe(true);
    expect(sentMessages.length).toBeGreaterThan(0);

    sentMessages.length = 0;
    server.document.getMap("play").set("transient", "shared");
    expect(sentMessages.length).toBeGreaterThan(0);
  });

  test("automatic quarantine completes Yjs startup without hydrating", async () => {
    const sentMessages: unknown[] = [];
    const connection = {
      readyState: 1,
      send: (message: unknown) => sentMessages.push(message),
    };
    const { server, storage } = createServer("example-room", [connection]);
    storage.values.set("quarantineLoadAttempts", 8);

    await server.__unsafe_ensureInitialized?.();

    expect(documentReadCount).toBe(0);
    expect(server.circuitBreaker.isQuarantined()).toBe(true);
    expect(sentMessages.length).toBeGreaterThan(0);
  });

  test("a deferred room answers 503 without reading the document", async () => {
    const { server, storage } = createServer();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 10 * 60_000);

    const response = await server.fetch(
      new Request("https://example.com/parties/main/example-room", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.status).toBe(503);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(documentReadCount).toBe(0);
  });

  test("a KV-quarantined room never hydrates through fetch", async () => {
    const { server } = createServer();
    kvStore.set("quarantine:example-room", "operator stop");

    await server.fetch(
      new Request("https://example.com/parties/main/example-room", {
        method: "POST",
        body: "{}",
      })
    );

    expect(documentReadCount).toBe(0);
    expect(server.circuitBreaker.isQuarantined()).toBe(true);
  });

  // Without in-place recovery a live isolate would 503 forever, since onStart
  // runs once and client retries keep the isolate alive.
  test("a request past the deadline recovers the room in place", async () => {
    const { server, storage } = createServer();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 200);

    const deferred = await server.fetch(
      new Request("https://example.com/parties/main/example-room", {
        method: "POST",
        body: "{}",
      })
    );
    expect(deferred.status).toBe(503);
    expect(documentReadCount).toBe(0);

    // The deadline passes while this isolate stays alive.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const recovered = await server.fetch(
      new Request("https://example.com/parties/main/example-room", {
        method: "POST",
        body: JSON.stringify({ nonsense: true }),
      })
    );

    // Exactly one hydration attempt, and the room is serving again.
    expect(documentReadCount).toBe(1);
    expect(recovered.status).not.toBe(503);
    expect(server.circuitBreaker.isLoadDeferred()).toBe(false);
  });

  test("a recovered room completes Yjs and bridge startup", async () => {
    const sentMessages: unknown[] = [];
    const connection = {
      readyState: 1,
      send: (message: unknown) => sentMessages.push(message),
    };
    const { server, storage } = createServer("example-room", [connection]);
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 10 * 60_000);

    const deferred = await server.fetch(
      new Request("https://example.com/parties/main/example-room", {
        method: "POST",
        body: "{}",
      })
    );
    expect(deferred.status).toBe(503);
    expect(sentMessages).toEqual([]);

    (server as any).circuitBreaker.setLoadDeferredUntil(Date.now() - 1);
    const recovered = await server.fetch(
      new Request("https://example.com/parties/main/example-room", {
        method: "POST",
        body: JSON.stringify({ nonsense: true }),
      })
    );

    expect(recovered.status).not.toBe(503);
    expect(documentReadCount).toBe(1);
    expect(sentMessages.length).toBeGreaterThan(0);
    expect((server as any).observersAttached).toBe(true);

    sentMessages.length = 0;
    server.document.getMap("play").set("afterRecovery", "shared");
    expect(sentMessages.length).toBeGreaterThan(0);
  });

  test("concurrent requests at the deadline share a single hydration", async () => {
    const { server, storage } = createServer();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() - 1000);

    // Force the deferral without hydrating, as a fresh isolate would see it.
    await server.__unsafe_ensureInitialized?.();

    const requests = Array.from({ length: 5 }, () =>
      server.fetch(
        new Request("https://example.com/parties/main/example-room", {
          method: "POST",
          body: "{}",
        })
      )
    );
    await Promise.all(requests);

    expect(documentReadCount).toBe(1);
  });

  test("admin status stays reachable on a deferred room", async () => {
    const { server, storage } = createServer();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 10 * 60_000);

    const response = await server.fetch(
      new Request(
        "https://example.com/parties/main/example-room/admin/quarantine-status",
        { method: "GET" }
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.loadDeferred.active).toBe(true);
    expect(documentReadCount).toBe(0);
  });

  test("admin control routes do not retry hydration after the deadline", async () => {
    const { server, storage } = createServer();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 10 * 60_000);

    await server.fetch(
      new Request(
        "https://example.com/parties/main/example-room/admin/quarantine-status",
        { method: "GET" }
      )
    );
    (server as any).circuitBreaker.setLoadDeferredUntil(Date.now() - 1);

    const response = await server.fetch(
      new Request(
        "https://example.com/parties/main/example-room/admin/quarantine-status",
        { method: "GET" }
      )
    );

    expect(response.status).toBe(200);
    expect(documentReadCount).toBe(0);
    expect(server.circuitBreaker.isLoadDeferred()).toBe(true);
  });

  test("manual quarantine turns a deferred room into transient realtime service", async () => {
    const sentMessages: unknown[] = [];
    const connection = {
      readyState: 1,
      send: (message: unknown) => sentMessages.push(message),
    };
    const { server, storage } = createServer("example-room", [connection]);
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 10 * 60_000);

    await server.fetch(
      new Request(
        "https://example.com/parties/main/example-room/admin/quarantine-status",
        { method: "GET" }
      )
    );
    expect(server.circuitBreaker.isLoadDeferred()).toBe(true);

    const response = await server.fetch(
      new Request(
        "https://example.com/parties/main/example-room/admin/quarantine-set",
        {
          method: "POST",
          body: JSON.stringify({ reason: "operator stop" }),
        }
      )
    );

    expect(response.status).toBe(200);
    expect(documentReadCount).toBe(0);
    expect(server.circuitBreaker.isQuarantined()).toBe(true);
    expect(server.circuitBreaker.isLoadDeferred()).toBe(false);
    expect(sentMessages.length).toBeGreaterThan(0);
  });

  test("clearing a cold quarantine keeps traffic gated until hydration succeeds", async () => {
    const { server } = createServer();
    kvStore.set("quarantine:example-room", "operator stop");

    await server.fetch(
      new Request(
        "https://example.com/parties/main/example-room/admin/quarantine-status",
        { method: "GET" }
      )
    );
    expect(documentReadCount).toBe(0);
    expect(server.document.getMap("play").get("greeting")).toBeUndefined();

    const cleared = await server.fetch(
      new Request(
        "https://example.com/parties/main/example-room/admin/quarantine-clear",
        { method: "POST" }
      )
    );

    expect(cleared.status).toBe(200);
    expect(server.circuitBreaker.isQuarantined()).toBe(false);
    expect(server.circuitBreaker.isLoadDeferred()).toBe(true);
    expect(documentReadCount).toBe(0);

    const status = await server.fetch(
      new Request(
        "https://example.com/parties/main/example-room/admin/quarantine-status",
        { method: "GET" }
      )
    );
    expect(status.status).toBe(200);
    expect(documentReadCount).toBe(0);

    const recovered = await server.fetch(
      new Request("https://example.com/parties/main/example-room", {
        method: "POST",
        body: JSON.stringify({ nonsense: true }),
      })
    );

    expect(recovered.status).not.toBe(503);
    expect(documentReadCount).toBe(1);
    expect(server.circuitBreaker.isLoadDeferred()).toBe(false);
    expect(server.document.getMap("play").get("greeting")).toBe("hello");
  });
});

describe("global quarantine admin endpoint", () => {
  const workerEnv = {
    ADMIN_TOKEN: "secret",
    QUARANTINE_CONTROL: quarantineKvStub,
  } as never;

  test("lists every current quarantine without initializing a room", async () => {
    kvStore.set("quarantine:z-room", "automatic load failures");
    kvStore.set("unrelated:key", "ignore me");
    kvStore.set("quarantine:a-room", "operator stop");

    const response = await worker.fetch(
      new Request("https://api.playhtml.fun/admin/quarantines?token=secret"),
      workerEnv
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: true,
      count: 2,
      rooms: [
        { roomId: "a-room", detail: "operator stop" },
        { roomId: "z-room", detail: "automatic load failures" },
      ],
    });
    expect(documentReadCount).toBe(0);
  });

  test("requires the admin token", async () => {
    kvStore.set("quarantine:private-room", "operator stop");

    const response = await worker.fetch(
      new Request("https://api.playhtml.fun/admin/quarantines"),
      workerEnv
    );

    expect(response.status).toBe(401);
  });
});
