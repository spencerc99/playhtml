// ABOUTME: Drives the real PartyServer load and alarm paths to verify breaker behavior.
// ABOUTME: Asserts oversized rooms still load, compaction is skipped, and backoff self-heals.
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

mock.module("cloudflare:workers", () => ({
  env: { QUARANTINE_CONTROL: quarantineKvStub },
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

const supabaseStub = {
  from() {
    return {
      select() {
        return {
          eq() {
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
    quarantine: { value: null, writable: true },
    compactionTooLargeBytes: { value: null, writable: true },
    loadDeferredUntil: { value: null, writable: true },
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

// Models a Durable Object restart: a fresh instance over the same storage.
function restartRoom(storage: FakeStorage, name = "example-room") {
  return buildRoom(storage, name);
}

// Builds a Y.Doc whose encoded form is at least `targetBytes`, so size checks see
// a realistic document rather than a synthetic string.
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
  kvStore.clear();
  kvFailure = null;
});

describe("load path", () => {
  // The central correction: rooms in the 6-8MB band load successfully in
  // production, so size must never block hydration.
  test("a large document still loads and the room stays normal", async () => {
    persistedRow.document = COMPACT_LETHAL_DOCUMENT;
    const { room } = createRoom();

    await room.onLoad();

    expect(room.isQuarantined()).toBe(false);
    expect(room.isPersistenceAvailable()).toBe(true);
    expect(docIsEmpty(room.document)).toBe(false);
  });

  test("a small document loads normally", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();

    await room.onLoad();

    expect(room.isQuarantined()).toBe(false);
    expect(room.document.getMap("play").get("greeting")).toBe("hello");
    expect(storage.values.get("quarantineLoadAttempts")).toBeUndefined();
  });

  test("the load counter is committed before hydration and cleared after", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();

    await room.onLoad();

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

    await room.onLoad();

    // Supabase was never queried, and nothing was hydrated.
    expect(documentReadCount).toBe(0);
    expect(docIsEmpty(room.document)).toBe(true);
    expect(room.isLoadDeferred()).toBe(true);
    // A deferred room is NOT quarantined: no transient mode, no ephemeral service.
    expect(room.isQuarantined()).toBe(false);
  });

  test("the first inferred load failure waits on the one-minute rung", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 1);
    const before = Date.now();

    await room.onLoad();

    const retryAfter = storage.values.get("loadRetryAfter") as number;
    expect(retryAfter).toBeGreaterThanOrEqual(before + 60_000);
    expect(retryAfter).toBeLessThanOrEqual(before + 61_000);
    expect(documentReadCount).toBe(0);
    expect(room.isLoadDeferred()).toBe(true);
  });

  test("a deferred room answers requests with 503 and Retry-After", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 2);
    storage.values.set("loadRetryAfter", Date.now() + 90_000);
    await room.onLoad();

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
    await room.onLoad();

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
    await room.onLoad();

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
    await room.onLoad();

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
    expect(room.isQuarantined()).toBe(true);
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
    await room.onLoad();

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

    await room.onLoad();

    // The new deadline was committed while the read count was still zero.
    expect(deadlineWrites).toEqual([0]);
    expect(room.isLoadDeferred()).toBe(false);
    expect(documentReadCount).toBe(1);
    expect(room.document.getMap("play").get("greeting")).toBe("hello");
  });

  test("a first-time failure is not deferred, so healthy rooms are unaffected", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();

    await room.onLoad();

    expect(room.isLoadDeferred()).toBe(false);
    expect(documentReadCount).toBe(1);
  });

  test("eight consecutive load failures quarantine as a last resort", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 8);

    await room.onLoad();

    expect(room.isQuarantined()).toBe(true);
    expect(room.getQuarantineState().reason).toBe("repeated-failures");
    expect(docIsEmpty(room.document)).toBe(true);
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  test("a successful load clears failure history and pending backoff", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 4);
    // Already past the deadline, so this start is the one allowed attempt.
    storage.values.set("loadRetryAfter", Date.now() - 1000);

    await room.onLoad();

    expect(storage.values.get("quarantineLoadAttempts")).toBeUndefined();
    expect(storage.values.get("loadRetryAfter")).toBeUndefined();
  });
});

