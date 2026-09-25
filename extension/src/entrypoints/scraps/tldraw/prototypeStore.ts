// ABOUTME: IndexedDB store for the tldraw studio prototype's own documents, apart from saved collages.
// ABOUTME: The prototype reads real collages but only ever writes here, so it cannot overwrite them.

import type { TLStoreSnapshot } from "tldraw";
import type { CollageFormatName, CollagePaper } from "../collageFormats";

const DB_NAME = "scrap_collages_tldraw_prototype_db";
const DB_VERSION = 1;
const STORE_NAME = "documents";

/** The key a collage started fresh in the prototype is kept under. */
export const NEW_DRAFT_ID = "new-draft";

export interface PrototypeDocument {
  /** The id of the collage it was opened from, or NEW_DRAFT_ID. */
  id: string;
  format: CollageFormatName;
  paper: CollagePaper;
  document: TLStoreSnapshot;
  updatedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ?? new Error("Could not open the tldraw prototype database"),
      );
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
        reject(request.error ?? new Error("Prototype database request failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Prototype transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export async function loadPrototypeDocument(
  id: string,
): Promise<PrototypeDocument | null> {
  const stored = await withStore<PrototypeDocument | undefined>(
    "readonly",
    (store) => store.get(id),
  );
  return stored ?? null;
}

export async function savePrototypeDocument(
  document: PrototypeDocument,
): Promise<void> {
  await withStore("readwrite", (store) => store.put(document));
}

export async function deletePrototypeDocument(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}
