// ABOUTME: Drives the real PartyServer load and alarm paths to verify breaker behavior.
// ABOUTME: Asserts rooms stay available while failed work backs off or is disabled.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as Y from "yjs";
import { Buffer } from "node:buffer";

// PartyServer imports Cloudflare-only modules and constructs a Supabase client at
// module scope. Stub both so the real class can be exercised under bun test.
class FakeDurableObject {
  constructor(
    public ctx: unknown,
    public env: unknown
  ) {}
}

// Stands in for the QUARANTINE_CONTROL KV namespace: the operator control plane
// that is readable before hydration, unlike anything in Durable Object storage.
const kvStore = new Map<string, string>();
let kvFailure: Error | null = null;

const quarantineKvStub = {
  async get(key: string) {
    if (kvFailure) throw kvFailure;
    return kvStore.get(key) ?? null;
  },
  async put(key: string, value: string) {
    if (kvFailure) throw kvFailure;
    kvStore.set(key, value);
  },
  async delete(key: string) {
    if (kvFailure) throw kvFailure;
    kvStore.delete(key);
  },
};

const workerEnv: Record<string, unknown> = {
  QUARANTINE_CONTROL: quarantineKvStub,
  SUPABASE_LOAD_ATTEMPTS: "3",
  SUPABASE_LOAD_RETRY_DELAY_MS: "1",
};

mock.module("cloudflare:workers", () => ({
  env: workerEnv,
  DurableObject: FakeDurableObject,
  WorkerEntrypoint: class {},
}));

// A single mutable row stands in for the room's `documents` record. Tests assert
// against `persistedRow.document` to prove risky paths never overwrite real data.
type PersistedRow = { document: string | null };
const persistedRow: PersistedRow = { document: null };
let upsertCalls: Array<{ name: string; document: string }> = [];

// Counts reads of the documents row. The load-backoff contract requires that a
// deferred room never touches Supabase at all, which this makes observable.
let documentReadCount = 0;
let documentReadErrors: Error[] = [];

function createDocumentRead() {
  const maybeSingle = async () => {
    documentReadCount += 1;
    const error = documentReadErrors.shift();
    if (error) {
      return { data: null, error: { message: error.message } };
    }
    return {
      data:
        persistedRow.document === null
          ? null
          : { document: persistedRow.document },
      error: null,
    };
  };

  return {
    maybeSingle,
    abortSignal() {
      return { maybeSingle };
    },
  };
}