describe("in-DO compaction size gate", () => {
  test("an oversized document is not compacted and the room stays normal", async () => {
    persistedRow.document = COMPACT_LETHAL_DOCUMENT;
    const storage = new FakeStorage();
    const room = buildRoom(storage, "example-room", COMPACT_LETHAL_DOC);
    await room.setEmptyRoomCompactAfter(Date.now() - 1000);

    await room.compactEmptyRoomDocument();

    // Persisted data untouched, and compaction is parked so the alarm stops
    // retrying doomed work.
    expect(upsertCalls).toEqual([]);
    expect(persistedRow.document).toBe(COMPACT_LETHAL_DOCUMENT);
    expect(await room.getCompactionParkedBytes()).toBeGreaterThan(0);
    expect(storage.values.get("emptyRoomCompactAfter")).toBeUndefined();
    // Critically, this is NOT a quarantine.
    expect(room.isQuarantined()).toBe(false);
    expect(room.isPersistenceAvailable()).toBe(true);
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

    await room.compactEmptyRoomDocument();

    // Not parked, and the compacted document was persisted.
    expect(await room.getCompactionParkedBytes()).toBeNull();
    expect(upsertCalls.length).toBe(1);
    expect(persistedRow.document).not.toBe("");
  });

  // After an external compaction the room should resume compacting on its own,
  // without an operator having to unpark it by hand.
  test("parking clears so a repaired room compacts again", async () => {
    const storage = new FakeStorage();
    const room = buildRoom(storage, "example-room", COMPACT_LETHAL_DOC);
    persistedRow.document = COMPACT_LETHAL_DOCUMENT;
    await room.compactEmptyRoomDocument();
    expect(await room.getCompactionParkedBytes()).toBeGreaterThan(0);

    await room.clearCompactionPark();

    expect(await room.getCompactionParkedBytes()).toBeNull();
  });

  // A later disconnect would otherwise re-schedule the compaction that was just
  // parked, putting the room straight back into the crash loop.
  test("a parked room does not reschedule compaction on disconnect", async () => {
    const storage = new FakeStorage();
    const room = buildRoom(storage, "example-room", COMPACT_LETHAL_DOC);
    persistedRow.document = COMPACT_LETHAL_DOCUMENT;
    await room.compactEmptyRoomDocument();
    expect(await room.getCompactionParkedBytes()).toBeGreaterThan(0);
    storage.setAlarmCalls = [];

    // The last visitor leaves again.
    await room.scheduleEmptyRoomCompaction();

    expect(storage.values.get("emptyRoomCompactAfter")).toBeUndefined();
    expect(storage.setAlarmCalls).toEqual([]);
  });

  test("an unparked room still schedules compaction on disconnect", async () => {
    const { room, storage } = createRoom();

    await room.scheduleEmptyRoomCompaction();

    expect(storage.values.get("emptyRoomCompactAfter")).toBeGreaterThan(0);
  });

  test("parking is reported once, not on every attempt", async () => {
    const storage = new FakeStorage();
    const room = buildRoom(storage, "example-room", COMPACT_LETHAL_DOC);
    persistedRow.document = COMPACT_LETHAL_DOCUMENT;

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (message: unknown) => {
      errors.push(String(message));
    };
    try {
      await room.compactEmptyRoomDocument();
      await room.compactEmptyRoomDocument();
      await room.compactEmptyRoomDocument();
    } finally {
      console.error = originalError;
    }

    const parkLogs = errors.filter((line) =>
      line.includes("REQUIRES EXTERNAL COMPACTION")
    );
    expect(parkLogs.length).toBe(1);
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
    storage.values.set("emptyRoomCompactAfter", Date.now() - 1);
    room.compactEmptyRoomDocument = async () => {
      throw new Error("simulated alarm failure");
    };
    const before = Date.now();

    await expect(room.onAlarm()).rejects.toThrow("simulated alarm failure");

    const retryAfter = storage.values.get("alarmRetryAfter") as number;
    expect(retryAfter).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(storage.values.get("alarmFailureAttempts")).toBe(2);
  });

  test("eight consecutive alarm failures quarantine as a last resort", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("alarmFailureAttempts", 8);

    await room.onAlarm();

    expect(room.isQuarantined()).toBe(true);
    expect(room.getQuarantineState().reason).toBe("repeated-failures");
    expect(room.getQuarantineState().failureKind).toBe("alarm");
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  test("a quarantined room does no alarm work and parks the alarm", async () => {
    const { room, storage } = createRoom();
    await room.enterQuarantine({
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

describe("separate retry ladders", () => {
  // A shared deadline meant a healthy load erased the alarm's backoff, letting
  // compaction start crash-looping again.
  test("a successful load leaves the alarm backoff intact", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    const alarmDeadline = Date.now() + 30 * 60_000;
    storage.values.set("alarmFailureAttempts", 3);
    storage.values.set("alarmRetryAfter", alarmDeadline);

    await room.onLoad();

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

    const body = await room.getQuarantineStatusBody();

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

    await room.applyExternalQuarantineFlag();

    expect(room.isQuarantined()).toBe(true);
    expect(room.getQuarantineState().reason).toBe("manual");
    expect(room.getQuarantineState().detail).toBe("microcosmos incident");
    expect(documentReadCount).toBe(0);

    // And the subsequent load never hydrates either.
    await room.onLoad();
    expect(documentReadCount).toBe(0);
    expect(docIsEmpty(room.document)).toBe(true);
  });

  test("setting quarantine writes the flag that survives a crashing room", async () => {
    const { room } = createRoom();

    await room.enterQuarantine({
      reason: "manual",
      detail: "operator note",
      failureKind: null,
      failureCount: 0,
    });

    expect(kvStore.get("quarantine:example-room")).toBe("operator note");
  });

  test("clearing quarantine removes the external flag", async () => {
    const { room } = createRoom();
    await room.enterQuarantine({
      reason: "manual",
      detail: "operator note",
      failureKind: null,
      failureCount: 0,
    });

    await room.clearQuarantine();

    expect(kvStore.has("quarantine:example-room")).toBe(false);
  });

  test("set and clear round-trip through KV across restarts", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    await room.enterQuarantine({
      reason: "manual",
      detail: "operator note",
      failureKind: null,
      failureCount: 0,
    });

    // A brand new isolate with EMPTY durable storage still sees the flag.
    const freshStorage = new FakeStorage();
    const restarted = buildRoom(freshStorage, "example-room");
    await restarted.applyExternalQuarantineFlag();
    expect(restarted.isQuarantined()).toBe(true);

    await restarted.clearQuarantine();

    const afterClear = buildRoom(new FakeStorage(), "example-room");
    await afterClear.applyExternalQuarantineFlag();
    expect(afterClear.isQuarantined()).toBe(false);
  });

  // Manual quarantine is an operator tool, not a correctness gate: a KV outage
  // must never take rooms offline.
  test("a KV read failure fails open", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();
    kvFailure = new Error("kv unavailable");

    await room.applyExternalQuarantineFlag();
    await room.onLoad();

    expect(room.isQuarantined()).toBe(false);
    expect(room.document.getMap("play").get("greeting")).toBe("hello");
  });
});

describe("manual quarantine", () => {
  test("an operator can quarantine a healthy room and clear it again", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    await room.onLoad();
    expect(room.isQuarantined()).toBe(false);

    await room.enterQuarantine({
      reason: "manual",
      detail: "investigating runaway growth",
      failureKind: null,
      failureCount: 0,
    });

    expect(room.isQuarantined()).toBe(true);
    expect(room.getQuarantineState().detail).toBe(
      "investigating runaway growth"
    );
    // Manual quarantine still suppresses persistence.
    expect(room.isPersistenceAvailable()).toBe(false);
    expect(storage.alarm).toBeNull();

    await room.clearQuarantine();
    expect(room.isQuarantined()).toBe(false);
  });

  test("clearing quarantine also clears the failure history behind it", async () => {
    const { room, storage } = createRoom();
    storage.values.set("alarmFailureAttempts", 8);
    storage.values.set("quarantineLoadAttempts", 3);
    storage.values.set("loadRetryAfter", Date.now() + 1000);
    storage.values.set("alarmRetryAfter", Date.now() + 1000);
    await room.enterQuarantine({
      reason: "repeated-failures",
      detail: "alarm work failed 8 times in a row",
      failureKind: "alarm",
      failureCount: 8,
    });

    await room.clearQuarantine();

    expect(storage.values.get("alarmFailureAttempts")).toBeUndefined();
    expect(storage.values.get("quarantineLoadAttempts")).toBeUndefined();
    expect(storage.values.get("loadRetryAfter")).toBeUndefined();
    expect(storage.values.get("alarmRetryAfter")).toBeUndefined();
  });

  test("a quarantined room resumes quarantine on restart without hydrating", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    await room.enterQuarantine({
      reason: "manual",
      detail: "operator",
      failureKind: null,
      failureCount: 0,
    });

    const restarted = restartRoom(storage);
    await restarted.onLoad();

    expect(restarted.isQuarantined()).toBe(true);
    expect(docIsEmpty(restarted.document)).toBe(true);
    expect(restarted.isPersistenceAvailable()).toBe(false);
  });
});

describe("quarantine data safety", () => {
  test("autosave cannot overwrite the persisted document while quarantined", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room } = createRoom();
    await room.enterQuarantine({
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
    await room.enterQuarantine({
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
    await room.enterQuarantine({
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

  test("a hard reset parks an oversized room before rebuilding or writing", async () => {
    persistedRow.document = COMPACT_LETHAL_DOCUMENT;
    const storage = new FakeStorage();
    const room = buildRoom(storage, "example-room", COMPACT_LETHAL_DOC);

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    let response: Response;
    try {
      response = await room.onRequest(
        new Request(
          "https://example.com/parties/main/example-room/admin/hard-reset",
          { method: "POST" }
        )
      );
    } finally {
      console.error = originalError;
    }

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "External compaction required",
      roomId: "example-room",
    });
    expect(upsertCalls).toEqual([]);
    expect(persistedRow.document).toBe(COMPACT_LETHAL_DOCUMENT);
    expect(await room.getCompactionParkedBytes()).toBeGreaterThan(0);
    expect(
      errors.some((line) => line.includes("ExternalCompactionRequiredError"))
    ).toBe(true);
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
      await room.onLoad();
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
    await room.enterQuarantine({
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
    await room.enterQuarantine({
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
