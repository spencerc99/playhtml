// ABOUTME: Local IndexedDB copies of scrap images, so scraps and collages outlive their source URLs.
// ABOUTME: Holds copies by content hash, maps sources to them, records collage pins, and trims to a budget.

import {
  IMAGE_COPY_BUDGET_BYTES,
  copiesToEvict,
  pinnedSources,
  type CollagePin,
  type CopyForm,
  type StoredCopySummary,
} from "./imageCopyPolicy";

const DB_NAME = "scrap_image_copies_db";
const DB_VERSION = 1;

/** Copy metadata by content hash; small, so budget checks never touch image bytes. */
const COPIES = "copies";
/** Image bytes by content hash. */
const BLOBS = "blobs";
/** Which copy each image URL resolves to. */
const SOURCES = "sources";
/** The image URLs each saved collage holds pieces of. */
const PINS = "pins";
/** Small bookkeeping values, such as whether the backfill has finished. */
const META = "meta";

const SOURCES_BY_HASH = "hash";

export interface ImageCopy extends StoredCopySummary {
  form: CopyForm;
  mimeType: string;
  width?: number;
  height?: number;
}

interface SourceRow {
  src: string;
  hash: string;
}

interface BlobRow {
  hash: string;
  blob: Blob;
}

interface MetaRow {
  key: string;
  value: unknown;
}

let opening: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(COPIES)) {
        db.createObjectStore(COPIES, { keyPath: "hash" });
      }
      if (!db.objectStoreNames.contains(BLOBS)) {
        db.createObjectStore(BLOBS, { keyPath: "hash" });
      }
      if (!db.objectStoreNames.contains(SOURCES)) {
        const sources = db.createObjectStore(SOURCES, { keyPath: "src" });
        sources.createIndex(SOURCES_BY_HASH, "hash");
      }
      if (!db.objectStoreNames.contains(PINS)) {
        db.createObjectStore(PINS, { keyPath: "collageId" });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another context upgrading the schema needs this connection out of the way.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      opening = null;
      reject(
        request.error ?? new Error("Could not open the image copy database"),
      );
    };
  });
  return opening;
}

/** Forgets the open connection, so a test can delete the database between cases. */
export async function closeImageCopies(): Promise<void> {
  const pending = opening;
  opening = null;
  if (pending) (await pending.catch(() => null))?.close();
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Image copy request failed"));
  });
}

async function transact<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  const transaction = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Image copy transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Image copy transaction aborted"));
  });
  let result: T;
  try {
    result = await run(transaction);
  } catch (error) {
    done.catch(() => {});
    try {
      transaction.abort();
    } catch {
      // The transaction already finished on its own.
    }
    throw error;
  }
  await done;
  return result;
}

/** Whether a copy is already held for this URL. */
export async function hasImageCopy(src: string): Promise<boolean> {
  return transact([SOURCES], "readonly", async (transaction) => {
    const key = await requestResult(
      transaction.objectStore(SOURCES).getKey(src),
    );
    return key !== undefined;
  });
}

/** The stored copy's metadata for a URL, if one is held. */
export async function imageCopyFor(
  src: string,
): Promise<ImageCopy | undefined> {
  return transact([SOURCES, COPIES], "readonly", async (transaction) => {
    const source = (await requestResult(
      transaction.objectStore(SOURCES).get(src),
    )) as SourceRow | undefined;
    if (!source) return undefined;
    return (await requestResult(
      transaction.objectStore(COPIES).get(source.hash),
    )) as ImageCopy | undefined;
  });
}

/** The stored image bytes for each URL that has a copy. */
export async function readImageCopies(
  srcs: readonly string[],
): Promise<Map<string, Blob>> {
  const unique = [...new Set(srcs)];
  return transact([SOURCES, BLOBS], "readonly", async (transaction) => {
    const sources = transaction.objectStore(SOURCES);
    const blobs = transaction.objectStore(BLOBS);
    const found = new Map<string, Blob>();
    await Promise.all(
      unique.map(async (src) => {
        const source = (await requestResult(sources.get(src))) as
          | SourceRow
          | undefined;
        if (!source) return;
        const row = (await requestResult(blobs.get(source.hash))) as
          | BlobRow
          | undefined;
        if (row) found.set(src, row.blob);
      }),
    );
    return found;
  });
}

