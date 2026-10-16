// ABOUTME: Verifies the Durable Object copy of the last persisted room document.
// ABOUTME: Covers chunking, version matching, shrinking documents, and damaged copies.
import { describe, expect, it } from "bun:test";
import {
  DOCUMENT_CACHE_CHUNK_CHARS,
  DOCUMENT_CACHE_META_KEY,
  clearCachedDocument,
  getDocumentCacheChunkKey,
  readCachedDocument,
  writeCachedDocument,
} from "../documentCache";

class MemoryStorage {
  values = new Map<string, unknown>();
  putOptions: Array<{ allowUnconfirmed?: boolean } | undefined> = [];

  async get(key: string | string[]): Promise<any> {
    if (Array.isArray(key)) {
      return new Map(
        key.filter((k) => this.values.has(k)).map((k) => [k, this.values.get(k)])
      );
    }
    return this.values.get(key);
  }
  async put(
    entries: Record<string, unknown>,
    options?: { allowUnconfirmed?: boolean }
  ): Promise<void> {
    this.putOptions.push(options);
    for (const [key, value] of Object.entries(entries)) this.values.set(key, value);
  }
  async delete(keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) if (this.values.delete(key)) deleted += 1;
    return deleted;
  }
}

describe("document cache", () => {
  it("returns the stored document only for the matching version", async () => {
    const storage = new MemoryStorage();
    await writeCachedDocument(storage, "v1", "AAAA");

    expect(await readCachedDocument(storage, "v1")).toBe("AAAA");
    expect(await readCachedDocument(storage, "v2")).toBe(null);
    expect(storage.putOptions).toEqual([{ allowUnconfirmed: true }]);
  });

  it("splits large documents into chunks and joins them back", async () => {
    const storage = new MemoryStorage();
    const document = "a".repeat(DOCUMENT_CACHE_CHUNK_CHARS * 2) + "tail";
    await writeCachedDocument(storage, "v1", document);

    expect(storage.values.get(DOCUMENT_CACHE_META_KEY)).toEqual({
      version: "v1",
      chunkCount: 3,
      length: document.length,
    });
    expect(await readCachedDocument(storage, "v1")).toBe(document);
  });

  it("removes chunks left over from a larger earlier document", async () => {
    const storage = new MemoryStorage();
    await writeCachedDocument(
      storage,
      "v1",
      "b".repeat(DOCUMENT_CACHE_CHUNK_CHARS * 3)
    );
    await writeCachedDocument(storage, "v2", "small");

    expect(storage.values.has(getDocumentCacheChunkKey(1))).toBe(false);
    expect(storage.values.has(getDocumentCacheChunkKey(2))).toBe(false);
    expect(await readCachedDocument(storage, "v2")).toBe("small");
  });

  it("treats a missing or damaged chunk as no copy", async () => {
    const storage = new MemoryStorage();
    await writeCachedDocument(
      storage,
      "v1",
      "c".repeat(DOCUMENT_CACHE_CHUNK_CHARS + 10)
    );
    storage.values.delete(getDocumentCacheChunkKey(1));
    expect(await readCachedDocument(storage, "v1")).toBe(null);

    await writeCachedDocument(storage, "v2", "abcd");
    storage.values.set(getDocumentCacheChunkKey(0), "abc");
    expect(await readCachedDocument(storage, "v2")).toBe(null);
  });

  it("clears the copy and its chunks", async () => {
    const storage = new MemoryStorage();
    await writeCachedDocument(
      storage,
      "v1",
      "d".repeat(DOCUMENT_CACHE_CHUNK_CHARS + 1)
    );
    await clearCachedDocument(storage);

    expect(storage.values.size).toBe(0);
    expect(await readCachedDocument(storage, "v1")).toBe(null);
  });
});
