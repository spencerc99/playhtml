// ABOUTME: Verifies the Durable Object log of updates accepted since the last checkpoint.
// ABOUTME: Covers atomic appends, large updates, restarts, orphans, and hydration decisions.
import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import {
  WRITE_BEHIND_META_KEY,
  WRITE_BEHIND_PART_BYTES,
  appendLogEntry,
  createEmptyLogMeta,
  getLogCheckpointDueAt,
  getLogHydrationDecision,
  getWriteBehindEntryKey,
  orphanLog,
  readBaseStateVector,
  readLogEntries,
  readLogMeta,
  readOrphan,
  resetLog,
  shouldCheckpointLog,
  type WriteBehindLogMeta,
} from "../writeBehindLog";

class MemoryStorage {
  values = new Map<string, unknown>();
  puts: Array<string[]> = [];

  async get(key: string | string[]): Promise<any> {
    if (Array.isArray(key)) {
      return new Map(
        key.filter((k) => this.values.has(k)).map((k) => [k, this.values.get(k)])
      );
    }
    return this.values.get(key);
  }
  async put(entries: Record<string, unknown>): Promise<void> {
    this.puts.push(Object.keys(entries));
    for (const [key, value] of Object.entries(entries)) this.values.set(key, value);
  }
  async delete(keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) if (this.values.delete(key)) deleted += 1;
    return deleted;
  }
}

function updateSetting(doc: Y.Doc, key: string, value: unknown): Uint8Array {
  const before = Y.encodeStateVector(doc);
  doc.getMap("play").set(key, value);
  return Y.encodeStateAsUpdate(doc, before);
}

describe("write-behind log storage", () => {
  it("appends each update in one put and reads the updates back in order", async () => {
    const storage = new MemoryStorage();
    const source = new Y.Doc();
    let meta = createEmptyLogMeta("v1");
    meta = await appendLogEntry(storage, meta, updateSetting(source, "a", 1), 1000);
    meta = await appendLogEntry(storage, meta, updateSetting(source, "b", 2), 2000);

    expect(storage.puts).toEqual([
      [WRITE_BEHIND_META_KEY, getWriteBehindEntryKey(0)],
      [WRITE_BEHIND_META_KEY, getWriteBehindEntryKey(1)],
    ]);
    expect(await readLogMeta(storage)).toEqual(meta);
    expect(meta.firstEntryAt).toBe(1000);

    const replica = new Y.Doc();
    for (const update of await readLogEntries(storage, meta)) {
      Y.applyUpdate(replica, update);
    }
    expect(replica.getMap("play").toJSON()).toEqual({ a: 1, b: 2 });
  });

  it("splits an update larger than one storage value and joins it on read", async () => {
    const storage = new MemoryStorage();
    const source = new Y.Doc();
    const update = updateSetting(
      source,
      "big",
      "x".repeat(WRITE_BEHIND_PART_BYTES * 2 + 17)
    );
    const meta = await appendLogEntry(storage, createEmptyLogMeta(null), update, 1);

    expect(meta.nextSeq - meta.firstSeq).toBe(3);
    expect(storage.puts).toHaveLength(1);
    const [read] = await readLogEntries(storage, meta);
    expect(read).toEqual(update);
  });

  it("refuses to read a log with a missing entry instead of skipping it", async () => {
    const storage = new MemoryStorage();
    const source = new Y.Doc();
    let meta = createEmptyLogMeta("v1");
    meta = await appendLogEntry(storage, meta, updateSetting(source, "a", 1), 1);
    meta = await appendLogEntry(storage, meta, updateSetting(source, "b", 2), 2);
    storage.values.delete(getWriteBehindEntryKey(0));

    await expect(readLogEntries(storage, meta)).rejects.toThrow(
      "Write-behind log entry writeBehind:entry:0 is missing or damaged"
    );
  });

  it("treats a damaged meta record as an error, not an empty log", async () => {
    const storage = new MemoryStorage();
    storage.values.set(WRITE_BEHIND_META_KEY, { baseVersion: 3 });

    await expect(readLogMeta(storage)).rejects.toThrow(
      "Unreadable write-behind log meta"
    );
  });

  it("restarts on a new base, keeps counting, and deletes the old entries", async () => {
    const storage = new MemoryStorage();
    const source = new Y.Doc();
    let meta = createEmptyLogMeta("v1");
    meta = await appendLogEntry(storage, meta, updateSetting(source, "a", 1), 1);
    const stateVector = Y.encodeStateVector(source);

    const next = await resetLog(storage, meta, "v2", stateVector);

    expect(next).toMatchObject({
      baseVersion: "v2",
      firstSeq: 1,
      nextSeq: 1,
      bytes: 0,
      firstEntryAt: null,
    });
    expect(storage.values.has(getWriteBehindEntryKey(0))).toBe(false);
    expect(await readBaseStateVector(storage, next)).toEqual(
      Y.decodeStateVector(stateVector)
    );
  });

  it("keeps the entries of an orphaned log and only the newest orphan", async () => {
    const storage = new MemoryStorage();
    const source = new Y.Doc();
    let meta = createEmptyLogMeta("v1");
    meta = await appendLogEntry(storage, meta, updateSetting(source, "a", 1), 1);
    await orphanLog(storage, meta, "v9", 50);
    meta = await resetLog(storage, meta, "v9", new Uint8Array([0]), {
      keepPreviousEntries: true,
    });
    expect(storage.values.has(getWriteBehindEntryKey(0))).toBe(true);

    meta = await appendLogEntry(storage, meta, updateSetting(source, "b", 2), 60);
    const orphan = await orphanLog(storage, meta, "v10", 70);

    expect(orphan).toEqual({
      baseVersion: "v9",
      databaseVersion: "v10",
      firstSeq: 1,
      nextSeq: 2,
      bytes: meta.bytes,
      orphanedAt: 70,
    });
    expect(await readOrphan(storage)).toEqual(orphan);
    expect(storage.values.has(getWriteBehindEntryKey(0))).toBe(false);
    expect(storage.values.has(getWriteBehindEntryKey(1))).toBe(true);
  });
});