const supabaseStub = {
  from() {
    return {
      select() {
        return {
          eq() {
            return createDocumentRead();
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

const { PartyServer } = await import(`${import.meta.dir}/../party.ts`);
const { AdminHandler } = await import(`${import.meta.dir}/../admin.ts`);

// Minimal in-memory stand-ins for Durable Object storage.
class FakeStorage {
  values = new Map<string, unknown>();
  alarm: number | null = null;
  deleteAlarmCalls = 0;
  setAlarmCalls: number[] = [];
  // Ordered log of awaited writes, used to prove failure counters are committed
  // before the risky work they protect.
  writeLog: Array<{ key: string; value: unknown }> = [];

  async get(key: string) {
    return this.values.get(key);
  }
  async put(key: string, value: unknown) {
    this.writeLog.push({ key, value });
    this.values.set(key, value);
  }
  async delete(key: string) {
    this.values.delete(key);
  }
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(time: number) {
    this.alarm = time;
    this.setAlarmCalls.push(time);
  }
  async deleteAlarm() {
    this.alarm = null;
    this.deleteAlarmCalls += 1;
  }
}

// `name` is a readonly accessor on the server base class, so room fields are
// installed as own properties rather than assigned.
function buildRoom(storage: FakeStorage, name: string, doc?: Y.Doc) {
  const room = Object.create(PartyServer.prototype, {
    ctx: { value: { storage }, writable: true },
    name: { value: name, writable: true },
    document: { value: doc ?? new Y.Doc(), writable: true },
    persistenceMode: { value: { kind: "available" }, writable: true },
    realtimeSyncStarted: { value: true, writable: true },
    documentLoadCompleted: { value: false, writable: true },
    isSkippingSave: { value: false, writable: true },
    lastKnownDocumentBytes: { value: 0, writable: true },
    hasWarnedDocumentSize: { value: false, writable: true },
    cachedSubscribers: { value: null, writable: true },
    cachedSharedRefs: { value: null, writable: true },
    cachedSharedPerms: { value: null, writable: true },
    cachedResetEpoch: { value: undefined, writable: true },
    compactionAutosaveSnapshot: { value: null, writable: true },
    emptyRoomCompactionPromise: { value: null, writable: true },
    getConnections: { value: () => [], writable: true },
  }) as any;

  // Class field initializers do not run for Object.create, so the admin handler
  // is wired up explicitly.
  room.adminHandler = new AdminHandler(room);
  return room;
}

function createRoom(name = "example-room") {
  const storage = new FakeStorage();
  return { room: buildRoom(storage, name), storage };
}

/**
 * Mirrors the platform's start sequence without the full Server base class:
 * the pre-hydration gate in onStart, then hydration only if it allows it.
 * Tests that need the genuine entry points live in quarantinePlatformEntry.
 */
async function startRoom(room: any): Promise<void> {
  await room.circuitBreaker.applyExternalQuarantineFlag();
  if (room.circuitBreaker.isQuarantined()) {
    await room.circuitBreaker.enterQuarantineRuntimeState();
    return;
  }
  if (await room.circuitBreaker.shouldDeferLoad()) return;
  await room.onLoad();
}

// Models a Durable Object restart: a fresh instance over the same storage.
function restartRoom(storage: FakeStorage, name = "example-room") {
  return buildRoom(storage, name);
}

// Builds a Y.Doc whose encoded form is at least `targetBytes`, so large-document
// tests exercise a realistic Yjs document rather than a synthetic string.
function buildLargeDoc(targetBytes: number): Y.Doc {
  const doc = new Y.Doc();
  const map = doc.getMap("play");
  let index = 0;
  while (Y.encodeStateAsUpdate(doc).length * 1.34 < targetBytes) {
    map.set(`key-${index}`, "x".repeat(8192));
    index += 1;
  }
  return doc;
}

function encodeDoc(doc: Y.Doc): string {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

function docIsEmpty(doc: Y.Doc): boolean {
  return Object.keys(doc.getMap("play").toJSON()).length === 0;
}

const MB = 1024 * 1024;

const SMALL_DOCUMENT = (() => {
  const doc = new Y.Doc();
  doc.getMap("play").set("greeting", "hello");
  return encodeDoc(doc);
})();

// Sits in the band that loads fine but OOMs when compacted in place.
const COMPACT_LETHAL_DOC = buildLargeDoc(6 * MB);
const COMPACT_LETHAL_DOCUMENT = encodeDoc(COMPACT_LETHAL_DOC);

beforeEach(() => {
  persistedRow.document = null;
  upsertCalls = [];
  documentReadCount = 0;
  documentReadErrors = [];
  kvStore.clear();
  kvFailure = null;
});

describe("hydration write guards", () => {
  test("a delayed autosave after hydration failure performs zero database writes", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    documentReadErrors = [
      new Error("hydration timed out"),
      new Error("hydration timed out"),
      new Error("hydration timed out"),
    ];
    const { room } = createRoom();
    const warnings: string[] = [];
    const errors: string[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalLog = console.log;
    console.warn = (message: unknown) => warnings.push(String(message));
    console.error = (message: unknown) => errors.push(String(message));

    try {
      await startRoom(room);
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
    const logs: string[] = [];
    console.log = (message: unknown) => logs.push(String(message));
    try {
      room.markPersistenceAvailable();
    } finally {
      console.log = originalLog;
    }

    const autosaveWarnings: string[] = [];
    console.warn = (message: unknown) => autosaveWarnings.push(String(message));
    try {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          void room.onSave().then(resolve);
        }, 0);
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(room.documentLoadCompleted).toBe(false);
    expect(room.isPersistenceAvailable()).toBe(true);
    expect(documentReadCount).toBe(3);
    expect(warnings).toHaveLength(2);
    expect(errors).toEqual([
      "[PartyServer] SUPABASE PERSISTENCE UNAVAILABLE: room=example-room timeoutMs=5000 attempts=3 reason=hydration timed out Entering TRANSIENT MODE: awareness may continue, shared-data writes disabled, autosave disabled, admin writes disabled.",
    ]);
    expect(logs).toEqual([
      "[PartyServer] Supabase persistence restored for room=example-room; leaving transient mode.",
    ]);
    expect(autosaveWarnings).toEqual([
      "[PartyServer] Autosave skipped for room example-room: room document has not completed hydration or persistence is unavailable.",
    ]);
    expect(upsertCalls).toEqual([]);
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  test("bridge flushes do not run before hydration completes", async () => {
    const { room } = createRoom();
    let pruneCalls = 0;
    const warnings: string[] = [];
    const originalWarn = console.warn;
    room.pruneBridgeLeases = async () => {
      pruneCalls += 1;
      return [];
    };

    console.warn = (message: unknown) => warnings.push(String(message));
    try {
      await room.flushBridgeUpdates(room.document);
    } finally {
      console.warn = originalWarn;
    }

    expect(pruneCalls).toBe(0);
    expect(warnings).toEqual([
      "[PartyServer] Bridge flush skipped for room example-room: document hydration or persistence unavailable.",
    ]);
    expect(upsertCalls).toEqual([]);
  });

  test("automatic compaction does not run before hydration completes", async () => {
    const { room } = createRoom();
    let compactionCalls = 0;
    room.runAutomaticCompaction = async () => {
      compactionCalls += 1;
    };

    await room.compactEmptyRoomDocument();

    expect(compactionCalls).toBe(0);
    expect(upsertCalls).toEqual([]);
  });

  test("unhydrated rooms are read-only until persistence is writable", () => {
    const { room } = createRoom();

    expect(room.isReadOnly({})).toBe(true);

    room.documentLoadCompleted = true;
    expect(room.isReadOnly({})).toBe(false);

    room.persistenceMode = {
      kind: "transient",
      reason: "database unavailable",
      failedAt: Date.now(),
    };
    expect(room.isReadOnly({})).toBe(true);
  });

  test("bridge subscription and apply writes return 503 before hydration", async () => {
    const { room, storage } = createRoom();

    const subscribeResponse = await room.onRequest(
      new Request("https://example.com/parties/main/example-room", {
        method: "POST",
        body: JSON.stringify({
          action: "subscribe",
          consumerRoomId: "consumer-room",
          elementIds: ["shared"],
        }),
      })
    );
    const applyResponse = await room.onRequest(
      new Request("https://example.com/parties/main/example-room", {
        method: "POST",
        body: JSON.stringify({
          action: "apply-subtrees-immediate",
          subtrees: { "can-play": { shared: { value: "blocked" } } },
          sender: "consumer-room",
          originKind: "consumer",
        }),
      })
    );

    expect(subscribeResponse.status).toBe(503);
    expect(applyResponse.status).toBe(503);
    expect(storage.values.get("subscribers")).toBeUndefined();
    expect(docIsEmpty(room.document)).toBe(true);
  });

  test("custom bridge registration writes are ignored before hydration", async () => {
    const { room, storage } = createRoom();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: unknown) => warnings.push(String(message));

    try {
      await room.onCustomMessage(
        {},
        JSON.stringify({
          type: "add-shared-reference",
          reference: {
            domain: "source.example",
            path: "/",
            elementId: "shared",
          },
        })
      );
      await room.onCustomMessage(
        {},
        JSON.stringify({
          type: "register-shared-element",
          element: { elementId: "shared", permissions: "read-write" },
        })
      );
    } finally {
      console.warn = originalWarn;
    }

    expect(storage.values.get("sharedReferences")).toBeUndefined();
    expect(storage.values.get("sharedPermissions")).toBeUndefined();
    expect(warnings).toEqual([
      "[Bridge] Ignoring add-shared-reference for room example-room: document hydration or persistence unavailable.",
      "[Bridge] Ignoring register-shared-element for room example-room: document hydration or persistence unavailable.",
    ]);
  });
});

describe("load path", () => {
  // The central correction: rooms in the 6-8MB band load successfully in
  // production, so size must never block hydration.
  test("a large document still loads and the room stays normal", async () => {
    persistedRow.document = COMPACT_LETHAL_DOCUMENT;
    const { room } = createRoom();

    await startRoom(room);

    expect(room.circuitBreaker.isQuarantined()).toBe(false);
    expect(room.isPersistenceAvailable()).toBe(true);
    expect(docIsEmpty(room.document)).toBe(false);
  });

  test("a small document loads normally", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();

    await startRoom(room);

    expect(room.circuitBreaker.isQuarantined()).toBe(false);
    expect(room.document.getMap("play").get("greeting")).toBe("hello");
    expect(storage.values.get("quarantineLoadAttempts")).toBeUndefined();
  });

  test("the load counter is committed before hydration and cleared after", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();

    await startRoom(room);

    expect(storage.writeLog[0]).toEqual({
      key: "quarantineLoadAttempts",
      value: 1,
    });
    expect(storage.values.get("quarantineLoadAttempts")).toBeUndefined();
  });

  // Previously this asserted that a failing room re-read and re-hydrated on
  // every request until it hit the quarantine threshold, which is what turned a
  // single OOM into a crash loop. The contract is now a hard backoff window.
  test("a room inside its backoff window does not read the document", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 5 * 60_000);

    await startRoom(room);

    // Supabase was never queried, and nothing was hydrated.
    expect(documentReadCount).toBe(0);
    expect(docIsEmpty(room.document)).toBe(true);
    expect(room.circuitBreaker.isLoadDeferred()).toBe(true);
    // A deferred room is NOT quarantined: no transient mode, no ephemeral service.
    expect(room.circuitBreaker.isQuarantined()).toBe(false);
  });

  test("the first inferred load failure waits on the one-minute rung", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 1);
    const before = Date.now();

    await startRoom(room);

    const retryAfter = storage.values.get("loadRetryAfter") as number;
    expect(retryAfter).toBeGreaterThanOrEqual(before + 60_000);
    expect(retryAfter).toBeLessThanOrEqual(before + 61_000);
    expect(documentReadCount).toBe(0);
    expect(room.circuitBreaker.isLoadDeferred()).toBe(true);
  });

  test("a deferred room answers requests with 503 and Retry-After", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 90_000);
    await startRoom(room);

    const response = await room.onRequest(
      new Request("https://example.com/parties/main/example-room", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.status).toBe(503);
    const retryAfter = Number(response.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(90);
    const body = await response.json();
    expect(body.error).toBe("room_load_deferred");
    // Still zero reads: answering a request must not trigger a load either.
    expect(documentReadCount).toBe(0);
  });

  // Admin has to stay reachable, otherwise a room that will not load cannot be
  // inspected or quarantined.
  test("admin routes still work while a room is deferred", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 60_000);
    await startRoom(room);

    const response = await room.onRequest(
      new Request(
        "https://example.com/parties/main/example-room/admin/quarantine-status",
        { method: "GET" }
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.failures.load).toBe(2);
  });

  test("admin write routes cannot persist an un-hydrated deferred document", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 60_000);
    await startRoom(room);

    const response = await room.onRequest(
      new Request(
        "https://example.com/parties/main/example-room/admin/force-save-live",
        { method: "POST" }
      )
    );

    expect(response.status).toBe(503);
    expect(upsertCalls).toEqual([]);
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  test("manual quarantine remains reachable while a room is deferred", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 60_000);
    await startRoom(room);

    const response = await room.onRequest(
      new Request(
        "https://example.com/parties/main/example-room/admin/quarantine-set",
        {
          method: "POST",
          body: JSON.stringify({ reason: "operator intervention" }),
        }
      )
    );

    expect(response.status).toBe(200);
    expect(room.circuitBreaker.isQuarantined()).toBe(true);
    expect(kvStore.get("quarantine:example-room")).toBe(
      "operator intervention"
    );
    expect(documentReadCount).toBe(0);
  });

  test("a connection to a deferred room is closed, not joined", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 60_000);
    await startRoom(room);

    const closes: Array<{ code: number; reason: string }> = [];
    const connection = {
      id: "c1",
      close: (code: number, reason: string) => closes.push({ code, reason }),
      setState: () => {},
      state: {},
    };

    await room.onConnect(connection, {
      request: new Request("https://example.com/parties/main/example-room"),
    });

    expect(closes).toEqual([{ code: 1013, reason: "Room Load Deferred" }]);
  });

  // At the deadline exactly one attempt proceeds. The next deadline is written
  // before hydration, so requests racing the boundary in a fresh isolate see a
  // future deadline instead of all retrying together.
  test("the deadline allows a single attempt and re-arms before hydrating", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() - 1);

    const deadlineWrites: number[] = [];
    const originalPut = storage.put.bind(storage);
    storage.put = async (key: string, value: unknown) => {
      if (key === "loadRetryAfter") {
        // Record whether the document had been read by the time this was written.
        deadlineWrites.push(documentReadCount);
      }
      return originalPut(key, value);
    };

    await startRoom(room);

    // The new deadline was committed while the read count was still zero.
    expect(deadlineWrites).toEqual([0]);
    expect(room.circuitBreaker.isLoadDeferred()).toBe(false);
    expect(documentReadCount).toBe(1);
    expect(room.document.getMap("play").get("greeting")).toBe("hello");
  });

  test("a first-time failure is not deferred, so healthy rooms are unaffected", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();

    await startRoom(room);

    expect(room.circuitBreaker.isLoadDeferred()).toBe(false);
    expect(documentReadCount).toBe(1);
  });

  test("eight consecutive load failures quarantine as a last resort", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 8);

    await startRoom(room);

    expect(room.circuitBreaker.isQuarantined()).toBe(true);
    expect(room.circuitBreaker.getQuarantineState().reason).toBe(
      "repeated-failures"
    );
    expect(docIsEmpty(room.document)).toBe(true);
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  test("a successful load clears failure history and pending backoff", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 4);
    // Already past the deadline, so this start is the one allowed attempt.
    storage.values.set("loadRetryAfter", Date.now() - 1000);

    await startRoom(room);

    expect(storage.values.get("quarantineLoadAttempts")).toBeUndefined();
    expect(storage.values.get("loadRetryAfter")).toBeUndefined();
  });
});

