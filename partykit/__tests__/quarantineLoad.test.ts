// ABOUTME: Drives the real PartyServer load path to verify quarantine behavior end to end.
// ABOUTME: Asserts hydration is skipped, persisted rows survive, and alarms stop being scheduled.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as Y from "yjs";
import { Buffer } from "node:buffer";

// PartyServer imports Cloudflare-only modules and constructs a Supabase client at
// module scope. Stub both so the real class can be exercised under bun test.
class FakeDurableObject {
  constructor(
    public ctx: unknown,
    public env: unknown,
  ) {}
}

mock.module("cloudflare:workers", () => ({
  env: {},
  DurableObject: FakeDurableObject,
  WorkerEntrypoint: class {},
}));

// A single mutable row stands in for the room's `documents` record. Tests assert
// against `persistedRow.document` to prove quarantine never overwrites real data.
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

// Minimal in-memory stand-ins for Durable Object storage and the YServer base.
class FakeStorage {
  values = new Map<string, unknown>();
  alarm: number | null = null;
  deleteAlarmCalls = 0;
  setAlarmCalls: number[] = [];
  // Ordered log of awaited writes, used to prove the load-attempt counter is
  // committed before the risky hydration work runs.
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

// `name` is a readonly accessor on the server base class, so the room fields are
// installed as own properties rather than assigned.
function buildRoom(storage: FakeStorage, name: string) {
  return Object.create(PartyServer.prototype, {
    ctx: { value: { storage }, writable: true },
    name: { value: name, writable: true },
    document: { value: new Y.Doc(), writable: true },
    persistenceMode: { value: { kind: "available" }, writable: true },
    quarantine: { value: null, writable: true },
    isSkippingSave: { value: false, writable: true },
    lastKnownDocumentBytes: { value: 0, writable: true },
    hasWarnedDocumentSize: { value: false, writable: true },
    cachedSubscribers: { value: null, writable: true },
    cachedSharedRefs: { value: null, writable: true },
    cachedSharedPerms: { value: null, writable: true },
    cachedResetEpoch: { value: undefined, writable: true },
    compactionAutosaveSnapshot: { value: null, writable: true },
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

// Builds a base64 Y.Doc payload of at least `targetBytes`, so the size gate sees a
// document that is both realistic and genuinely oversized.
function buildDocumentBase64(targetBytes: number): string {
  const doc = new Y.Doc();
  const map = doc.getMap("play");
  let index = 0;
  let encoded = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  while (encoded.length < targetBytes) {
    map.set(`key-${index}`, "x".repeat(4096));
    index += 1;
    encoded = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  }
  return encoded;
}

function docIsEmpty(doc: Y.Doc): boolean {
  return Object.keys(doc.getMap("play").toJSON()).length === 0;
}

const SMALL_DOCUMENT = (() => {
  const doc = new Y.Doc();
  doc.getMap("play").set("greeting", "hello");
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
})();

const OVERSIZED_DOCUMENT = buildDocumentBase64(1024 * 1024 * 7);

beforeEach(() => {
  persistedRow.document = null;
  upsertCalls = [];
});

describe("size gate", () => {
  test("an oversized document is never hydrated and the room is quarantined", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room, storage } = createRoom();

    await room.onLoad();

    expect(room.isQuarantined()).toBe(true);
    expect(room.getQuarantineState().reason).toBe("document-size");
    expect(room.getQuarantineState().documentBytes).toBe(
      OVERSIZED_DOCUMENT.length,
    );
    // The live doc was never populated: hydration did not run.
    expect(docIsEmpty(room.document)).toBe(true);
    // Quarantine is durable so the next start short-circuits before hydrating.
    expect(storage.values.get("quarantine")).toBeDefined();
  });

  test("a below-threshold room loads normally and is left alone", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();

    await room.onLoad();

    expect(room.isQuarantined()).toBe(false);
    expect(room.document.getMap("play").get("greeting")).toBe("hello");
    expect(room.isPersistenceAvailable()).toBe(true);
    // The load-attempt counter is cleared after a healthy hydration.
    expect(storage.values.get("quarantineLoadAttempts")).toBeUndefined();
  });

  test("an empty room stays healthy", async () => {
    const { room } = createRoom();

    await room.onLoad();

    expect(room.isQuarantined()).toBe(false);
    expect(room.isPersistenceAvailable()).toBe(true);
  });
});

describe("crash-loop breaker", () => {
  test("the load-attempt counter is durable before hydration begins", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();

    await room.onLoad();

    // The counter is the FIRST awaited storage write of the load. An isolate that
    // OOMs later in the load therefore leaves the increment committed, which is
    // what lets the third start trip the breaker.
    expect(storage.writeLog[0]).toEqual({
      key: "quarantineLoadAttempts",
      value: 1,
    });
    // A completed load clears the counter again.
    expect(storage.values.get("quarantineLoadAttempts")).toBeUndefined();
  });

  test("three failed starts quarantine the room without touching the document", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    // Three prior attempts started and none reported completion.
    storage.values.set("quarantineLoadAttempts", 3);

    await room.onLoad();

    expect(room.isQuarantined()).toBe(true);
    expect(room.getQuarantineState().reason).toBe("crash-loop");
    expect(docIsEmpty(room.document)).toBe(true);
    // The document is untouched in the database.
    expect(persistedRow.document).toBe(SMALL_DOCUMENT);
  });

