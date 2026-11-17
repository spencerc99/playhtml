// ABOUTME: Keeps what the picture-reading model saw in each scrap picture, in this browser's IndexedDB.
// ABOUTME: One vector per image address, tagged with the model that made it; pictures it could not read are noted too.

const DB_NAME = "scrap_meaning_db";
const DB_VERSION = 1;
const VECTORS = "vectors";

interface VectorRow {
  src: string;
  model: string;
  /** Absent for a picture that could not be read, so it is not tried again. */
  vector?: Float32Array;
}

let opening: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VECTORS)) {
        db.createObjectStore(VECTORS, { keyPath: "src" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Every picture read by this model: its vector, or null when it could not be read. */
export async function readMeaningVectors(
  model: string,
): Promise<Map<string, Float32Array | null>> {
  const db = await openDatabase();
  const transaction = db.transaction(VECTORS, "readonly");
  const request = transaction.objectStore(VECTORS).getAll();
  const rows = await new Promise<VectorRow[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as VectorRow[]);
    request.onerror = () => reject(request.error);
  });
  const vectors = new Map<string, Float32Array | null>();
  for (const row of rows) {
    if (row.model !== model) continue;
    vectors.set(row.src, row.vector ?? null);
  }
  return vectors;
}

export async function storeMeaningVectors(
  model: string,
  entries: ReadonlyArray<{ src: string; vector: Float32Array | null }>,
): Promise<void> {
  if (entries.length === 0) return;
  const db = await openDatabase();
  const transaction = db.transaction(VECTORS, "readwrite");
  const store = transaction.objectStore(VECTORS);
  for (const { src, vector } of entries) {
    store.put(vector ? { src, model, vector } : { src, model });
  }
  await done(transaction);
}

export async function clearMeaningVectors(): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(VECTORS, "readwrite");
  transaction.objectStore(VECTORS).clear();
  await done(transaction);
}