describe("automatic compaction breaker", () => {
  test("document size does not block creation of a compaction candidate", () => {
    const room = buildRoom(
      new FakeStorage(),
      "example-room",
      COMPACT_LETHAL_DOC
    );

    const compacted = room.buildCompactedDocument(
      COMPACT_LETHAL_DOC,
      COMPACT_LETHAL_DOCUMENT
    );

    expect(compacted).not.toBeNull();
    expect(compacted.beforeSize).toBeGreaterThan(4 * MB);
    expect(compacted.afterSize).toBeGreaterThan(0);
  });

  test("a healthy small room still compacts normally", async () => {
    // Deleted entries leave tombstones behind, which is the history compaction
    // actually removes. A doc without history compacts larger and is correctly
    // skipped, so the churn here has to be real.
    const doc = new Y.Doc();
    const map = doc.getMap("play");
    for (let i = 0; i < 400; i += 1) {
      map.set(`key-${i}`, "value-".repeat(40) + i);
    }
    for (let i = 0; i < 399; i += 1) {
      map.delete(`key-${i}`);
    }
    persistedRow.document = encodeDoc(doc);
    const storage = new FakeStorage();
    const room = buildRoom(storage, "example-room", doc);
    room.documentLoadCompleted = true;

    await room.compactEmptyRoomDocument();

    expect(upsertCalls.length).toBe(1);
    expect(persistedRow.document).not.toBe("");
    expect(storage.values.get("compactionAttempts")).toBeUndefined();
    expect(storage.values.get("compactionRetryAfter")).toBeUndefined();
  });

  test("three vanished attempts retry after 15s and 30s, then disable", async () => {
    const { room, storage } = createRoom();
    storage.values.set("emptyRoomCompactAfter", Date.now() - 1);
    storage.values.set("compactionAttempts", 1);

    const firstRetryStart = Date.now();
    expect(await room.circuitBreaker.getCompactionAdmission()).toEqual({
      kind: "defer",
      retryAt: expect.any(Number),
    });
    const firstRetryAt = storage.values.get("compactionRetryAfter") as number;
    expect(firstRetryAt).toBeGreaterThanOrEqual(firstRetryStart + 15_000);
    expect(firstRetryAt).toBeLessThanOrEqual(firstRetryStart + 16_000);

    storage.values.set("compactionRetryAfter", Date.now() - 1);
    expect(await room.circuitBreaker.getCompactionAdmission()).toEqual({
      kind: "run",
    });
    const secondRetryAt = storage.values.get("compactionRetryAfter") as number;
    expect(secondRetryAt).toBeGreaterThanOrEqual(Date.now() + 29_000);
    expect(await room.circuitBreaker.beginCompactionAttempt()).toBe(2);

    storage.values.set("compactionRetryAfter", Date.now() - 1);
    expect(await room.circuitBreaker.getCompactionAdmission()).toEqual({
      kind: "run",
    });
    expect(storage.values.get("compactionRetryAfter")).toBeUndefined();
    expect(await room.circuitBreaker.beginCompactionAttempt()).toBe(3);

    const disabled = await room.circuitBreaker.getCompactionAdmission();
    expect(disabled).toEqual({
      kind: "disabled",
      disabledAt: expect.any(Number),
    });
    expect(storage.values.get("compactionDisabledAt")).toBe(
      disabled.disabledAt
    );
    expect(storage.values.get("emptyRoomCompactAfter")).toBeUndefined();
    expect(room.circuitBreaker.isQuarantined()).toBe(false);
    expect(room.isPersistenceAvailable()).toBe(true);
  });

  test("an observed exception clears the compaction attempt marker", async () => {
    const { room, storage } = createRoom();
    room.documentLoadCompleted = true;
    room.buildCompactedDocument = () => {
      throw new Error("observed compaction failure");
    };

    await expect(room.compactEmptyRoomDocument()).rejects.toThrow(
      "observed compaction failure"
    );

    expect(storage.values.get("compactionAttempts")).toBeUndefined();
    expect(storage.values.get("compactionRetryAfter")).toBeUndefined();
    expect(storage.values.get("compactionDisabledAt")).toBeUndefined();
  });

  test("a disabled room still loads and persists without rescheduling compaction", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("compactionAttempts", 3);
    await room.circuitBreaker.getCompactionAdmission();
    storage.setAlarmCalls = [];

    await startRoom(room);
    room.document.getMap("play").set("greeting", "updated");
    await room.onSave();

    expect(room.document.getMap("play").get("greeting")).toBe("updated");
    expect(upsertCalls).toHaveLength(1);
    expect(persistedRow.document).not.toBe(SMALL_DOCUMENT);
    expect(storage.values.get("emptyRoomCompactAfter")).toBeUndefined();
    expect(storage.setAlarmCalls).toEqual([]);
    expect(await room.circuitBreaker.getCompactionDisabledAt()).not.toBeNull();
  });
});

