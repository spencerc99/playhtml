// ABOUTME: Local IndexedDB store for saved scrap collages, kept on the device.
// ABOUTME: Reads, writes, and deletes whole collage records including their baked preview.

import {
  parseCollageRecord,
  summarizeCollage,
  type CollageEntry,
  type CollageRecord,
  type UnreadableCollage,
} from "./collageRecord";
import { upgradeToCurrentShape } from "./upgradeCollageRecord";

const DB_NAME = "scrap_collages_db";
const DB_VERSION = 1;
const STORE_NAME = "collages";
const UPDATED_AT_INDEX = "updatedAt";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex(UPDATED_AT_INDEX, "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open the collage database"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = run(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Collage database request failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Collage transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export async function saveCollage(record: CollageRecord): Promise<void> {
  await withStore("readwrite", (store) => store.put(record));
}

export async function loadCollage(id: string): Promise<CollageRecord | null> {
  const stored = await withStore<unknown>("readonly", (store) => store.get(id));
  if (stored === undefined) return null;
  const record = parseCollageRecord(await settleShape(stored));
  return record;
}

/**
 * Brings a collage saved before a later pass into the current shape and stores
 * it back, so the rewrite happens once. A row already in the current shape is
 * handed back untouched, including one that cannot be read at all, which stays
 * stored so it can still be listed and deleted.
 */
async function settleShape(stored: unknown): Promise<unknown> {
  const upgraded = upgradeToCurrentShape(stored);
  if (upgraded === stored) return stored;
  try {
    await withStore("readwrite", (store) => store.put(upgraded as never));
  } catch {
    // The collage is usable this session even if the rewrite did not land.
  }
  return upgraded;
}

/**
 * Every saved collage, most recently edited first.
 *
 * A record that cannot be read comes back as an unreadable entry rather than
 * failing the listing, so one damaged collage never hides the rest or leaves
 * itself impossible to delete.
 */
export async function listCollages(): Promise<CollageEntry[]> {
  const stored = await withStore<unknown[]>("readonly", (store) =>
    store.getAll(),
  );
  return stored
    .map((value) => {
      try {
        return summarizeCollage(
          parseCollageRecord(upgradeToCurrentShape(value)),
        );
      } catch (error) {
        return unreadableEntry(value, error);
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Salvages just enough of a broken row to list and delete it. */
function unreadableEntry(value: unknown, error: unknown): UnreadableCollage {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    unreadable: true,
    id: typeof row.id === "string" ? row.id : "",
    title: typeof row.title === "string" ? row.title : "",
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
    reason: error instanceof Error ? error.message : String(error),
  };
}

export async function deleteCollage(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}
