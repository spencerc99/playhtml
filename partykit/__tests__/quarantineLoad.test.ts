// ABOUTME: Drives the real PartyServer load and alarm paths to verify breaker behavior.
// ABOUTME: Asserts rooms stay available while failed work backs off or is disabled.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { Buffer } from "node:buffer";
import {
  parseSharedElementsFromUrl,
  parseSharedReferencesFromUrl,
} from "../sharing";
import { docToJson, getDocResetEpoch, jsonToDoc } from "../docUtils";
import { recordsFromPlay } from "../moderation";

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
let upsertError: Error | null = null;
let beforeUpsert: (() => Promise<void>) | null = null;
let afterUpsert: (() => Promise<void>) | null = null;

// Counts reads of the documents row. The load-backoff contract requires that a
// deferred room never touches Supabase at all, which this makes observable.
let documentReadCount = 0;
let documentReadErrors: Error[] = [];
let beforeDocumentRead: (() => Promise<void>) | null = null;

function createDocumentRead() {
  const maybeSingle = async () => {
    documentReadCount += 1;
    await beforeDocumentRead?.();
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
        await beforeUpsert?.();
        if (upsertError) {
          return { error: { message: upsertError.message } };
        }
        persistedRow.document = row.document;
        await afterUpsert?.();
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
    documentMaintenanceInProgress: { value: false, writable: true },
    documentWriteTail: { value: Promise.resolve(), writable: true },
    documentGeneration: { value: 0, writable: true },
    persistenceObserverAttached: { value: false, writable: true },
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

function moderationTarget(
  play: Record<string, unknown>,
  key: string
): { key: string; contentHash: string } {
  const record = recordsFromPlay(play).find(
    (candidate) => candidate.key === key
  );
  if (!record) throw new Error(`No moderation record found for ${key}`);
  return { key, contentHash: record.contentHash };
}

function adminPost(
  room: any,
  endpoint: string,
  body: Record<string, unknown>
): Promise<Response> {
  return room.adminHandler.handleRequest(
    new Request(
      `https://example.com/parties/main/example-room/admin/${endpoint}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    )
  );
}

function buildReadyAdminRoom(play: Record<string, unknown>) {
  const storage = new FakeStorage();
  const room = buildRoom(storage, "example-room", jsonToDoc(play));
  const effects = {
    closedReasons: [] as string[],
    broadcasts: [] as string[],
  };
  room.documentLoadCompleted = true;
  room.getConnections = () => [
    {
      close(_code: number, reason: string) {
        effects.closedReasons.push(reason);
      },
    },
  ];
  room.broadcastCustomMessage = (message: string) => {
    effects.broadcasts.push(message);
  };
  return { room, effects };
}

function docIsEmpty(doc: Y.Doc): boolean {
  return Object.keys(doc.getMap("play").toJSON()).length === 0;
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
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
  upsertError = null;
  beforeUpsert = null;
  afterUpsert = null;
  documentReadCount = 0;
  documentReadErrors = [];
  beforeDocumentRead = null;
  kvStore.clear();
  kvFailure = null;
});

describe("admin mutations use the authoritative live document", () => {
  test("force-save-live encodes the document after acquiring the write queue", async () => {
    const { room } = buildReadyAdminRoom({
      "can-post": { guestbook: [{ message: "before" }] },
    });
    const releaseQueue = createDeferred();
    const queueStarted = createDeferred();
    const queuedWork = room.runDocumentWrite(async () => {
      queueStarted.resolve();
      await releaseQueue.promise;
    });
    await queueStarted.promise;

    const responsePromise = room.onRequest(
      new Request(
        "https://example.com/parties/main/example-room/admin/force-save-live",
        { method: "POST" }
      )
    );
    await Promise.resolve();
    room.document.getMap("play").set("written-while-queued", "preserved");
    releaseQueue.resolve();

    await queuedWork;
    const response = await responsePromise;
    const savedDoc = new Y.Doc();
    Y.applyUpdate(
      savedDoc,
      new Uint8Array(Buffer.from(persistedRow.document!, "base64"))
    );

    expect(response.status).toBe(200);
    expect(savedDoc.getMap("play").get("written-while-queued")).toBe(
      "preserved"
    );
  });

  test("force-save-live reports when reset-epoch validation skips the save", async () => {
    const { room } = buildReadyAdminRoom({ "can-post": { guestbook: [] } });
    room.document.getMap("__playhtml_meta").set("resetEpoch", 1);
    room.cachedResetEpoch = 2;
    const originalWarn = console.warn;
    console.warn = () => {};

    let response: Response;
    try {
      response = await room.onRequest(
        new Request(
          "https://example.com/parties/main/example-room/admin/force-save-live",
          { method: "POST" }
        )
      );
    } finally {
      console.warn = originalWarn;
    }

    expect(response.status).toBe(409);
    expect(upsertCalls).toEqual([]);
  });

  test("moderation preserves unrelated live-only data and returns commit metadata", async () => {
    const persistedPlay = {
      "can-play": {
        newWords: [
          { id: "remove", word: "remove me" },
          { id: "keep", word: "keep me" },
        ],
      },
    };
    const livePlay = {
      ...persistedPlay,
      "can-move": {
        "live-only": { x: 12, y: 34 },
      },
    };
    persistedRow.document = encodeDoc(jsonToDoc(persistedPlay));
    const { room, effects } = buildReadyAdminRoom(livePlay);

    const response = await adminPost(room, "moderation-remove", {
      targets: [moderationTarget(persistedPlay, "can-play.newWords#0")],
    });
    const body = await response.json();
    const savedPlay = docToJson(room.document);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      removed: 1,
      skipped: [],
      closedConnections: 1,
    });
    expect(body.documentSize).toBeNumber();
    expect(body.resetEpoch).toBeNumber();
    expect(savedPlay?.["can-play"].newWords).toEqual([
      { id: "keep", word: "keep me" },
    ]);
    expect(savedPlay?.["can-move"]["live-only"]).toEqual({ x: 12, y: 34 });
    expect(upsertCalls).toHaveLength(1);
    expect(effects.closedReasons).toEqual(["Room Restored by Admin"]);
    expect(effects.broadcasts).toHaveLength(1);
  });

  test("moderation rechecks stale hashes against live data without saving or resetting", async () => {
    const persistedPlay = {
      "can-post": {
        guestbook: [{ id: "entry", message: "before review" }],
      },
    };
    const livePlay = {
      "can-post": {
        guestbook: [{ id: "entry", message: "edited while reviewing" }],
      },
    };
    persistedRow.document = encodeDoc(jsonToDoc(persistedPlay));
    const { room, effects } = buildReadyAdminRoom(livePlay);

    const response = await adminPost(room, "moderation-remove", {
      targets: [moderationTarget(persistedPlay, "can-post.guestbook#0")],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      removed: 0,
      skipped: [{ key: "can-post.guestbook#0", reason: "hash-mismatch" }],
      documentSize: null,
      resetEpoch: null,
      closedConnections: 0,
    });
    expect(docToJson(room.document)).toEqual(livePlay);
    expect(upsertCalls).toEqual([]);
    expect(effects.closedReasons).toEqual([]);
    expect(effects.broadcasts).toEqual([]);
  });

  test("orphan cleanup dry-run inspects live data without saving or resetting", async () => {
    const persistedPlay = {
      "can-move": { kept: { x: 1, y: 2 } },
    };
    const livePlay = {
      "can-move": {
        kept: { x: 1, y: 2 },
        "live-orphan": { x: 3, y: 4 },
      },
    };
    persistedRow.document = encodeDoc(jsonToDoc(persistedPlay));
    const { room, effects } = buildReadyAdminRoom(livePlay);

    const response = await adminPost(room, "cleanup-orphans", {
      tag: "can-move",
      activeIds: ["kept"],
      dryRun: true,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      tag: "can-move",
      total: 2,
      active: 1,
      orphaned: 1,
      orphanedIds: ["live-orphan"],
      dryRun: true,
    });
    expect(docToJson(room.document)).toEqual(livePlay);
    expect(upsertCalls).toEqual([]);
    expect(effects.closedReasons).toEqual([]);
    expect(effects.broadcasts).toEqual([]);
  });

  test("orphan cleanup skips a no-op without saving or resetting", async () => {
    const livePlay = {
      "can-move": { kept: { x: 1, y: 2 } },
    };
    persistedRow.document = encodeDoc(jsonToDoc(livePlay));
    const { room, effects } = buildReadyAdminRoom(livePlay);

    const response = await adminPost(room, "cleanup-orphans", {
      tag: "can-move",
      activeIds: ["kept"],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      tag: "can-move",
      total: 1,
      active: 1,
      removed: 0,
      orphanedIds: [],
      documentSize: null,
      resetEpoch: null,
      closedConnections: 0,
    });
    expect(upsertCalls).toEqual([]);
    expect(effects.closedReasons).toEqual([]);
    expect(effects.broadcasts).toEqual([]);
  });

  test("orphan cleanup preserves live-only data and returns commit counts", async () => {
    const persistedPlay = {
      "can-move": {
        kept: { x: 1, y: 2 },
        orphan: { x: 3, y: 4 },
      },
    };
    const livePlay = {
      ...persistedPlay,
      "can-toggle": { "live-only": { on: true } },
    };
    persistedRow.document = encodeDoc(jsonToDoc(persistedPlay));
    const { room, effects } = buildReadyAdminRoom(livePlay);

    const response = await adminPost(room, "cleanup-orphans", {
      tag: "can-move",
      activeIds: ["kept"],
    });
    const body = await response.json();
    const savedPlay = docToJson(room.document);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      tag: "can-move",
      total: 2,
      active: 1,
      removed: 1,
      orphanedIds: ["orphan"],
      closedConnections: 1,
    });
    expect(body.documentSize).toBeNumber();
    expect(body.resetEpoch).toBeNumber();
    expect(savedPlay?.["can-move"]).toEqual({ kept: { x: 1, y: 2 } });
    expect(savedPlay?.["can-toggle"]["live-only"]).toEqual({ on: true });
    expect(upsertCalls).toHaveLength(1);
    expect(effects.closedReasons).toEqual(["Room Restored by Admin"]);
    expect(effects.broadcasts).toHaveLength(1);
  });
});

describe("hydration write guards", () => {
  test("room state has one precedence order for every write guard", async () => {
    const { room } = createRoom();

    expect(room.roomState()).toBe("loading");

    room.documentLoadCompleted = true;
    expect(room.roomState()).toBe("ready");

    room.documentMaintenanceInProgress = true;
    expect(room.roomState()).toBe("save-paused");

    room.documentMaintenanceInProgress = false;
    room.persistenceMode = {
      kind: "transient",
      reason: "database unavailable",
      failedAt: Date.now(),
    };
    expect(room.roomState()).toBe("transient");

    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });
    expect(room.roomState()).toBe("quarantined");
  });

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
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(
      "[PartyServer] SUPABASE PERSISTENCE UNAVAILABLE: room=example-room timeoutMs=5000 attempts=3 reason=hydration timed out Entering TRANSIENT MODE: awareness may continue, shared-data writes disabled, autosave disabled, admin writes disabled."
    );
    expect(logs).toEqual([
      "[PartyServer] Supabase persistence restored for room=example-room; leaving transient mode.",
    ]);
    expect(autosaveWarnings).toEqual([
      "[PartyServer] Autosave skipped for room example-room: room state is loading.",
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

  test("awareness messages still apply while shared-data writes are read-only", () => {
    const { room } = createRoom();
    const sourceDoc = new Y.Doc();
    const sourceAwareness = new awarenessProtocol.Awareness(sourceDoc);
    sourceAwareness.setLocalState({ online: true });
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
      sourceAwareness,
      [sourceDoc.clientID]
    );
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(encoder, awarenessUpdate);
    const connectionState: Record<string, unknown> = {};
    const connection = {
      id: "awareness-client",
      send: () => {},
      state: connectionState,
      setState: (next: unknown) => {
        Object.assign(
          connectionState,
          typeof next === "function" ? next(connectionState) : next
        );
      },
    };
    room.document.awareness = new awarenessProtocol.Awareness(room.document);

    room.handleMessage(connection, encoding.toUint8Array(encoder));

    expect(room.isReadOnly(connection)).toBe(true);
    expect(room.document.awareness.getStates().get(sourceDoc.clientID)).toEqual(
      {
        online: true,
      }
    );
    sourceAwareness.destroy();
    room.document.awareness.destroy();
    sourceDoc.destroy();
  });

  test("Yjs document updates are rejected while awareness remains available", () => {
    const { room } = createRoom();
    const sourceDoc = new Y.Doc();
    sourceDoc.getMap("play").set("danger", "must not be applied");
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(sourceDoc));
    const connection = {
      id: "document-client",
      send: () => {},
      state: {},
      setState: () => {},
    };

    room.handleMessage(connection, encoding.toUint8Array(encoder));

    expect(room.isReadOnly(connection)).toBe(true);
    expect(room.document.getMap("play").has("danger")).toBe(false);
    sourceDoc.destroy();
  });

  test("admin writes remain blocked when persistence recovers before hydration", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();
    room.markPersistenceAvailable();

    const response = await room.onRequest(
      new Request(
        "https://example.com/parties/main/example-room/admin/force-save-live",
        { method: "POST" }
      )
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "shared_data_unavailable",
      roomId: "example-room",
    });
    expect(upsertCalls).toEqual([]);
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  test("the reset lock blocks autosave and admin writes until finally releases it", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();
    room.documentLoadCompleted = true;
    room.documentMaintenanceInProgress = true;

    const autosaveResult = await room.persistLiveDocument({
      allowCompaction: false,
    });
    const adminResponse = await room.onRequest(
      new Request(
        "https://example.com/parties/main/example-room/admin/force-save-live",
        { method: "POST" }
      )
    );

    expect(autosaveResult).toBe(false);
    expect(adminResponse.status).toBe(503);
    expect(upsertCalls).toEqual([]);
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
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

  test("connection URL bridge metadata is not stored before hydration", async () => {
    const { room, storage } = createRoom();
    room.getResetEpoch = async () => null;
    room.clearEmptyRoomCompactAfter = async () => {};
    room.scheduleNextAlarm = async () => {};
    room.waitForEmptyRoomCompaction = async () => {};
    room.document.awareness = new awarenessProtocol.Awareness(room.document);
    const connection = {
      id: "bridge-client",
      send: () => {},
      setState: () => {},
      state: {},
    };
    const params = new URLSearchParams({
      sharedReferences: JSON.stringify([
        { domain: "source.example", path: "/", elementId: "shared" },
      ]),
      sharedElements: JSON.stringify([
        { elementId: "shared", permissions: "read-write" },
      ]),
    });
    const requestUrl = `https://example.com/parties/main/example-room?${params.toString()}`;

    expect(parseSharedReferencesFromUrl(requestUrl)).toHaveLength(1);
    expect(parseSharedElementsFromUrl(requestUrl)).toHaveLength(1);

    await room.onConnect(connection, {
      request: new Request(requestUrl),
    });

    expect(storage.values.get("sharedReferences")).toBeUndefined();
    expect(storage.values.get("sharedPermissions")).toBeUndefined();
    room.document.awareness.destroy();
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
  test("transient degradation survives a recovery-marker storage failure", async () => {
    documentReadErrors = [
      new Error("failure 1"),
      new Error("failure 2"),
      new Error("failure 3"),
    ];
    const { room, storage } = createRoom();
    const originalPut = storage.put.bind(storage);
    storage.put = async (key: string, value: unknown) => {
      if (key === "persistenceRecoveryPending") {
        throw new Error("durable storage unavailable");
      }
      await originalPut(key, value);
    };
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    try {
      await expect(startRoom(room)).resolves.toBeUndefined();
    } finally {
      console.error = originalError;
    }

    expect(room.isPersistenceAvailable()).toBe(false);
    expect(room.documentLoadCompleted).toBe(false);
    expect(errors.some((message) => message.includes("durable storage"))).toBe(
      true
    );
  });

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
    const { room, storage } = createRoom();
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
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(
      "[PartyServer] SUPABASE PERSISTENCE UNAVAILABLE: room=example-room timeoutMs=5000 attempts=3 reason=failure 3 Entering TRANSIENT MODE: awareness may continue, shared-data writes disabled, autosave disabled, admin writes disabled."
    );
    expect(storage.alarm).toBe(storage.values.get("loadRetryAfter"));
  });

  test("a warm transient room does not retry before its recovery deadline", async () => {
    documentReadErrors = [
      new Error("failure 1"),
      new Error("failure 2"),
      new Error("failure 3"),
    ];
    const { room, storage } = createRoom();
    const originalError = console.error;
    console.error = () => {};

    try {
      await startRoom(room);
    } finally {
      console.error = originalError;
    }

    const retryAfter = storage.values.get("loadRetryAfter") as number;
    expect(retryAfter).toBeGreaterThan(Date.now());

    await room.onRequest(
      new Request("https://example.com/parties/main/example-room", {
        method: "POST",
        body: JSON.stringify({ nonsense: true }),
      })
    );

    expect(documentReadCount).toBe(3);
    expect(room.isPersistenceAvailable()).toBe(false);
  });

  test("successful hydration resets clients that connected during transient mode", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    documentReadErrors = [
      new Error("failure 1"),
      new Error("failure 2"),
      new Error("failure 3"),
    ];
    const storage = new FakeStorage();
    const failedRoom = buildRoom(storage, "example-room");
    const originalError = console.error;
    console.error = () => {};

    try {
      await startRoom(failedRoom);
    } finally {
      console.error = originalError;
    }

    expect(storage.values.get("persistenceRecoveryPending")).toBe(true);
    storage.values.set("loadRetryAfter", Date.now() - 1);

    const resetMessages: string[] = [];
    const closeCalls: Array<{ code: number; reason: string }> = [];
    const connection = {
      close(code: number, reason: string) {
        closeCalls.push({ code, reason });
      },
    };
    const recoveredRoom = restartRoom(storage);
    recoveredRoom.getConnections = () => [connection];
    recoveredRoom.broadcastCustomMessage = (message: string) => {
      resetMessages.push(message);
    };

    await startRoom(recoveredRoom);

    const resetEpoch = await recoveredRoom.getResetEpoch();
    expect(resetEpoch).toBeNumber();
    expect(resetMessages).toEqual([
      JSON.stringify({
        type: "room-reset",
        timestamp: resetEpoch,
        resetEpoch,
      }),
    ]);
    expect(closeCalls).toEqual([
      { code: 4000, reason: "Room Persistence Restored" },
    ]);
    expect(storage.values.has("persistenceRecoveryPending")).toBe(false);
    expect(persistedRow.document).not.toBe(SMALL_DOCUMENT);

    const persistedDoc = new Y.Doc();
    Y.applyUpdate(
      persistedDoc,
      new Uint8Array(Buffer.from(persistedRow.document ?? "", "base64"))
    );
    expect(persistedDoc.getMap("play").get("greeting")).toBe("hello");
    expect(persistedDoc.getMap("__playhtml_meta").get("resetEpoch")).toBe(
      resetEpoch
    );
  });

  test("a warm transient room retries in place and discards transient document state", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    documentReadErrors = [
      new Error("failure 1"),
      new Error("failure 2"),
      new Error("failure 3"),
    ];
    const { room, storage } = createRoom();
    const originalError = console.error;
    console.error = () => {};

    try {
      await startRoom(room);
    } finally {
      console.error = originalError;
    }

    room.document.getMap("play").set("transient-only", "discard me");
    storage.values.set("loadRetryAfter", Date.now() - 1);
    room.circuitBreaker.setLoadDeferredUntil(Date.now() - 1);

    const resetMessages: string[] = [];
    const closeCalls: Array<{ code: number; reason: string }> = [];
    room.getConnections = () => [
      {
        close(code: number, reason: string) {
          closeCalls.push({ code, reason });
        },
      },
    ];
    room.broadcastCustomMessage = (message: string) => {
      resetMessages.push(message);
    };

    const response = await room.onRequest(
      new Request("https://example.com/parties/main/example-room", {
        method: "POST",
        body: JSON.stringify({ nonsense: true }),
      })
    );

    expect(response.status).not.toBe(503);
    expect(room.isPersistenceAvailable()).toBe(true);
    expect(room.document.getMap("play").get("greeting")).toBe("hello");
    expect(room.document.getMap("play").get("transient-only")).toBeUndefined();
    expect(storage.values.has("persistenceRecoveryPending")).toBe(false);
    expect(storage.values.has("loadRetryAfter")).toBe(false);
    expect(resetMessages).toHaveLength(1);
    expect(closeCalls).toEqual([
      { code: 4000, reason: "Room Persistence Restored" },
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

  test("an observed load failure clears vanish evidence before deferring", async () => {
    const { room, storage } = createRoom();
    const before = Date.now();
    storage.values.set("quarantineLoadAttempts", 7);
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

    const originalError = console.error;
    console.error = () => {};
    try {
      await startRoom(room);
    } finally {
      console.error = originalError;
      (supabaseStub as any).from = originalFrom;
    }

    expect(storage.values.get("loadRetryAfter")).toBeGreaterThanOrEqual(
      before + 60_000
    );
    expect(storage.values.get("loadRetryAfter")).toBeLessThanOrEqual(
      Date.now() + 60_000
    );
    expect(storage.values.get("quarantineLoadAttempts")).toBeUndefined();
    expect(room.circuitBreaker.isQuarantined()).toBe(false);
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

  test("quarantine clear keeps failure evidence until authoritative recovery succeeds", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 3);
    storage.values.set("loadRetryAfter", Date.now() + 60_000);
    await room.circuitBreaker.enterQuarantine({
      reason: "repeated-failures",
      detail: "load work failed three times",
      failureKind: "load",
      failureCount: 3,
    });

    const response = await room.onRequest(
      adminRequest("quarantine-clear", { method: "POST" })
    );

    expect(response.status).toBe(200);
    expect(storage.values.get("quarantineLoadAttempts")).toBe(3);
    expect(storage.values.get("loadRetryAfter")).toBeNumber();
    expect(storage.values.get("persistenceRecoveryPending")).toBe(true);
  });

  test("quarantine recovery replaces live-only state and fences connected clients", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    await startRoom(room);
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });
    room.document.getMap("play").set("live-only", "discard me");

    const closeCalls: Array<{ code: number; reason: string }> = [];
    room.getConnections = () => [
      {
        close(code: number, reason: string) {
          closeCalls.push({ code, reason });
        },
      },
    ];
    room.broadcastCustomMessage = () => {};

    await room.onRequest(adminRequest("quarantine-clear", { method: "POST" }));
    storage.values.set("loadRetryAfter", Date.now() - 1);

    const recovered = await room.onRequest(
      new Request("https://example.com/parties/main/example-room", {
        method: "POST",
        body: JSON.stringify({ nonsense: true }),
      })
    );

    expect(recovered.status).not.toBe(503);
    expect(room.document.getMap("play").get("greeting")).toBe("hello");
    expect(room.document.getMap("play").get("live-only")).toBeUndefined();
    expect(closeCalls).toEqual([
      { code: 4000, reason: "Room Persistence Restored" },
    ]);
    expect(storage.values.has("persistenceRecoveryPending")).toBe(false);
    expect(storage.values.has("quarantineLoadAttempts")).toBe(false);
    expect(storage.values.has("loadRetryAfter")).toBe(false);
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
    expect(room.circuitBreaker.isQuarantined()).toBe(true);
    expect(room.isPersistenceAvailable()).toBe(false);
    expect(room.isReadOnly({})).toBe(true);
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
  test("pending recovery cannot suppress quarantine at the load threshold", async () => {
    const { room, storage } = createRoom();
    storage.values.set("persistenceRecoveryPending", true);
    storage.values.set("quarantineLoadAttempts", 8);

    await room.circuitBreaker.shouldDeferLoad();

    expect(room.circuitBreaker.isQuarantined()).toBe(true);
  });

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

  test("clearing quarantine preserves load evidence until recovery", async () => {
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
    expect(storage.values.get("quarantineLoadAttempts")).toBe(3);
    expect(storage.values.get("loadRetryAfter")).toBeNumber();
    expect(storage.values.get("alarmRetryAfter")).toBeUndefined();
    expect(storage.values.get("persistenceRecoveryPending")).toBe(true);
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
  test("recovery waits for an in-flight save before reading its authoritative snapshot", async () => {
    const initialDoc = new Y.Doc();
    initialDoc.getMap("play").set("version", "initial");
    persistedRow.document = encodeDoc(initialDoc);
    const { room, storage } = createRoom();
    await startRoom(room);

    room.document.getMap("play").set("version", "saved-before-recovery");

    const delayedSave = createDeferred();
    const saveStarted = createDeferred();
    let upsertIndex = 0;
    beforeUpsert = async () => {
      upsertIndex += 1;
      if (upsertIndex === 1) {
        saveStarted.resolve();
        await delayedSave.promise;
      }
    };

    const autosave = room.saveLiveDocument();
    await saveStarted.promise;
    const blockedSaveTail = room.documentWriteTail;
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });
    await room.circuitBreaker.clearQuarantine();
    documentReadCount = 0;
    const cleanupStarted = createDeferred();
    const continueCleanup = createDeferred();
    const originalDelete = storage.delete.bind(storage);
    storage.delete = async (key: string) => {
      if (key === "persistenceRecoveryPending") {
        cleanupStarted.resolve();
        await continueCleanup.promise;
      }
      await originalDelete(key);
    };

    const recovery = room.runDocumentWrite(() => room.loadDocument());

    expect(room.documentWriteTail).not.toBe(blockedSaveTail);
    expect(documentReadCount).toBe(0);

    delayedSave.resolve();
    await autosave;
    await cleanupStarted.promise;

    expect(room.documentLoadCompleted).toBe(false);
    expect(room.isPersistenceAvailable()).toBe(false);

    continueCleanup.resolve();
    await recovery;

    const persistedDoc = new Y.Doc();
    Y.applyUpdate(
      persistedDoc,
      new Uint8Array(Buffer.from(persistedRow.document!, "base64"))
    );
    expect(persistedDoc.getMap("play").get("version")).toBe(
      "saved-before-recovery"
    );
    expect(room.document.getMap("play").get("version")).toBe(
      "saved-before-recovery"
    );
  });

  test("an in-flight autosave cannot finish after an authoritative restore", async () => {
    const { room } = createRoom();
    room.documentLoadCompleted = true;
    const delayedAutosave = createDeferred();
    let upsertIndex = 0;
    beforeUpsert = async () => {
      upsertIndex += 1;
      if (upsertIndex === 1) {
        await delayedAutosave.promise;
      }
    };

    const staleDoc = new Y.Doc();
    staleDoc.getMap("play").set("version", "stale");
    Y.applyUpdate(
      room.document,
      new Uint8Array(Buffer.from(encodeDoc(staleDoc), "base64"))
    );
    const restoredDoc = new Y.Doc();
    restoredDoc.getMap("play").set("version", "restored");

    const autosave = room.saveLiveDocument();
    await Promise.resolve();
    const restore = room.restoreFromSnapshot(encodeDoc(restoredDoc), {
      bumpEpoch: true,
    });
    await Promise.resolve();

    delayedAutosave.resolve();
    await Promise.all([autosave, restore]);

    const persistedDoc = new Y.Doc();
    Y.applyUpdate(
      persistedDoc,
      new Uint8Array(Buffer.from(persistedRow.document!, "base64"))
    );
    expect(persistedDoc.getMap("play").get("version")).toBe("restored");
    expect(upsertCalls).toHaveLength(2);
  });

  test("a save queued behind a restore encodes the restored live document", async () => {
    const { room } = createRoom();
    room.documentLoadCompleted = true;
    const restoreWrite = createDeferred();
    const restoreWriteStarted = createDeferred();
    beforeUpsert = async () => {
      restoreWriteStarted.resolve();
      await restoreWrite.promise;
    };

    const restoredDoc = new Y.Doc();
    restoredDoc.getMap("play").set("version", "restored");

    const restore = room.restoreFromSnapshot(encodeDoc(restoredDoc), {
      bumpEpoch: true,
    });
    await restoreWriteStarted.promise;
    const queuedSave = room.saveLiveDocument();
    restoreWrite.resolve();

    await Promise.all([restore, queuedSave]);
    const persistedDoc = new Y.Doc();
    Y.applyUpdate(
      persistedDoc,
      new Uint8Array(Buffer.from(persistedRow.document!, "base64"))
    );
    expect(persistedDoc.getMap("play").get("version")).toBe("restored");
    expect(upsertCalls).toHaveLength(2);
  });

  test("a failed autosave schedules and completes a durable retry", async () => {
    const { room, storage } = createRoom();
    room.documentLoadCompleted = true;
    room.document.getMap("play").set("message", "retry me");
    upsertError = new Error("database unavailable");
    const originalError = console.error;
    console.error = () => {};

    const before = Date.now();
    try {
      await room.onSave();
    } finally {
      console.error = originalError;
    }

    const retry = storage.values.get("documentSaveRetry") as
      | { retryAt: number }
      | undefined;
    expect(retry?.retryAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(retry?.retryAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(storage.alarm).toBe(retry?.retryAt ?? null);

    upsertError = null;
    storage.alarm = null;
    storage.values.set("documentSaveRetry", { retryAt: Date.now() - 1 });
    await room.onAlarm();

    expect(storage.values.get("documentSaveRetry")).toBeUndefined();
    expect(persistedRow.document).not.toBeNull();
  });

  test("a successful autosave does not schedule a retry when the document changes mid-upsert", async () => {
    const { room, storage } = createRoom();
    room.documentLoadCompleted = true;
    room.attachPersistenceObserver();
    room.document.getMap("play").set("message", "before save");
    const continueUpsert = createDeferred();
    const upsertStarted = createDeferred();
    beforeUpsert = async () => {
      upsertStarted.resolve();
      await continueUpsert.promise;
    };

    const save = room.onSave();
    await upsertStarted.promise;
    room.document.getMap("play").set("message", "after save started");
    continueUpsert.resolve();
    await save;

    expect(storage.values.get("documentSaveRetry")).toBeUndefined();
  });

  test("a skipped retry consumes its due alarm instead of spinning", async () => {
    const { room, storage } = createRoom();
    room.documentLoadCompleted = true;
    room.document.getMap("__playhtml_meta").set("resetEpoch", 1);
    storage.values.set("resetEpoch", 2);
    storage.values.set("documentSaveRetry", {
      retryAt: Date.now() - 1,
    });

    await room.onAlarm();

    expect(storage.values.get("documentSaveRetry")).toBeUndefined();
    expect(upsertCalls).toEqual([]);
  });

  test("a retry that throws waits one minute before trying again", async () => {
    const { room, storage } = createRoom();
    room.documentLoadCompleted = true;
    room.getResetEpoch = async () => {
      throw new Error("durable storage unavailable");
    };
    storage.values.set("documentSaveRetry", { retryAt: Date.now() - 1 });

    const before = Date.now();
    await expect(room.onAlarm()).rejects.toThrow("durable storage unavailable");

    const retry = storage.values.get("documentSaveRetry") as {
      retryAt: number;
    };
    expect(retry.retryAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(retry.retryAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(storage.alarm).toBe(retry.retryAt);
  });

  test("autosave persists the live document when compaction fails", async () => {
    const { room } = createRoom();
    room.documentLoadCompleted = true;
    room.document.getMap("play").set("message", "keep me");
    room.getPersistedDocumentCompactBytes = () => 1;
    room.getPersistedDocumentCompactCheckAfter = async () => null;
    room.maybeCompactAutosaveCandidate = async () => {
      throw new Error("compaction failed");
    };
    const originalError = console.error;
    console.error = () => {};

    try {
      await room.onSave();
    } finally {
      console.error = originalError;
    }

    expect(upsertCalls).toHaveLength(1);
    expect(persistedRow.document).not.toBeNull();
  });

  test("compaction preserves a live update that arrives during validation", async () => {
    const { room } = createRoom();
    room.documentLoadCompleted = true;
    room.attachPersistenceObserver();
    room.document.getMap("play").set("before", "present");
    const candidate = room.buildCompactedDocument(room.document);
    expect(candidate).not.toBeNull();
    persistedRow.document = candidate.sourceBase64;

    const validationStarted = createDeferred();
    const continueValidation = createDeferred();
    beforeDocumentRead = async () => {
      validationStarted.resolve();
      await continueValidation.promise;
    };

    const compaction = room.commitCompactedDocument({
      compactedDocument: candidate,
    });
    await validationStarted.promise;
    room.document.getMap("play").set("during-validation", "preserved");
    continueValidation.resolve();

    expect(await compaction).toBe(false);
    expect(room.document.getMap("play").get("during-validation")).toBe(
      "preserved"
    );

    const persistedDoc = new Y.Doc();
    Y.applyUpdate(
      persistedDoc,
      new Uint8Array(Buffer.from(persistedRow.document!, "base64"))
    );
    expect(persistedDoc.getMap("play").get("during-validation")).toBe(
      "preserved"
    );
  });

  test("a restart keeps the previous document when compaction did not commit", async () => {
    const { room, storage } = createRoom();
    room.documentLoadCompleted = true;
    room.attachPersistenceObserver();
    room.document.getMap("play").set("kept", "persisted");
    const candidate = room.buildCompactedDocument(room.document);
    expect(candidate).not.toBeNull();
    persistedRow.document = candidate.sourceBase64;
    const crashStorage = new FakeStorage();
    beforeUpsert = async () => {
      crashStorage.values = new Map(storage.values);
      throw new Error("simulated isolate crash before database commit");
    };

    await expect(
      room.commitCompactedDocument({ compactedDocument: candidate })
    ).rejects.toThrow("simulated isolate crash before database commit");
    beforeUpsert = null;

    const restarted = restartRoom(crashStorage);
    await startRoom(restarted);

    expect(restarted.roomState()).toBe("ready");
    expect(restarted.document.getMap("play").get("kept")).toBe("persisted");
    expect(persistedRow.document).toBe(candidate.sourceBase64);
  });

  test("a restart keeps the previous document when restore did not commit", async () => {
    const originalDocument = encodeDoc(
      jsonToDoc({ "can-play": { guestbook: { entries: ["persisted"] } } })
    );
    persistedRow.document = originalDocument;
    const { room, storage } = createRoom();
    room.documentLoadCompleted = true;
    const crashStorage = new FakeStorage();
    beforeUpsert = async () => {
      crashStorage.values = new Map(storage.values);
      throw new Error("simulated isolate crash before database commit");
    };
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    try {
      await expect(
        room.restoreFromSnapshot(SMALL_DOCUMENT, { bumpEpoch: true })
      ).rejects.toThrow("Failed to save snapshot");
    } finally {
      console.error = originalError;
    }
    beforeUpsert = null;

    expect(
      errors.some((message) => message.includes("Database save failed"))
    ).toBe(true);
    expect(errors.some((message) => message.includes("Failed for room"))).toBe(
      true
    );

    const restarted = restartRoom(crashStorage);
    await startRoom(restarted);

    expect(restarted.roomState()).toBe("ready");
    expect(docToJson(restarted.document)?.["can-play"]?.guestbook).toEqual({
      entries: ["persisted"],
    });
    expect(persistedRow.document).toBe(originalDocument);
  });

  test("a restart converges after restore commits before the live document changes", async () => {
    const originalDocument = encodeDoc(
      jsonToDoc({ "can-play": { guestbook: { entries: ["before"] } } })
    );
    const replacementDocument = encodeDoc(
      jsonToDoc({ "can-play": { guestbook: { entries: ["after"] } } })
    );
    persistedRow.document = originalDocument;
    const { room, storage } = createRoom();
    room.documentLoadCompleted = true;
    const crashStorage = new FakeStorage();
    afterUpsert = async () => {
      crashStorage.values = new Map(storage.values);
      throw new Error("simulated isolate crash after database commit");
    };
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    try {
      await expect(
        room.restoreFromSnapshot(replacementDocument, { bumpEpoch: true })
      ).rejects.toThrow("Failed to save snapshot");
    } finally {
      console.error = originalError;
      afterUpsert = null;
    }

    const restarted = restartRoom(crashStorage);
    await startRoom(restarted);

    expect(docToJson(restarted.document)?.["can-play"]?.guestbook).toEqual({
      entries: ["after"],
    });
    expect(await restarted.getResetEpoch()).toBe(
      getDocResetEpoch(restarted.document)
    );
    expect(errors.some((message) => message.includes("after database"))).toBe(
      true
    );
  });

  test("a restart converges after compaction commits before the live document changes", async () => {
    const { room, storage } = createRoom();
    room.documentLoadCompleted = true;
    room.attachPersistenceObserver();
    room.document.getMap("play").set("kept", "after compaction");
    const candidate = room.buildCompactedDocument(room.document);
    expect(candidate).not.toBeNull();
    persistedRow.document = candidate.sourceBase64;
    const crashStorage = new FakeStorage();
    afterUpsert = async () => {
      crashStorage.values = new Map(storage.values);
      throw new Error("simulated isolate crash after database commit");
    };

    await expect(
      room.commitCompactedDocument({ compactedDocument: candidate })
    ).rejects.toThrow("simulated isolate crash after database commit");
    afterUpsert = null;

    const restarted = restartRoom(crashStorage);
    await startRoom(restarted);

    expect(restarted.document.getMap("play").get("kept")).toBe(
      "after compaction"
    );
    expect(await restarted.getResetEpoch()).toBe(
      getDocResetEpoch(restarted.document)
    );
  });

  test("post-compaction cleanup failure does not reopen the committed write", async () => {
    const { room } = createRoom();
    room.documentLoadCompleted = true;
    room.attachPersistenceObserver();
    room.document.getMap("play").set("kept", "value");
    const candidate = room.buildCompactedDocument(room.document);
    expect(candidate).not.toBeNull();
    persistedRow.document = candidate.sourceBase64;
    const originalError = console.error;
    console.error = () => {};

    try {
      await expect(
        room.commitCompactedDocument({
          compactedDocument: candidate,
          afterReplace: async () => {
            throw new Error("cleanup unavailable");
          },
        })
      ).resolves.toBe(true);
    } finally {
      console.error = originalError;
    }

    expect(upsertCalls).toHaveLength(1);
    expect(persistedRow.document).toBe(candidate.base64);
  });

  test("an unavailable room consumes an expired save retry", async () => {
    const { room, storage } = createRoom();
    room.documentLoadCompleted = true;
    room.persistenceMode = {
      kind: "transient",
      reason: "database unavailable",
      failedAt: Date.now(),
    };
    storage.values.set("documentSaveRetry", { retryAt: Date.now() - 1 });

    await room.onAlarm();

    expect(storage.values.has("documentSaveRetry")).toBe(false);
    expect(upsertCalls).toEqual([]);
  });

  test("force-save-live cannot bypass quarantine protection", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();
    room.documentLoadCompleted = true;
    await room.circuitBreaker.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });

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

    await expect(room.saveLiveDocument()).resolves.toBe(false);
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  test("the document write helper refuses unhydrated shared-data writes", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();

    await expect(room.saveLiveDocument()).resolves.toBe(false);
    expect(upsertCalls).toEqual([]);
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  test("snapshot restore releases the save lock before returning", async () => {
    const { room } = createRoom();
    room.documentLoadCompleted = true;

    await room.restoreFromSnapshot(SMALL_DOCUMENT, { bumpEpoch: true });

    expect(room.documentMaintenanceInProgress).toBe(false);
  });

  test("snapshot restore releases the save lock when persistence fails", async () => {
    const { room } = createRoom();
    room.documentLoadCompleted = true;
    upsertError = new Error("database unavailable");
    const originalError = console.error;
    console.error = () => {};

    try {
      await expect(
        room.restoreFromSnapshot(SMALL_DOCUMENT, { bumpEpoch: true })
      ).rejects.toThrow("database unavailable");
    } finally {
      console.error = originalError;
    }

    expect(room.documentMaintenanceInProgress).toBe(false);
  });

  test("snapshot restore keeps saves blocked when epoch storage fails after commit", async () => {
    const { room, storage } = createRoom();
    room.documentLoadCompleted = true;
    room.document.getMap("play").set("greeting", "stale live value");
    const originalPut = storage.put.bind(storage);
    let epochStorageAvailable = false;
    storage.put = async (key: string, value: unknown) => {
      if (key === "resetEpoch" && !epochStorageAvailable) {
        throw new Error("epoch storage unavailable");
      }
      await originalPut(key, value);
    };
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    try {
      await expect(
        room.restoreFromSnapshot(SMALL_DOCUMENT, { bumpEpoch: true })
      ).rejects.toThrow("epoch storage unavailable");
    } finally {
      console.error = originalError;
    }

    expect(
      errors.some((line) => line.includes("epoch storage unavailable"))
    ).toBe(true);
    expect(upsertCalls).toHaveLength(1);
    const committedDocument = persistedRow.document;
    expect(room.documentMaintenanceInProgress).toBe(true);

    await room.onSave();

    expect(upsertCalls).toHaveLength(1);
    expect(persistedRow.document).toBe(committedDocument);

    upsertError = new Error("retry database unavailable");
    console.error = () => {};
    try {
      await expect(
        room.restoreFromSnapshot(SMALL_DOCUMENT, { bumpEpoch: true })
      ).rejects.toThrow("retry database unavailable");
    } finally {
      console.error = originalError;
      upsertError = null;
    }

    expect(room.documentMaintenanceInProgress).toBe(true);
    expect(persistedRow.document).toBe(committedDocument);

    epochStorageAvailable = true;
    await room.restoreFromSnapshot(SMALL_DOCUMENT, { bumpEpoch: true });

    expect(room.documentMaintenanceInProgress).toBe(false);
    expect(room.document.getMap("play").get("greeting")).toBe("hello");
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
    room.documentLoadCompleted = true;

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
    expect(room.documentMaintenanceInProgress).toBe(false);
  });

  test("a hard reset releases the save lock when persistence fails", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();
    room.documentLoadCompleted = true;
    Y.applyUpdate(
      room.document,
      new Uint8Array(Buffer.from(SMALL_DOCUMENT, "base64"))
    );
    upsertError = new Error("database unavailable");
    const originalError = console.error;
    console.error = () => {};

    try {
      await expect(room.performHardReset()).rejects.toThrow(
        "database unavailable"
      );
    } finally {
      console.error = originalError;
    }

    expect(room.documentMaintenanceInProgress).toBe(false);
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