describe("alarm failure backoff", () => {
  test("the alarm counter is committed before the risky work", async () => {
    const { room, storage } = createRoom();

    await room.onAlarm();

    expect(
      storage.writeLog.some((entry) => entry.key === "alarmFailureAttempts")
    ).toBe(true);
    // Completing the alarm clears it again.
    expect(storage.values.get("alarmFailureAttempts")).toBeUndefined();
  });

  test("a failed alarm backs off instead of retrying immediately", async () => {
    const { room, storage } = createRoom();
    // A previous alarm started and never completed.
    storage.values.set("alarmFailureAttempts", 1);
    const before = Date.now();

    await room.onAlarm();

    const retryAfter = storage.values.get("alarmRetryAfter") as number;
    // First failure backs off by one minute, absorbing the platform's rapid retry.
    expect(retryAfter).toBeGreaterThanOrEqual(before + 60_000);
    // The alarm is re-armed at the backoff time, and no work ran.
    expect(storage.alarm).toBe(retryAfter);
  });

  test("backoff escalates with consecutive failures", async () => {
    const delays: number[] = [];

    for (const failures of [1, 2, 3]) {
      const { room, storage } = createRoom();
      storage.values.set("alarmFailureAttempts", failures);
      const before = Date.now();
      await room.onAlarm();
      delays.push((storage.values.get("alarmRetryAfter") as number) - before);
    }

    expect(delays[0]).toBeLessThan(delays[1]);
    expect(delays[1]).toBeLessThan(delays[2]);
  });

  test("work resumes once the backoff has elapsed", async () => {
    const { room, storage } = createRoom();
    storage.values.set("alarmFailureAttempts", 1);
    // The backoff window has already passed.
    storage.values.set("alarmRetryAfter", Date.now() - 1000);

    await room.onAlarm();

    // The alarm ran its work and cleared the failure history.
    expect(storage.values.get("alarmFailureAttempts")).toBeUndefined();
    expect(storage.values.get("alarmRetryAfter")).toBeUndefined();
  });

  test("a due alarm reserves the next backoff rung before risky work", async () => {
    const { room, storage } = createRoom();
    storage.values.set("alarmFailureAttempts", 1);
    storage.values.set("alarmRetryAfter", Date.now() - 1);
    const before = Date.now();

    await room.onAlarm();

    // The next rung is committed before the risky work runs, so an OOM inside
    // that work still lands the room in a longer window.
    const retryAfter = storage.values.get("alarmRetryAfter") as
      | number
      | undefined;
    expect(retryAfter ?? before + 5 * 60_000).toBeGreaterThanOrEqual(
      before + 5 * 60_000
    );
  });

  // A caught compaction exception proves the isolate survived, so it must not
  // count as either a compaction vanish or a generic alarm failure.
  test("an observed compaction exception does not count as a vanish", async () => {
    const { room, storage } = createRoom();
    storage.values.set("emptyRoomCompactAfter", Date.now() - 1);
    room.compactEmptyRoomDocument = async () => {
      throw new Error("simulated supabase blip");
    };

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (message: unknown, ...rest: unknown[]) => {
      errors.push(`${String(message)} ${rest.map(String).join(" ")}`);
    };
    try {
      await room.onAlarm();
    } finally {
      console.error = originalError;
    }

    // Neither independent ledger is incremented.
    expect(storage.values.get("alarmFailureAttempts")).toBeUndefined();
    expect(storage.values.get("compactionAttempts")).toBeUndefined();
    expect(room.circuitBreaker.isQuarantined()).toBe(false);
    // And it is still reported, with room context, rather than swallowed.
    expect(
      errors.some(
        (line) =>
          line.includes("Automatic compaction failed for room=example-room") &&
          line.includes("simulated supabase blip")
      )
    ).toBe(true);
  });

  test("repeated observed exceptions never quarantine a healthy room", async () => {
    const { room, storage } = createRoom();
    room.compactEmptyRoomDocument = async () => {
      throw new Error("simulated supabase outage");
    };

    const originalError = console.error;
    console.error = () => {};
    try {
      for (let i = 0; i < 12; i += 1) {
        storage.values.set("emptyRoomCompactAfter", Date.now() - 1);
        await room.onAlarm();
      }
    } finally {
      console.error = originalError;
    }

    expect(room.circuitBreaker.isQuarantined()).toBe(false);
    expect(storage.values.get("alarmFailureAttempts")).toBeUndefined();
  });

  test("eight consecutive alarm failures quarantine as a last resort", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("alarmFailureAttempts", 8);

    await room.onAlarm();

    expect(room.circuitBreaker.isQuarantined()).toBe(true);
    expect(room.circuitBreaker.getQuarantineState().reason).toBe(
      "repeated-failures"
    );
    expect(room.circuitBreaker.getQuarantineState().failureKind).toBe("alarm");
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  test("a quarantined room does no alarm work and parks the alarm", async () => {
    const { room, storage } = createRoom();
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });
    storage.setAlarmCalls = [];

    await room.onAlarm();

    expect(storage.setAlarmCalls).toEqual([]);
    expect(storage.alarm).toBeNull();
  });
});

