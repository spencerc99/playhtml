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
  readImagePreviewInputs,
  storeImagePreview,
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
  it("stores previews separately, shares them by content, and preserves originals", async () => {
    await store("https://a.test/1.png", "same", 100);
    await store("https://b.test/1.png", "same", 100);
    expect(await storeImagePreview("same", bytes(20))).toBe(true);
    const found = await readImagePreviewInputs([
      "https://a.test/1.png",
      "https://b.test/1.png",
    ]);
    expect([...found.values()].map((entry) => entry.preview?.size)).toEqual([
      20, 20,
    ]);
    const originals = await readImageCopies(["https://a.test/1.png"]);
    expect(originals.get("https://a.test/1.png")?.size).toBe(100);
    expect(await trimImageCopies(120)).toEqual({ evicted: 0, totalBytes: 120 });
    expect(await trimImageCopies(119)).toEqual({ evicted: 0, totalBytes: 100 });
    expect(
      (await readImagePreviewInputs(["https://a.test/1.png"])).get(
        "https://a.test/1.png",
      )?.preview,
    ).toBeUndefined();
    expect(await hasImageCopy("https://a.test/1.png")).toBe(true);
    expect(await trimImageCopies(99)).toEqual({ evicted: 1, totalBytes: 0 });
    expect(await readImagePreviewInputs(["https://a.test/1.png"])).toEqual(
      new Map(),
    );
    expect(await storeImagePreview("same", bytes(20))).toBe(false);
  });

  it("writes eagerly derived previews alongside copies without replacing full bytes", async () => {
    await storeImageCopy({
      src: "https://a.test/1.png",
      hash: "one",
      blob: bytes(100),
      preview: bytes(20),
      form: "reduced",
      mimeType: "image/webp",
      width: 1000,
      height: 800,
    });
    expect(
      (await readImagePreviewInputs(["https://a.test/1.png"])).get(
        "https://a.test/1.png",
      )?.preview?.size,
    ).toBe(20);
    expect(
      (await readImageCopies(["https://a.test/1.png"])).get(
        "https://a.test/1.png",
      )?.size,
    ).toBe(100);
    expect(await trimImageCopies(120)).toEqual({ evicted: 0, totalBytes: 120 });
  });

  it("upgrades old copies without changing their data or pins", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = fakeIndexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        const copies = database.createObjectStore("copies", {
          keyPath: "hash",
        });
        copies.put({
          hash: "old",
          byteLength: 100,
          storedAt: 1,
          form: "reduced",
          mimeType: "image/webp",
          width: 1200,
          height: 800,
        });
        database
          .createObjectStore("blobs", { keyPath: "hash" })
          .put({ hash: "old", blob: bytes(100) });
        const sources = database.createObjectStore("sources", {
          keyPath: "src",
        });
        sources.createIndex("hash", "hash");
        sources.put({ src: "https://a.test/old.png", hash: "old" });
        database
          .createObjectStore("pins", { keyPath: "collageId" })
          .put({ collageId: "saved", srcs: ["https://a.test/old.png"] });
        database.createObjectStore("meta", { keyPath: "key" });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    expect(
      (await readImageCopies(["https://a.test/old.png"])).get(
        "https://a.test/old.png",
      )?.size,
    ).toBe(100);
    expect(await storeImagePreview("old", bytes(20))).toBe(true);
    expect(await trimImageCopies(0)).toEqual({ evicted: 0, totalBytes: 100 });
  });

  it("removes previews before originals and can recreate discarded previews", async () => {
    await store("https://a.test/old.png", "old", 100);
    await store("https://a.test/new.png", "new", 100);
    await storeImagePreview("old", bytes(20));
    await storeImagePreview("new", bytes(20));
    expect(await trimImageCopies(225)).toEqual({ evicted: 0, totalBytes: 220 });
    const inputs = await readImagePreviewInputs([
      "https://a.test/old.png",
      "https://a.test/new.png",
    ]);
    expect(inputs.get("https://a.test/old.png")?.preview).toBeUndefined();
    expect(inputs.get("https://a.test/new.png")?.preview?.size).toBe(20);
    expect(await storeImagePreview("old", bytes(10))).toBe(true);
    expect(await trimImageCopies(230)).toEqual({ evicted: 0, totalBytes: 230 });
    expect(
      (
        await readImageCopies([
          "https://a.test/old.png",
          "https://a.test/new.png",
        ])
      ).size,
    ).toBe(2);
    expect(await trimImageCopies(199)).toEqual({ evicted: 1, totalBytes: 100 });
  });

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
