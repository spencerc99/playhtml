// ABOUTME: Stores the Yjs updates a room accepted since its last database checkpoint.
// ABOUTME: Durable Object storage holds the log; the database row stays the recovery source.
import * as Y from "yjs";

// Durable Object storage caps each value at 2 MiB, so large updates are split.
export const WRITE_BEHIND_PART_BYTES = 1024 * 1024;
// A single storage.put() or storage.get() accepts at most 128 keys.
const STORAGE_BATCH_KEYS = 128;

export const WRITE_BEHIND_META_KEY = "writeBehind:meta";
export const WRITE_BEHIND_ORPHAN_KEY = "writeBehind:orphan";

export function getWriteBehindEntryKey(seq: number): string {
  return `writeBehind:entry:${seq}`;
}

export function getWriteBehindBaseStateVectorKey(index: number): string {
  return `writeBehind:baseStateVector:${index}`;
}

// The log is always relative to one database checkpoint: `baseVersion` is the
// `documents.version` that checkpoint produced (null when the room has never
// been checkpointed) and the base state vector is that document's Yjs state
// vector. Entries live at sequence numbers [firstSeq, nextSeq); keys outside
// that range are garbage from an interrupted cleanup and are never read.
export type WriteBehindLogMeta = {
  baseVersion: string | null;
  baseStateVectorChunks: number;
  firstSeq: number;
  nextSeq: number;
  bytes: number;
  firstEntryAt: number | null;
};

// A log whose base the database no longer descends from. Its entries are kept
// in storage for operator recovery instead of being applied or deleted.
export type WriteBehindOrphan = {
  baseVersion: string | null;
  databaseVersion: string | null;
  firstSeq: number;
  nextSeq: number;
  bytes: number;
  orphanedAt: number;
};

type WriteBehindEntryPart = {
  data: Uint8Array;
  more: boolean;
};

export interface WriteBehindStorage {
  get(key: string): Promise<unknown>;
  get(keys: string[]): Promise<Map<string, unknown>>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
}

export function hasLogEntries(meta: WriteBehindLogMeta): boolean {
  return meta.nextSeq > meta.firstSeq;
}