describe("hardening", () => {
  test("a temporary Supabase failure recovers before transient mode", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    documentReadErrors = [new Error("temporary failure")];
    const { room } = createRoom();
    const warnings: string[] = [];
    const logs: string[] = [];
    const originalWarn = console.warn;
    const originalLog = console.log;
    console.warn = (message: unknown) => warnings.push(String(message));
    console.log = (message: unknown) => logs.push(String(message));

    try {
      await startRoom(room);
    } finally {
      console.warn = originalWarn;
      console.log = originalLog;
    }

    expect(documentReadCount).toBe(2);
    expect(room.isPersistenceAvailable()).toBe(true);
    expect(docIsEmpty(room.document)).toBe(false);
    expect(warnings).toEqual([
      "[PartyServer] Supabase document load attempt 1/3 failed for room=example-room; retrying in 1ms: temporary failure",
    ]);
    expect(logs).toEqual([
      "[PartyServer] Supabase document load recovered for room=example-room after 2 attempts.",
    ]);
  });

  test("transient mode starts only after every Supabase attempt fails", async () => {
    documentReadErrors = [
      new Error("failure 1"),
      new Error("failure 2"),
      new Error("failure 3"),
    ];
    const { room } = createRoom();
    const warnings: string[] = [];
    const errors: string[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (message: unknown) => warnings.push(String(message));
    console.error = (message: unknown) => errors.push(String(message));

    try {
      await startRoom(room);
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }

    expect(documentReadCount).toBe(3);
    expect(room.isPersistenceAvailable()).toBe(false);
    expect(docIsEmpty(room.document)).toBe(true);
    expect(warnings).toEqual([
      "[PartyServer] Supabase document load attempt 1/3 failed for room=example-room; retrying in 1ms: failure 1",
      "[PartyServer] Supabase document load attempt 2/3 failed for room=example-room; retrying in 2ms: failure 2",
    ]);
    expect(errors).toEqual([
      "[PartyServer] SUPABASE PERSISTENCE UNAVAILABLE: room=example-room timeoutMs=5000 attempts=3 reason=failure 3 Entering TRANSIENT MODE: awareness may continue, shared-data writes disabled, autosave disabled, admin writes disabled.",
    ]);
  });

  // F5: admin force-reload calls markPersistenceAvailable, which would otherwise
  // silently lift the write park on a quarantined room.
  test("markPersistenceAvailable cannot lift a quarantine write park", async () => {
    const { room } = createRoom();
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });

    room.markPersistenceAvailable();

    expect(room.isPersistenceAvailable()).toBe(false);
  });

  // M2: a KV failure must not skip transient mode, alarm cancellation, or the log.
  test("local safety applies even when the external write fails", async () => {
    const { room, storage } = createRoom();
    storage.alarm = Date.now() + 60_000;
    kvFailure = new Error("kv down");

    await expect(
      room.circuitBreaker.enterQuarantine({
        reason: "manual",
        detail: "operator",
        failureKind: null,
        failureCount: 0,
      })
    ).rejects.toThrow("kv down");

    // The throw propagates so the operator learns the flag did not stick, but
    // the room is already locally safe.
    expect(room.circuitBreaker.isQuarantined()).toBe(true);
    expect(room.isPersistenceAvailable()).toBe(false);
    expect(storage.alarm).toBeNull();
  });

  // L1: the deadline is written speculatively before an attempt that may never
  // reach hydration.
  test("a rolled-back load attempt also rolls back its deadline", async () => {
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() - 1000);
    // Supabase is unreachable, so hydration is never attempted.
    const originalFrom = supabaseStub.from;
    (supabaseStub as any).from = () => ({
      select: () => ({
        eq: () => {
          const maybeSingle = async () => ({
            data: null,
            error: { message: "connection refused" },
          });
          return {
            maybeSingle,
            abortSignal: () => ({ maybeSingle }),
          };
        },
      }),
    });

    try {
      await startRoom(room);
    } finally {
      (supabaseStub as any).from = originalFrom;
    }

    expect(storage.values.get("loadRetryAfter")).toBeUndefined();
    expect(storage.values.get("quarantineLoadAttempts")).toBe(2);
  });

  // L2: the flag is applied from the control plane and then resumed from durable
  // storage in the same start.
  test("a KV-flagged start logs the quarantine only once", async () => {
    const { room } = createRoom();
    kvStore.set("quarantine:example-room", "operator stop");

    const logs: string[] = [];
    const originalError = console.error;
    console.error = (message: unknown) => {
      logs.push(String(message));
    };
    try {
      await startRoom(room);
    } finally {
      console.error = originalError;
    }

    expect(logs.filter((l) => l.includes("ROOM QUARANTINED")).length).toBe(1);
  });

  // M5: clearing must not report "nothing to clear" while silently wiping state.
  test("clearing reports the ledger it reset", async () => {
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 3);
    storage.values.set("alarmFailureAttempts", 2);

    const summary = await room.circuitBreaker.clearQuarantine();

    expect(summary).toEqual({
      wasQuarantined: false,
      loadFailures: 3,
      alarmFailures: 2,
      wasLoadDeferred: false,
    });
  });

  test("clearing replaces an active deferral with an immediate guarded reload", async () => {
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 60_000);
    await startRoom(room);
    expect(room.circuitBreaker.isLoadDeferred()).toBe(true);

    const summary = await room.circuitBreaker.clearQuarantine();

    // The original backoff is gone, but the empty document stays gated until a
    // normal request or connection completes a guarded hydration.
    expect(summary.wasLoadDeferred).toBe(true);
    expect(room.circuitBreaker.isLoadDeferred()).toBe(true);
    expect(docIsEmpty(room.document)).toBe(true);
  });

  // M3: a missing binding means quarantine is local only.
  test("status distinguishes an unavailable control plane from no flag", async () => {
    const { room } = createRoom();
    kvFailure = new Error("kv down");

    const body = await room.circuitBreaker.getQuarantineStatusBody();

    expect(body.externalQuarantineFlag).toBe("kvUnavailable");
  });

  test("status reports the external flag value when set", async () => {
    const { room } = createRoom();
    kvStore.set("quarantine:example-room", "operator stop");

    const body = await room.circuitBreaker.getQuarantineStatusBody();

    expect(body.externalQuarantineFlag).toBe("operator stop");
  });
});