  // A Supabase outage must not rewind evidence of real hydration crashes,
  // otherwise a sub-threshold lethal document can crash-loop forever without the
  // counter ever reaching the limit.
  test("a Supabase outage rolls back only its own attempt", async () => {
    const { room, storage } = createRoom();
    // Two earlier starts reached hydration and died there.
    storage.values.set("quarantineLoadAttempts", 2);
    // This start cannot even read the document.
    persistedRow.document = null;
    const originalFrom = supabaseStub.from;
    (supabaseStub as any).from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: { message: "connection timeout" },
          }),
        }),
      }),
    });

    try {
      await room.onLoad();
    } finally {
      (supabaseStub as any).from = originalFrom;
    }

    expect(room.isQuarantined()).toBe(false);
    // Back to the two genuine hydration failures, not reset to zero.
    expect(storage.values.get("quarantineLoadAttempts")).toBe(2);
    expect(room.isPersistenceAvailable()).toBe(false);
  });

  test("two failed starts still allow a hydration attempt", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    storage.values.set("quarantineLoadAttempts", 2);

    await room.onLoad();

    expect(room.isQuarantined()).toBe(false);
    expect(room.document.getMap("play").get("greeting")).toBe("hello");
  });
});

describe("quarantine semantics", () => {
  test("a quarantined room runs in the existing transient mode", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room } = createRoom();

    await room.onLoad();

    // Transient mode is what lets visitors connect and sync live while nothing
    // persists, and it is what admin write endpoints already refuse against.
    expect(room.isPersistenceAvailable()).toBe(false);
    expect(room.getPersistenceUnavailableResponse()?.status).toBe(503);
  });

  test("autosave cannot overwrite the persisted document while quarantined", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room } = createRoom();

    await room.onLoad();
    expect(docIsEmpty(room.document)).toBe(true);

    // onSave is the autosave entry point. Running it against the empty live doc
    // is exactly the scenario that would destroy the persisted data.
    await room.onSave();

    expect(upsertCalls).toEqual([]);
    expect(persistedRow.document).toBe(OVERSIZED_DOCUMENT);
  });

  test("the document write helper refuses to run while quarantined", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room } = createRoom();

    await room.onLoad();

    // Direct call bypassing the autosave guards: the chokepoint itself must throw
    // rather than silently persisting an unhydrated document.
    await expect(room.saveDocumentBase64("overwrite-me")).rejects.toThrow(
      /Refusing to persist document for quarantined room/,
    );
    expect(persistedRow.document).toBe(OVERSIZED_DOCUMENT);
  });

  // Compaction is the other route to saveDocumentBase64. Its entry points all
  // gate on persistence availability, which quarantine turns off, so the room
  // never rebuilds and rewrites a document it never loaded.
  test("empty-room compaction does not run while quarantined", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room } = createRoom();
    await room.onLoad();

    await room.compactEmptyRoomDocument();

    expect(upsertCalls).toEqual([]);
    expect(persistedRow.document).toBe(OVERSIZED_DOCUMENT);
  });

  // A hard reset derives the new document from the empty live doc, or falls back
  // to re-reading the persisted one. Both destroy or re-crash a quarantined room.
  test("a hard reset refuses to run while quarantined", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room } = createRoom();
    await room.onLoad();

    await expect(room.performHardReset()).rejects.toThrow(
      /Refusing to hard reset for quarantined room/
    );
    expect(upsertCalls).toEqual([]);
    expect(persistedRow.document).toBe(OVERSIZED_DOCUMENT);
  });

  // force-reload-live reaches restoreFromSnapshot without going through
  // saveDocumentBase64, so the guard has to live on the restore itself.
  test("restoring a snapshot refuses by default while quarantined", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room } = createRoom();
    await room.onLoad();

    await expect(
      room.restoreFromSnapshot(OVERSIZED_DOCUMENT, { bumpEpoch: true })
    ).rejects.toThrow(/Refusing to restore a snapshot for quarantined room/);
    expect(upsertCalls).toEqual([]);
    expect(persistedRow.document).toBe(OVERSIZED_DOCUMENT);
  });

  // Replacing the document with a repaired one is the sanctioned recovery path,
  // so it opts in explicitly rather than being blocked with everything else.
  test("an explicit repair restore is allowed and replaces the document", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room } = createRoom();
    await room.onLoad();

    await room.restoreFromSnapshot(SMALL_DOCUMENT, {
      bumpEpoch: true,
      allowQuarantined: true,
    });

    expect(upsertCalls.length).toBe(1);
    expect(persistedRow.document).not.toBe(OVERSIZED_DOCUMENT);
  });

  test("a restart re-enters quarantine without reading the document", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room, storage } = createRoom();
    await room.onLoad();

    // Second start, same storage: reuse the persisted quarantine record.
    const restarted = restartRoom(storage);

    await restarted.onLoad();

    expect(restarted.isQuarantined()).toBe(true);
    expect(docIsEmpty(restarted.document)).toBe(true);
    expect(restarted.isPersistenceAvailable()).toBe(false);
  });
});

