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

mock.module("cloudflare:workers", () => ({
  env: {},
  DurableObject: FakeDurableObject,
  WorkerEntrypoint: class {},
}));

// A single mutable row stands in for the room's `documents` record. Tests assert
// against `persistedRow.document` to prove risky paths never overwrite real data.
type PersistedRow = { document: string | null };
const persistedRow: PersistedRow = { document: null };
let upsertCalls: Array<{ name: string; document: string }> = [];

const supabaseStub = {
  from() {
    return {
      select() {
        return {
          eq() {
            return {
              maybeSingle: async () => ({
                data:
                  persistedRow.document === null
                    ? null
                    : { document: persistedRow.document },
                error: null,
              }),
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
  return Object.create(PartyServer.prototype, {
    ctx: { value: { storage }, writable: true },
    name: { value: name, writable: true },
    document: { value: doc ?? new Y.Doc(), writable: true },
    persistenceMode: { value: { kind: "available" }, writable: true },
    quarantine: { value: null, writable: true },
    compactionTooLargeBytes: { value: null, writable: true },
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

  // Below the high threshold the room keeps trying: most load failures are
  // environmental and clear on their own.
  test("prior load failures do not stop hydration below the threshold", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 5);

    await room.onLoad();

    expect(room.isQuarantined()).toBe(false);
    expect(room.document.getMap("play").get("greeting")).toBe("hello");
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
    storage.values.set("failureRetryAfter", Date.now() + 60_000);

    await room.onLoad();

    expect(storage.values.get("quarantineLoadAttempts")).toBeUndefined();
    expect(storage.values.get("failureRetryAfter")).toBeUndefined();
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

    const retryAfter = storage.values.get("failureRetryAfter") as number;
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
      delays.push((storage.values.get("failureRetryAfter") as number) - before);
    }

    expect(delays[0]).toBeLessThan(delays[1]);
    expect(delays[1]).toBeLessThan(delays[2]);
  });

  test("work resumes once the backoff has elapsed", async () => {
    const { room, storage } = createRoom();
    storage.values.set("alarmFailureAttempts", 1);
    // The backoff window has already passed.
    storage.values.set("failureRetryAfter", Date.now() - 1000);

    await room.onAlarm();

    // The alarm ran its work and cleared the failure history.
    expect(storage.values.get("alarmFailureAttempts")).toBeUndefined();
    expect(storage.values.get("failureRetryAfter")).toBeUndefined();
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
    storage.values.set("failureRetryAfter", Date.now() + 1000);
    await room.enterQuarantine({
      reason: "repeated-failures",
      detail: "alarm work failed 8 times in a row",
      failureKind: "alarm",
      failureCount: 8,
    });

    await room.clearQuarantine();

    expect(storage.values.get("alarmFailureAttempts")).toBeUndefined();
    expect(storage.values.get("quarantineLoadAttempts")).toBeUndefined();
    expect(storage.values.get("failureRetryAfter")).toBeUndefined();
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