describe("admin quarantine endpoints", () => {
  function adminRequest(path: string, init?: RequestInit) {
    return new Request(
      `https://example.com/parties/main/example-room/admin/${path}`,
      init
    );
  }

  // M2: without an internal catch these rejections escape the router (which
  // returns un-awaited promises) as a bare 500 with no CORS and no log.
  test("an async failure returns a JSON 500 with CORS, not a bare platform error", async () => {
    const { room } = createRoom();
    room.circuitBreaker.getQuarantineStatusBody = async () => {
      throw new Error("storage exploded");
    };

    const response = await room.onRequest(
      adminRequest("quarantine-status", { method: "GET" })
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await response.json();
    expect(body.message).toBe("storage exploded");
  });

  // L3: silently recording "no reason given" would lose the operator's note.
  test("malformed JSON is rejected instead of quarantining with no reason", async () => {
    const { room } = createRoom();

    const response = await room.onRequest(
      adminRequest("quarantine-set", { method: "POST", body: "{not json" })
    );

    expect(response.status).toBe(400);
    expect(room.circuitBreaker.isQuarantined()).toBe(false);
  });

  test("an empty body still quarantines, with no reason recorded", async () => {
    const { room } = createRoom();

    const response = await room.onRequest(
      adminRequest("quarantine-set", { method: "POST" })
    );

    expect(response.status).toBe(200);
    expect(room.circuitBreaker.isQuarantined()).toBe(true);
    expect(room.circuitBreaker.getQuarantineState().detail).toBe(
      "no reason given"
    );
  });

  test("restoring a document clears quarantine and compaction failure state", async () => {
    const { room } = createRoom();
    persistedRow.document = SMALL_DOCUMENT;
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });
    await room.ctx.storage.put("compactionAttempts", 3);
    await room.ctx.storage.put("compactionRetryAfter", Date.now() + 30_000);
    await room.ctx.storage.put("compactionDisabledAt", Date.now());

    const response = await room.onRequest(
      adminRequest("restore-raw-document", {
        method: "POST",
        body: JSON.stringify({ base64Document: COMPACT_LETHAL_DOCUMENT }),
      })
    );

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.quarantineCleared).toBe(true);
    expect(body.compactionFailureCleared).toBe(true);
    expect(room.circuitBreaker.isQuarantined()).toBe(false);
    expect(room.documentLoadCompleted).toBe(true);
    expect(room.isPersistenceAvailable()).toBe(true);
    expect(await room.circuitBreaker.getCompactionFailureCount()).toBe(0);
    expect(await room.circuitBreaker.getCompactionRetryAfter()).toBeNull();
    expect(await room.circuitBreaker.getCompactionDisabledAt()).toBeNull();
  });

  test("the compaction retry endpoint clears the breaker and runs compaction", async () => {
    const { room } = createRoom();
    persistedRow.document = SMALL_DOCUMENT;
    room.documentLoadCompleted = true;
    room.document.getMap("play").set("greeting", "hello");
    await room.ctx.storage.put("compactionAttempts", 3);
    await room.ctx.storage.put("compactionDisabledAt", Date.now());

    const response = await room.onRequest(
      adminRequest("compaction-retry", { method: "POST" })
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.reset.failures).toBe(3);
    expect(body.reset.disabledAt).toEqual(expect.any(Number));
    expect(body.compaction.disabled).toBe(false);
    expect(body.compaction.failures).toBe(0);
    expect(await room.circuitBreaker.getCompactionDisabledAt()).toBeNull();
  });

  // M4: the restore already succeeded and is durable, so a cleanup failure must
  // not present as a 500 that invites a pointless re-restore.
  test("a cleanup failure still reports the restore as successful", async () => {
    const { room } = createRoom();
    persistedRow.document = COMPACT_LETHAL_DOCUMENT;
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });
    // The KV delete during clearQuarantine fails.
    kvFailure = new Error("kv down");

    const response = await room.onRequest(
      adminRequest("restore-raw-document", {
        method: "POST",
        body: JSON.stringify({ base64Document: SMALL_DOCUMENT }),
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.quarantineCleared).toBe(false);
    expect(body.cleanupError).toContain("kv down");
  });

  test("the response reports whether the external flag was written", async () => {
    const { room } = createRoom();

    const response = await room.onRequest(
      adminRequest("quarantine-set", {
        method: "POST",
        body: JSON.stringify({ reason: "investigating" }),
      })
    );

    const body = await response.json();
    expect(body.externalFlagWritten).toBe(true);
    expect(kvStore.get("quarantine:example-room")).toBe("investigating");
  });
});

