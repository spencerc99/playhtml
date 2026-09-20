// ABOUTME: Local IndexedDB store for saved scrap collages, kept on the device.
// ABOUTME: Reads, writes, and deletes whole collage records including their baked preview.

import {
  parseCollageRecord,
  summarizeCollage,
  type CollageRecord,
  type CollageSummary,
} from "./collageRecord";

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
  return parseCollageRecord(stored);
}

/** Every saved collage, most recently edited first. */
export async function listCollages(): Promise<CollageSummary[]> {
  const stored = await withStore<unknown[]>("readonly", (store) =>
    store.getAll(),
  );
  return stored
    .map((value) => summarizeCollage(parseCollageRecord(value)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteCollage(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}
