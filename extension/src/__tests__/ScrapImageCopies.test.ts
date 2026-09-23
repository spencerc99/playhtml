// ABOUTME: Tests the local image copy store: sharing copies by content, collage pins, and budget trimming.
// ABOUTME: Runs against a real IndexedDB implementation, not a stubbed store.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Blob as StructuredCloneableBlob } from "node:buffer";
import {
  IDBKeyRange as fakeIDBKeyRange,
  indexedDB as fakeIndexedDB,
} from "fake-indexeddb";
import {
  closeImageCopies,
  hasImageCopy,
  pinCollageSources,
  readImageCopies,
  storeImageCopy,
  trimImageCopies,
  unpinCollage,
  readImageCopyMeta,
  writeImageCopyMeta,
} from "../storage/ScrapImageCopies";

const DB_NAME = "scrap_image_copies_db";
const originalIndexedDB = globalThis.indexedDB;
const originalIDBKeyRange = globalThis.IDBKeyRange;

// jsdom's Blob is invisible to Node's structuredClone, which fake-indexeddb
// round-trips stored values through.
function bytes(size: number): Blob {
  return new StructuredCloneableBlob([new Uint8Array(size)], {
    type: "image/webp",
  }) as unknown as Blob;
}

async function store(src: string, hash: string, size: number) {
  return storeImageCopy({
    src,
    hash,
    blob: bytes(size),
    form: "reduced",
    mimeType: "image/webp",
    width: 10,
    height: 10,
  });
}

let now = 1_000;
const realNow = Date.now;

beforeEach(() => {
  globalThis.indexedDB = fakeIndexedDB;
  globalThis.IDBKeyRange = fakeIDBKeyRange;
  now = 1_000;
  Date.now = () => (now += 1_000);
});

afterEach(async () => {
  Date.now = realNow;
  await closeImageCopies();
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB delete blocked"));
  });
  globalThis.indexedDB = originalIndexedDB;
  globalThis.IDBKeyRange = originalIDBKeyRange;
});

describe("ScrapImageCopies", () => {
  it("shares one copy between URLs that carry the same image", async () => {
    expect(await store("https://a.test/1.png", "same", 100)).toBe(true);
    expect(await store("https://b.test/mirror.png", "same", 100)).toBe(false);
    const found = await readImageCopies([
      "https://a.test/1.png",
      "https://b.test/mirror.png",
      "https://c.test/never.png",
    ]);
    expect([...found.keys()].sort()).toEqual([
      "https://a.test/1.png",
      "https://b.test/mirror.png",
    ]);
    expect(await hasImageCopy("https://c.test/never.png")).toBe(false);
  });

  it("trims the oldest unpinned copies and forgets their URLs", async () => {
    await store("https://a.test/old.png", "old", 100);
    await store("https://a.test/mid.png", "mid", 100);
    await store("https://a.test/new.png", "new", 100);

    expect(await trimImageCopies(200)).toEqual({ evicted: 1, totalBytes: 200 });
    expect(await hasImageCopy("https://a.test/old.png")).toBe(false);
    expect(await hasImageCopy("https://a.test/mid.png")).toBe(true);
  });

  it("keeps a collage's pieces until the last collage holding them is deleted", async () => {
    await store("https://a.test/held.png", "held", 100);
    await store("https://a.test/free.png", "free", 100);
    await pinCollageSources("one", ["https://a.test/held.png"]);
    await pinCollageSources("two", ["https://a.test/held.png"]);

    await trimImageCopies(50);
    expect(await hasImageCopy("https://a.test/held.png")).toBe(true);
    expect(await hasImageCopy("https://a.test/free.png")).toBe(false);

    await unpinCollage("one");
    await trimImageCopies(50);
    expect(await hasImageCopy("https://a.test/held.png")).toBe(true);

    await unpinCollage("two");
    await trimImageCopies(50);
    expect(await hasImageCopy("https://a.test/held.png")).toBe(false);
  });

  it("replaces a collage's pins when its pieces change", async () => {
    await store("https://a.test/was.png", "was", 100);
    await store("https://a.test/now.png", "now", 100);
    await pinCollageSources("one", ["https://a.test/was.png"]);
    await pinCollageSources("one", ["https://a.test/now.png"]);

    await trimImageCopies(50);
    expect(await hasImageCopy("https://a.test/was.png")).toBe(false);
    expect(await hasImageCopy("https://a.test/now.png")).toBe(true);
  });

  it("remembers bookkeeping values", async () => {
    expect(await readImageCopyMeta("backfill-done")).toBeUndefined();
    await writeImageCopyMeta("backfill-done", true);
    expect(await readImageCopyMeta("backfill-done")).toBe(true);
  });
});