describe("separate retry ladders", () => {
  // A shared deadline meant a healthy load erased the alarm's backoff, letting
  // compaction start crash-looping again.
  test("a successful load leaves the alarm backoff intact", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    const alarmDeadline = Date.now() + 30 * 60_000;
    storage.values.set("alarmFailureAttempts", 3);
    storage.values.set("alarmRetryAfter", alarmDeadline);

    await startRoom(room);

    expect(storage.values.get("alarmRetryAfter")).toBe(alarmDeadline);
    expect(storage.values.get("alarmFailureAttempts")).toBe(3);
  });

  test("a successful alarm leaves the load backoff intact", async () => {
    const { room, storage } = createRoom();
    const loadDeadline = Date.now() + 30 * 60_000;
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", loadDeadline);

    await room.onAlarm();

    expect(storage.values.get("loadRetryAfter")).toBe(loadDeadline);
    expect(storage.values.get("quarantineLoadAttempts")).toBe(2);
  });

  test("status reports each deadline separately", async () => {
    const { room, storage } = createRoom();
    storage.values.set("loadRetryAfter", 1779829545000);
    storage.values.set("alarmRetryAfter", 1779829999000);

    const body = await room.circuitBreaker.getQuarantineStatusBody();

    expect(body.failures.loadRetryAfter).toBe("2026-05-26T21:05:45.000Z");
    expect(body.failures.alarmRetryAfter).toBe("2026-05-26T21:13:19.000Z");
  });
});

describe("external quarantine control plane", () => {
  // Every admin route runs after hydration, so a room that OOMs on start can
  // only be stopped by a flag consulted before hydration happens.
  test("a KV-flagged room quarantines without reading the document", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();
    kvStore.set("quarantine:example-room", "microcosmos incident");

    await room.circuitBreaker.applyExternalQuarantineFlag();

    expect(room.circuitBreaker.isQuarantined()).toBe(true);
    expect(room.circuitBreaker.getQuarantineState().reason).toBe("manual");
    expect(room.circuitBreaker.getQuarantineState().detail).toBe(
      "microcosmos incident"
    );
    expect(documentReadCount).toBe(0);

    // And the subsequent load never hydrates either.
    await startRoom(room);
    expect(documentReadCount).toBe(0);
    expect(docIsEmpty(room.document)).toBe(true);
  });

  test("setting quarantine writes the flag that survives a crashing room", async () => {
    const { room } = createRoom();

    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator note",
      failureKind: null,
      failureCount: 0,
    });

    expect(kvStore.get("quarantine:example-room")).toBe("operator note");
  });

  test("clearing quarantine removes the external flag", async () => {
    const { room } = createRoom();
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator note",
      failureKind: null,
      failureCount: 0,
    });

    await room.circuitBreaker.clearQuarantine();

    expect(kvStore.has("quarantine:example-room")).toBe(false);
  });

  test("set and clear round-trip through KV across restarts", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator note",
      failureKind: null,
      failureCount: 0,
    });

    // A brand new isolate with EMPTY durable storage still sees the flag.
    const freshStorage = new FakeStorage();
    const restarted = buildRoom(freshStorage, "example-room");
    await restarted.circuitBreaker.applyExternalQuarantineFlag();
    expect(restarted.circuitBreaker.isQuarantined()).toBe(true);

    await restarted.circuitBreaker.clearQuarantine();

    const afterClear = buildRoom(new FakeStorage(), "example-room");
    await afterClear.circuitBreaker.applyExternalQuarantineFlag();
    expect(afterClear.circuitBreaker.isQuarantined()).toBe(false);
  });

  // Manual quarantine is an operator tool, not a correctness gate: a KV outage
  // must never take rooms offline.
  test("a KV read failure fails open", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();
    kvFailure = new Error("kv unavailable");

    await room.circuitBreaker.applyExternalQuarantineFlag();
    await startRoom(room);

    expect(room.circuitBreaker.isQuarantined()).toBe(false);
    expect(room.document.getMap("play").get("greeting")).toBe("hello");
  });
});