export interface NewImageCopy {
  src: string;
  hash: string;
  blob: Blob;
  form: CopyForm;
  mimeType: string;
  width?: number;
  height?: number;
}

/**
 * Stores a copy and points its URL at it. When the same image is already held,
 * only the URL is recorded, so identical images from different URLs share one
 * copy. Returns whether new bytes were written.
 */
export async function storeImageCopy(copy: NewImageCopy): Promise<boolean> {
  return transact(
    [COPIES, BLOBS, SOURCES],
    "readwrite",
    async (transaction) => {
      const copies = transaction.objectStore(COPIES);
      const held = await requestResult(copies.getKey(copy.hash));
      if (held === undefined) {
        const record: ImageCopy = {
          hash: copy.hash,
          byteLength: copy.blob.size,
          storedAt: Date.now(),
          form: copy.form,
          mimeType: copy.mimeType,
          ...(copy.width !== undefined ? { width: copy.width } : {}),
          ...(copy.height !== undefined ? { height: copy.height } : {}),
        };
        copies.put(record);
        transaction
          .objectStore(BLOBS)
          .put({ hash: copy.hash, blob: copy.blob } satisfies BlobRow);
      }
      transaction
        .objectStore(SOURCES)
        .put({ src: copy.src, hash: copy.hash } satisfies SourceRow);
      return held === undefined;
    },
  );
}

/** Records the image URLs a collage holds, replacing what it held before. */
export async function pinCollageSources(
  collageId: string,
  srcs: readonly string[],
): Promise<void> {
  await transact([PINS], "readwrite", async (transaction) => {
    transaction
      .objectStore(PINS)
      .put({ collageId, srcs: [...new Set(srcs)] } satisfies CollagePin);
  });
}

/** Drops a deleted collage's pins, so images no other collage holds can be let go. */
export async function unpinCollage(collageId: string): Promise<void> {
  await transact([PINS], "readwrite", async (transaction) => {
    transaction.objectStore(PINS).delete(collageId);
  });
}

export async function listCollagePins(): Promise<CollagePin[]> {
  return transact([PINS], "readonly", async (transaction) =>
    (await requestResult(transaction.objectStore(PINS).getAll())) as CollagePin[],
  );
}

/**
 * Lets go of the oldest copies no collage holds until the total fits the
 * budget. Runs in one transaction, so a pin written alongside is either seen
 * in full or not at all.
 */
export async function trimImageCopies(
  budgetBytes: number = IMAGE_COPY_BUDGET_BYTES,
): Promise<{ evicted: number; totalBytes: number }> {
  return transact(
    [COPIES, BLOBS, SOURCES, PINS],
    "readwrite",
    async (transaction) => {
      const copies = (await requestResult(
        transaction.objectStore(COPIES).getAll(),
      )) as ImageCopy[];
      const pins = (await requestResult(
        transaction.objectStore(PINS).getAll(),
      )) as CollagePin[];
      const sources = transaction.objectStore(SOURCES);
      const pinnedHashes = new Set<string>();
      await Promise.all(
        [...pinnedSources(pins)].map(async (src) => {
          const row = (await requestResult(sources.get(src))) as
            | SourceRow
            | undefined;
          if (row) pinnedHashes.add(row.hash);
        }),
      );
      const evicted = copiesToEvict(copies, pinnedHashes, budgetBytes);
      const byHash = sources.index(SOURCES_BY_HASH);
      for (const hash of evicted) {
        transaction.objectStore(COPIES).delete(hash);
        transaction.objectStore(BLOBS).delete(hash);
        const keys = await requestResult(byHash.getAllKeys(hash));
        for (const key of keys) sources.delete(key);
      }
      const evictedSet = new Set(evicted);
      const totalBytes = copies
        .filter((copy) => !evictedSet.has(copy.hash))
        .reduce((sum, copy) => sum + copy.byteLength, 0);
      return { evicted: evicted.length, totalBytes };
    },
  );
}

export async function readImageCopyMeta(key: string): Promise<unknown> {
  return transact([META], "readonly", async (transaction) => {
    const row = (await requestResult(transaction.objectStore(META).get(key))) as
      | MetaRow
      | undefined;
    return row?.value;
  });
}

export async function writeImageCopyMeta(
  key: string,
  value: unknown,
): Promise<void> {
  await transact([META], "readwrite", async (transaction) => {
    transaction.objectStore(META).put({ key, value } satisfies MetaRow);
  });
}