describe("write-behind hydration decision", () => {
  const withEntries: WriteBehindLogMeta = {
    ...createEmptyLogMeta("v1"),
    nextSeq: 2,
    bytes: 10,
    firstEntryAt: 1,
  };
  const base = new Map([[7, 10]]);

  it("replays a log whose base is the stored version", () => {
    expect(
      getLogHydrationDecision({
        meta: withEntries,
        databaseVersion: "v1",
        databaseStateVector: new Map(),
        baseStateVector: new Map(),
      })
    ).toEqual({ kind: "apply", rebased: false });
  });

  it("replays on top of a stored document that descends from the base", () => {
    expect(
      getLogHydrationDecision({
        meta: withEntries,
        databaseVersion: "v2",
        databaseStateVector: new Map([
          [7, 12],
          [8, 3],
        ]),
        baseStateVector: base,
      })
    ).toEqual({ kind: "apply", rebased: true });
  });

  it("orphans the log when the stored document was replaced", () => {
    expect(
      getLogHydrationDecision({
        meta: withEntries,
        databaseVersion: "v2",
        databaseStateVector: new Map([[99, 4]]),
        baseStateVector: base,
      })
    ).toEqual({ kind: "orphan" });
  });

  it("orphans the log when the stored row was deleted", () => {
    expect(
      getLogHydrationDecision({
        meta: withEntries,
        databaseVersion: null,
        databaseStateVector: new Map(),
        baseStateVector: base,
      })
    ).toEqual({ kind: "orphan" });
  });

  it("replays a never-checkpointed log onto a room with no row", () => {
    expect(
      getLogHydrationDecision({
        meta: { ...withEntries, baseVersion: null },
        databaseVersion: null,
        databaseStateVector: new Map(),
        baseStateVector: new Map(),
      })
    ).toEqual({ kind: "apply", rebased: false });
  });

  it("has nothing to do for an empty log", () => {
    expect(
      getLogHydrationDecision({
        meta: createEmptyLogMeta("v1"),
        databaseVersion: "v2",
        databaseStateVector: new Map(),
        baseStateVector: base,
      })
    ).toEqual({ kind: "none" });
  });
});

describe("write-behind checkpoint cadence", () => {
  const meta: WriteBehindLogMeta = {
    ...createEmptyLogMeta("v1"),
    nextSeq: 1,
    bytes: 100,
    firstEntryAt: 10_000,
  };
  const policy = {
    meta,
    now: 20_000,
    activeConnectionCount: 3,
    checkpointIntervalMs: 60_000,
    maxLogBytes: 1_000,
    saveRetryAt: null,
  };

  it("keeps appending while the room is busy and the log is young and small", () => {
    expect(shouldCheckpointLog(policy)).toBe(false);
  });

  it("checkpoints when the room empties", () => {
    expect(shouldCheckpointLog({ ...policy, activeConnectionCount: 0 })).toBe(
      true
    );
  });

  it("checkpoints once the oldest entry waited a full interval", () => {
    expect(shouldCheckpointLog({ ...policy, now: 70_000 })).toBe(true);
  });

  it("checkpoints when the log passes its size bound", () => {
    expect(
      shouldCheckpointLog({ ...policy, meta: { ...meta, bytes: 1_000 } })
    ).toBe(true);
  });

  it("leaves a failed checkpoint to its retry deadline", () => {
    expect(
      shouldCheckpointLog({
        ...policy,
        activeConnectionCount: 0,
        saveRetryAt: 30_000,
      })
    ).toBe(false);
  });

  it("never checkpoints an empty log", () => {
    expect(
      shouldCheckpointLog({
        ...policy,
        meta: createEmptyLogMeta("v1"),
        activeConnectionCount: 0,
      })
    ).toBe(false);
  });

  it("schedules the alarm deadline from the oldest entry", () => {
    expect(getLogCheckpointDueAt(meta, 60_000)).toBe(70_000);
    expect(getLogCheckpointDueAt(createEmptyLogMeta("v1"), 60_000)).toBeNull();
    expect(getLogCheckpointDueAt(undefined, 60_000)).toBeNull();
  });
});