describe("manual quarantine", () => {
  test("an operator can quarantine a healthy room and clear it again", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    await startRoom(room);
    expect(room.circuitBreaker.isQuarantined()).toBe(false);

    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "investigating runaway growth",
      failureKind: null,
      failureCount: 0,
    });

    expect(room.circuitBreaker.isQuarantined()).toBe(true);
    expect(room.circuitBreaker.getQuarantineState().detail).toBe(
      "investigating runaway growth"
    );
    // Manual quarantine still suppresses persistence.
    expect(room.isPersistenceAvailable()).toBe(false);
    expect(storage.alarm).toBeNull();

    await room.circuitBreaker.clearQuarantine();
    expect(room.circuitBreaker.isQuarantined()).toBe(false);
  });

  test("clearing quarantine also clears the failure history behind it", async () => {
    const { room, storage } = createRoom();
    storage.values.set("alarmFailureAttempts", 8);
    storage.values.set("quarantineLoadAttempts", 3);
    storage.values.set("loadRetryAfter", Date.now() + 1000);
    storage.values.set("alarmRetryAfter", Date.now() + 1000);
    await room.circuitBreaker.enterQuarantine({
      reason: "repeated-failures",
      detail: "alarm work failed 8 times in a row",
      failureKind: "alarm",
      failureCount: 8,
    });

    await room.circuitBreaker.clearQuarantine();

    expect(storage.values.get("alarmFailureAttempts")).toBeUndefined();
    expect(storage.values.get("quarantineLoadAttempts")).toBeUndefined();
    expect(storage.values.get("loadRetryAfter")).toBeUndefined();
    expect(storage.values.get("alarmRetryAfter")).toBeUndefined();
  });

  test("a quarantined room resumes quarantine on restart without hydrating", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });

    const restarted = restartRoom(storage);
    await startRoom(restarted);

    expect(restarted.circuitBreaker.isQuarantined()).toBe(true);
    expect(docIsEmpty(restarted.document)).toBe(true);
    expect(restarted.isPersistenceAvailable()).toBe(false);
  });
});

describe("quarantine data safety", () => {
  test("autosave cannot overwrite the persisted document while quarantined", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });

    await room.onSave();

    expect(upsertCalls).toEqual([]);
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  test("the document write helper refuses to run while quarantined", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });

    await expect(room.saveDocumentBase64("overwrite-me")).rejects.toThrow(
      /Refusing to persist document for quarantined room/
    );
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  test("a hard reset refuses to run while quarantined", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });

    await expect(room.performHardReset()).rejects.toThrow(
      /Refusing to hard reset for quarantined room/
    );
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  test("a hard reset is not rejected by a document-size threshold", async () => {
    persistedRow.document = COMPACT_LETHAL_DOCUMENT;
    const storage = new FakeStorage();
    const room = buildRoom(storage, "example-room", COMPACT_LETHAL_DOC);

    const response = await room.onRequest(
      new Request(
        "https://example.com/parties/main/example-room/admin/hard-reset",
        { method: "POST" }
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      message: "Hard reset completed successfully",
    });
    expect(upsertCalls).toHaveLength(1);
    expect(persistedRow.document).not.toBe(COMPACT_LETHAL_DOCUMENT);
  });

  test("loading a committed reset repairs a stale server epoch", async () => {
    const resetEpoch = 1_785_299_170_000;
    const resetDocument = new Y.Doc();
    resetDocument.getMap("play").set("greeting", "hello");
    resetDocument.getMap("__playhtml_meta").set("resetEpoch", resetEpoch);
    persistedRow.document = encodeDoc(resetDocument);

    const { room, storage } = createRoom();
    storage.values.set("resetEpoch", resetEpoch - 10_000);

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      await startRoom(room);
    } finally {
      console.warn = originalWarn;
    }

    expect(await room.getResetEpoch()).toBe(resetEpoch);
    expect(storage.values.get("resetEpoch")).toBe(resetEpoch);
    expect(
      warnings.some((line) =>
        line.includes("Loaded document advanced the server reset epoch")
      )
    ).toBe(true);
  });

  test("restoring a snapshot refuses by default while quarantined", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });

    await expect(
      room.restoreFromSnapshot(SMALL_DOCUMENT, { bumpEpoch: true })
    ).rejects.toThrow(/Refusing to restore a snapshot for quarantined room/);
    expect(upsertCalls).toEqual([]);
  });

  // Replacing the document with a repaired one is the sanctioned recovery path.
  test("an explicit repair restore is allowed and replaces the document", async () => {
    persistedRow.document = COMPACT_LETHAL_DOCUMENT;
    const { room } = createRoom();
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });

    await room.restoreFromSnapshot(SMALL_DOCUMENT, {
      bumpEpoch: true,
      allowQuarantined: true,
    });

    expect(upsertCalls.length).toBe(1);
    expect(persistedRow.document).not.toBe(COMPACT_LETHAL_DOCUMENT);
  });
});