export function createEmptyLogMeta(
  baseVersion: string | null,
  firstSeq = 0
): WriteBehindLogMeta {
  return {
    baseVersion,
    baseStateVectorChunks: 0,
    firstSeq,
    nextSeq: firstSeq,
    bytes: 0,
    firstEntryAt: null,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseMeta(value: unknown): WriteBehindLogMeta | null {
  if (typeof value !== "object" || value === null) return null;
  const meta = value as Record<string, unknown>;
  if (
    !(typeof meta.baseVersion === "string" || meta.baseVersion === null) ||
    !isFiniteNumber(meta.baseStateVectorChunks) ||
    !isFiniteNumber(meta.firstSeq) ||
    !isFiniteNumber(meta.nextSeq) ||
    !isFiniteNumber(meta.bytes) ||
    !(isFiniteNumber(meta.firstEntryAt) || meta.firstEntryAt === null)
  ) {
    return null;
  }
  return {
    baseVersion: meta.baseVersion,
    baseStateVectorChunks: meta.baseStateVectorChunks,
    firstSeq: meta.firstSeq,
    nextSeq: meta.nextSeq,
    bytes: meta.bytes,
    firstEntryAt: meta.firstEntryAt,
  };
}

// Returns null when no log has been written. A present but unreadable meta
// record throws: silently treating it as empty would drop accepted updates.
export async function readLogMeta(
  storage: WriteBehindStorage
): Promise<WriteBehindLogMeta | null> {
  const value = await storage.get(WRITE_BEHIND_META_KEY);
  if (value === undefined) return null;
  const meta = parseMeta(value);
  if (meta === null) {
    throw new Error(
      `Unreadable write-behind log meta: ${JSON.stringify(value)}`
    );
  }
  return meta;
}

function splitParts(update: Uint8Array): WriteBehindEntryPart[] {
  const parts: WriteBehindEntryPart[] = [];
  for (
    let start = 0;
    start < update.length;
    start += WRITE_BEHIND_PART_BYTES
  ) {
    const end = Math.min(update.length, start + WRITE_BEHIND_PART_BYTES);
    parts.push({ data: update.slice(start, end), more: end < update.length });
  }
  return parts;
}

// Appends one Yjs update. Every part and the new meta are written in a single
// put, so the update is either fully in the log or not at all.
export async function appendLogEntry(
  storage: WriteBehindStorage,
  meta: WriteBehindLogMeta,
  update: Uint8Array,
  now: number
): Promise<WriteBehindLogMeta> {
  const parts = splitParts(update);
  if (parts.length === 0) return meta;
  if (parts.length >= STORAGE_BATCH_KEYS) {
    throw new Error(
      `Write-behind update of ${update.length} bytes exceeds one atomic storage write`
    );
  }

  const next: WriteBehindLogMeta = {
    ...meta,
    nextSeq: meta.nextSeq + parts.length,
    bytes: meta.bytes + update.length,
    firstEntryAt: meta.firstEntryAt ?? now,
  };
  const entries: Record<string, unknown> = { [WRITE_BEHIND_META_KEY]: next };
  parts.forEach((part, index) => {
    entries[getWriteBehindEntryKey(meta.nextSeq + index)] = part;
  });
  await storage.put(entries);
  return next;
}

async function readKeys(
  storage: WriteBehindStorage,
  keys: string[]
): Promise<Map<string, unknown>> {
  const values = new Map<string, unknown>();
  for (let start = 0; start < keys.length; start += STORAGE_BATCH_KEYS) {
    const batch = await storage.get(
      keys.slice(start, start + STORAGE_BATCH_KEYS)
    );
    for (const [key, value] of batch) values.set(key, value);
  }
  return values;
}

function isEntryPart(value: unknown): value is WriteBehindEntryPart {
  if (typeof value !== "object" || value === null) return false;
  const part = value as Record<string, unknown>;
  return part.data instanceof Uint8Array && typeof part.more === "boolean";
}

function joinParts(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  const length = parts.reduce((total, part) => total + part.length, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function entryKeys(firstSeq: number, nextSeq: number): string[] {
  const keys: string[] = [];
  for (let seq = firstSeq; seq < nextSeq; seq += 1) {
    keys.push(getWriteBehindEntryKey(seq));
  }
  return keys;
}

// Returns the logged updates in order. A missing or damaged entry throws,
// because skipping it would load a document without updates it accepted.
export async function readLogEntries(
  storage: WriteBehindStorage,
  range: { firstSeq: number; nextSeq: number }
): Promise<Uint8Array[]> {
  const keys = entryKeys(range.firstSeq, range.nextSeq);
  const values = await readKeys(storage, keys);
  const updates: Uint8Array[] = [];
  let pending: Uint8Array[] = [];
  for (const key of keys) {
    const value = values.get(key);
    if (!isEntryPart(value)) {
      throw new Error(`Write-behind log entry ${key} is missing or damaged`);
    }
    pending.push(value.data);
    if (!value.more) {
      updates.push(joinParts(pending));
      pending = [];
    }
  }
  if (pending.length > 0) {
    throw new Error("Write-behind log ends in the middle of an update");
  }
  return updates;
}

export async function readBaseStateVector(
  storage: WriteBehindStorage,
  meta: WriteBehindLogMeta
): Promise<Map<number, number>> {
  if (meta.baseStateVectorChunks === 0) return new Map();
  const keys = Array.from({ length: meta.baseStateVectorChunks }, (_, index) =>
    getWriteBehindBaseStateVectorKey(index)
  );
  const values = await readKeys(storage, keys);
  const chunks: Uint8Array[] = [];
  for (const key of keys) {
    const value = values.get(key);
    if (!(value instanceof Uint8Array)) {
      throw new Error(`Write-behind base state vector chunk ${key} is missing`);
    }
    chunks.push(value);
  }
  return Y.decodeStateVector(joinParts(chunks));
}

async function deleteKeys(
  storage: WriteBehindStorage,
  keys: string[]
): Promise<void> {
  for (let start = 0; start < keys.length; start += STORAGE_BATCH_KEYS) {
    await storage.delete(keys.slice(start, start + STORAGE_BATCH_KEYS));
  }
}

// Starts an empty log on top of the checkpoint `baseVersion`. Sequence numbers
// keep counting up, so entries of the previous log can never be mistaken for
// entries of the new one even if deleting them is interrupted. Pass
// `keepPreviousEntries` when the previous entries were recorded as an orphan.
export async function resetLog(
  storage: WriteBehindStorage,
  previous: WriteBehindLogMeta | null,
  baseVersion: string | null,
  baseStateVector: Uint8Array,
  { keepPreviousEntries = false }: { keepPreviousEntries?: boolean } = {}
): Promise<WriteBehindLogMeta> {
  const firstSeq = previous?.nextSeq ?? 0;
  const stateVectorParts = splitParts(baseStateVector).map((part) => part.data);
  if (stateVectorParts.length >= STORAGE_BATCH_KEYS) {
    throw new Error("Write-behind base state vector exceeds one atomic write");
  }
  const next: WriteBehindLogMeta = {
    ...createEmptyLogMeta(baseVersion, firstSeq),
    baseStateVectorChunks: stateVectorParts.length,
  };
  const entries: Record<string, unknown> = { [WRITE_BEHIND_META_KEY]: next };
  stateVectorParts.forEach((part, index) => {
    entries[getWriteBehindBaseStateVectorKey(index)] = part;
  });
  await storage.put(entries);

  if (previous !== null) {
    const staleKeys = keepPreviousEntries
      ? []
      : entryKeys(previous.firstSeq, previous.nextSeq);
    for (
      let index = stateVectorParts.length;
      index < previous.baseStateVectorChunks;
      index += 1
    ) {
      staleKeys.push(getWriteBehindBaseStateVectorKey(index));
    }
    await deleteKeys(storage, staleKeys);
  }
  return next;
}

export async function readOrphan(
  storage: WriteBehindStorage
): Promise<WriteBehindOrphan | null> {
  const value = await storage.get(WRITE_BEHIND_ORPHAN_KEY);
  if (typeof value !== "object" || value === null) return null;
  return value as WriteBehindOrphan;
}

// Keeps the entries of a log the database no longer descends from and records
// where they are, so an operator can recover them. Only the newest orphan is
// kept. The caller must start the next log after `meta.nextSeq`.
export async function orphanLog(
  storage: WriteBehindStorage,
  meta: WriteBehindLogMeta,
  databaseVersion: string | null,
  now: number
): Promise<WriteBehindOrphan> {
  const previous = await readOrphan(storage);
  const orphan: WriteBehindOrphan = {
    baseVersion: meta.baseVersion,
    databaseVersion,
    firstSeq: meta.firstSeq,
    nextSeq: meta.nextSeq,
    bytes: meta.bytes,
    orphanedAt: now,
  };
  await storage.put({ [WRITE_BEHIND_ORPHAN_KEY]: orphan });
  if (previous !== null) {
    await deleteKeys(storage, entryKeys(previous.firstSeq, previous.nextSeq));
  }
  return orphan;
}

// True when a document with state vector `candidate` contains every struct a
// document with state vector `base` has.
export function stateVectorDominates(
  candidate: Map<number, number>,
  base: Map<number, number>
): boolean {
  for (const [client, clock] of base) {
    if ((candidate.get(client) ?? 0) < clock) return false;
  }
  return true;
}

export type LogHydrationDecision =
  | { kind: "none" }
  | { kind: "apply"; rebased: boolean }
  | { kind: "orphan" };

// Decides what a starting room does with its log given the database row it
// loaded. A matching version means the row is the log's base. A changed
// version is still safe to build on when the stored document descends from the
// log's base, which is what a checkpoint whose confirmation was lost looks
// like; applying the log then is an ordinary Yjs merge. A row that was deleted
// or replaced by a document that does not descend from the base was edited
// outside this room, and that edit wins over the log.
export function getLogHydrationDecision({
  meta,
  databaseVersion,
  databaseStateVector,
  baseStateVector,
}: {
  meta: WriteBehindLogMeta | null;
  databaseVersion: string | null;
  databaseStateVector: Map<number, number>;
  baseStateVector: Map<number, number>;
}): LogHydrationDecision {
  if (meta === null || !hasLogEntries(meta)) return { kind: "none" };
  if (meta.baseVersion === databaseVersion) {
    return { kind: "apply", rebased: false };
  }
  if (databaseVersion === null) return { kind: "orphan" };
  if (stateVectorDominates(databaseStateVector, baseStateVector)) {
    return { kind: "apply", rebased: true };
  }
  return { kind: "orphan" };
}

// Decides whether a save that already appended its updates to the log also
// writes the full document to the database. Checkpoints happen when the room
// empties, when the log grows past its size bound, and once the oldest logged
// update has waited a full interval. While an earlier checkpoint is waiting on
// its retry deadline, saves only append; the retry alarm owns the next attempt.
export function shouldCheckpointLog({
  meta,
  now,
  activeConnectionCount,
  checkpointIntervalMs,
  maxLogBytes,
  saveRetryAt,
}: {
  meta: WriteBehindLogMeta;
  now: number;
  activeConnectionCount: number;
  checkpointIntervalMs: number;
  maxLogBytes: number;
  saveRetryAt: number | null;
}): boolean {
  if (!hasLogEntries(meta)) return false;
  if (saveRetryAt !== null && saveRetryAt > now) return false;
  if (activeConnectionCount === 0) return true;
  if (meta.bytes >= maxLogBytes) return true;
  return (
    meta.firstEntryAt !== null && now - meta.firstEntryAt >= checkpointIntervalMs
  );
}

// When the alarm must checkpoint a log that stopped receiving saves, or null
// when there is nothing to checkpoint.
export function getLogCheckpointDueAt(
  meta: WriteBehindLogMeta | null | undefined,
  checkpointIntervalMs: number
): number | null {
  if (!meta || !hasLogEntries(meta) || meta.firstEntryAt === null) return null;
  return meta.firstEntryAt + checkpointIntervalMs;
}
