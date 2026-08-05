// ABOUTME: Same-origin IndexedDB store the installation master writes events to
// ABOUTME: and followers read from, so followers never fetch the ~11 MB payload.
import { CollectionEvent } from "../types";

const DB_NAME = "wewe-install";
const STORE_NAME = "events";
// One fixed key holds the whole event set — the store is a single-slot cache,
// overwritten wholesale on each master write.
const RECORD_KEY = "current";

interface StoredEvents {
  events: CollectionEvent[];
  version: number;
}

/** Open (and create on first use) the store. Rejects when IndexedDB is
 * unavailable (e.g. private mode) so callers can fall back to fetching. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("open failed"));
  });
}

/** Overwrite the stored events and bump the stored version. The bumped version
 * rides along on the `events-ready` ping so followers can tell writes apart. */
export async function writeEvents(events: CollectionEvent[]): Promise<void> {
  const db = await openDb();
  const previous = await readFromDb(db);
  const version = (previous?.version ?? 0) + 1;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ events, version }, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("write failed"));
      tx.onabort = () => reject(tx.error ?? new Error("write aborted"));
    });
  } finally {
    db.close();
  }
}

/** Read the stored events, or null when nothing has been written yet (or
 * IndexedDB is unavailable — the promise rejects in that case). */
export async function readEvents(): Promise<StoredEvents | null> {
  const db = await openDb();
  try {
    return await readFromDb(db);
  } finally {
    db.close();
  }
}

function readFromDb(db: IDBDatabase): Promise<StoredEvents | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(RECORD_KEY);
    request.onsuccess = () => {
      const value = request.result as StoredEvents | undefined;
      resolve(value ?? null);
    };
    request.onerror = () => reject(request.error ?? new Error("read failed"));
  });
}
