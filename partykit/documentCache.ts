// ABOUTME: Keeps a copy of the last persisted room document in Durable Object storage.
// ABOUTME: The copy is only trusted when its version matches the database row's version.

// Durable Object storage caps each value at 2 MiB, so documents are split.
export const DOCUMENT_CACHE_CHUNK_CHARS = 1024 * 1024;

export const DOCUMENT_CACHE_META_KEY = "documentCache:meta";

export function getDocumentCacheChunkKey(index: number): string {
  return `documentCache:chunk:${index}`;
}

export type DocumentCacheMeta = {
  version: string;
  chunkCount: number;
  length: number;
};

export interface DocumentCacheStorage {
  get(key: string): Promise<unknown>;
  get(keys: string[]): Promise<Map<string, unknown>>;
  put(
    entries: Record<string, unknown>,
    options?: { allowUnconfirmed?: boolean }
  ): Promise<void>;
  delete(keys: string[]): Promise<number>;
}

function parseMeta(value: unknown): DocumentCacheMeta | null {
  if (typeof value !== "object" || value === null) return null;
  const { version, chunkCount, length } = value as Record<string, unknown>;
  if (
    typeof version !== "string" ||
    typeof chunkCount !== "number" ||
    typeof length !== "number"
  ) {
    return null;
  }
  return { version, chunkCount, length };
}

// Returns the cached document only when it was saved as `version`. Any
// mismatch or damage returns null so the caller loads from the database.
export async function readCachedDocument(
  storage: DocumentCacheStorage,
  version: string
): Promise<string | null> {
  const meta = parseMeta(await storage.get(DOCUMENT_CACHE_META_KEY));
  if (meta === null || meta.version !== version) return null;

  const keys = Array.from({ length: meta.chunkCount }, (_, index) =>
    getDocumentCacheChunkKey(index)
  );
  const chunks = keys.length === 0 ? new Map() : await storage.get(keys);
  const parts: string[] = [];
  for (const key of keys) {
    const chunk = chunks.get(key);
    if (typeof chunk !== "string") return null;
    parts.push(chunk);
  }
  const document = parts.join("");
  return document.length === meta.length ? document : null;
}

// Stores `documentBase64` as the copy of database version `version`. The meta
// record and every chunk are written in one atomic put, so a reader never sees
// a new meta with old chunks.
export async function writeCachedDocument(
  storage: DocumentCacheStorage,
  version: string,
  documentBase64: string
): Promise<void> {
  const previous = parseMeta(await storage.get(DOCUMENT_CACHE_META_KEY));
  const chunkCount = Math.ceil(
    documentBase64.length / DOCUMENT_CACHE_CHUNK_CHARS
  );
  const entries: Record<string, unknown> = {
    [DOCUMENT_CACHE_META_KEY]: {
      version,
      chunkCount,
      length: documentBase64.length,
    } satisfies DocumentCacheMeta,
  };
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * DOCUMENT_CACHE_CHUNK_CHARS;
    entries[getDocumentCacheChunkKey(index)] = documentBase64.slice(
      start,
      start + DOCUMENT_CACHE_CHUNK_CHARS
    );
  }
  // The copy can always be rebuilt from the database, so it does not need to
  // hold outgoing messages until the write is confirmed.
  await storage.put(entries, { allowUnconfirmed: true });

  if (previous !== null && previous.chunkCount > chunkCount) {
    const staleKeys: string[] = [];
    for (let index = chunkCount; index < previous.chunkCount; index += 1) {
      staleKeys.push(getDocumentCacheChunkKey(index));
    }
    await storage.delete(staleKeys);
  }
}

export async function clearCachedDocument(
  storage: DocumentCacheStorage
): Promise<void> {
  const previous = parseMeta(await storage.get(DOCUMENT_CACHE_META_KEY));
  const keys = [DOCUMENT_CACHE_META_KEY];
  for (let index = 0; index < (previous?.chunkCount ?? 0); index += 1) {
    keys.push(getDocumentCacheChunkKey(index));
  }
  await storage.delete(keys);
}