describe("alarms", () => {
  test("entering quarantine cancels any pending alarm", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room, storage } = createRoom();
    storage.alarm = Date.now() + 60_000;

    await room.onLoad();

    expect(storage.alarm).toBeNull();
    expect(storage.deleteAlarmCalls).toBeGreaterThan(0);
  });

  test("a quarantined room never schedules another alarm", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room, storage } = createRoom();
    await room.onLoad();
    storage.setAlarmCalls = [];

    // Bridge leases would normally force a prune alarm to be scheduled.
    await room.setSubscribers([
      { consumerRoomId: "other-room", elementIds: ["a"] },
    ]);
    await room.scheduleNextAlarm();

    expect(storage.setAlarmCalls).toEqual([]);
    expect(storage.alarm).toBeNull();
  });

  test("a firing alarm on a quarantined room does no work and reschedules nothing", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room, storage } = createRoom();
    await room.onLoad();
    storage.setAlarmCalls = [];

    await room.onAlarm();

    expect(storage.setAlarmCalls).toEqual([]);
    expect(storage.alarm).toBeNull();
    expect(persistedRow.document).toBe(OVERSIZED_DOCUMENT);
  });

  // onStart runs after onLoad and calls ensureAlarmScheduled. This is the exact
  // path the crash loop travels, so a quarantined room must come out of it with
  // no alarm pending.
  test("the post-load startup path does not re-arm the alarm", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room, storage } = createRoom();
    await room.onLoad();

    await room.setSubscribers([
      { consumerRoomId: "other-room", elementIds: ["a"] },
    ]);
    storage.setAlarmCalls = [];
    storage.alarm = Date.now() + 60_000;

    await room.ensureAlarmScheduled();

    expect(storage.setAlarmCalls).toEqual([]);
    expect(storage.alarm).toBeNull();
  });

  test("a healthy room still schedules alarms for bridge leases", async () => {
    persistedRow.document = SMALL_DOCUMENT;
    const { room, storage } = createRoom();
    await room.onLoad();

    await room.setSubscribers([
      { consumerRoomId: "other-room", elementIds: ["a"] },
    ]);
    await room.scheduleNextAlarm();

    expect(storage.setAlarmCalls.length).toBe(1);
  });
});

describe("quarantine-clear", () => {
  test("clearing quarantine lets the next load hydrate again", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room, storage } = createRoom();
    await room.onLoad();
    expect(room.isQuarantined()).toBe(true);

    await room.clearQuarantine();

    expect(room.isQuarantined()).toBe(false);
    expect(storage.values.get("quarantine")).toBeUndefined();
    expect(storage.values.get("quarantineLoadAttempts")).toBeUndefined();

    // Operator shrank the document, then restarted the room.
    persistedRow.document = SMALL_DOCUMENT;
    const restarted = restartRoom(storage);

    await restarted.onLoad();

    expect(restarted.isQuarantined()).toBe(false);
    expect(restarted.document.getMap("play").get("greeting")).toBe("hello");
  });

  test("clearing quarantine on a still-oversized room re-quarantines it", async () => {
    persistedRow.document = OVERSIZED_DOCUMENT;
    const { room, storage } = createRoom();
    await room.onLoad();
    await room.clearQuarantine();

    const restarted = restartRoom(storage);

    await restarted.onLoad();

    expect(restarted.isQuarantined()).toBe(true);
    expect(restarted.getQuarantineState().reason).toBe("document-size");
  });
});
