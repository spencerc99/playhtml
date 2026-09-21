// ABOUTME: Tests saving, reading, listing, and deleting collages in local IndexedDB.
// ABOUTME: Runs against a real IndexedDB implementation, not a stubbed store.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Blob as StructuredCloneableBlob } from "node:buffer";
import {
  IDBKeyRange as fakeIDBKeyRange,
  indexedDB as fakeIndexedDB,
} from "fake-indexeddb";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import assert from "node:assert/strict";
import {
  deleteCollage,
  listCollages,
  loadCollage,
  saveCollage,
} from "../entrypoints/scraps/collageStore";
import { isUnreadable } from "../entrypoints/scraps/collageRecord";
import type {
  CollagePiece,
  CollageRecord,
} from "../entrypoints/scraps/collageRecord";

const DB_NAME = "scrap_collages_db";
const originalIndexedDB = globalThis.indexedDB;
const originalIDBKeyRange = globalThis.IDBKeyRange;

function scrap(overrides: Partial<ScrapItem> = {}): ScrapItem {
  return {
    id: "scrap_1",
    key: "image:one",
    kind: "image",
    src: "https://example.test/one.png",
    naturalWidth: 100,
    naturalHeight: 80,
    pageTitle: "A page",
    domain: "example.test",
    pageUrl: "https://example.test/a",
    ts: 1_000,
    ...overrides,
  } as ScrapItem;
}

function piece(overrides: Partial<CollagePiece> = {}): CollagePiece {
  return {
    id: "piece_1",
    scrapId: "scrap_1",
    scrap: scrap(),
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    rotation: 12,
    z: 0,
    crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    flipX: false,
    flipY: false,
    ...overrides,
  };
}

function record(overrides: Partial<CollageRecord> = {}): CollageRecord {
  return {
    id: "collage_1",
    title: "A collage",
    createdAt: 5_000,
    updatedAt: 6_000,
    frame: { width: 1500, height: 1000 },
    format: "postcard",
    paper: { color: "#fffdf9" },
    pieces: [piece()],
    // jsdom's Blob is invisible to Node's structuredClone, which is what
    // fake-indexeddb round-trips a stored record through.
    preview: new StructuredCloneableBlob(["fake png bytes"], {
      type: "image/png",
    }) as unknown as Blob,
    ...overrides,
  };
}

/** Writes a row straight to the store, bypassing the record's own shape. */
async function putRaw(row: Record<string, unknown>): Promise<void> {
  const db = await new Promise<IDBDatabase>((ok, bad) => {
    const request = fakeIndexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const opened = request.result;
      if (!opened.objectStoreNames.contains("collages")) {
        opened
          .createObjectStore("collages", { keyPath: "id" })
          .createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => ok(request.result);
    request.onerror = () => bad(request.error);
  });
  try {
    await new Promise<void>((ok, bad) => {
      const transaction = db.transaction("collages", "readwrite");
      transaction.objectStore("collages").put(row);
      transaction.oncomplete = () => ok();
      transaction.onerror = () => bad(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function deleteCollageDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB delete blocked"));
  });
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { indexedDB: IDBFactory }).indexedDB =
    fakeIndexedDB;
  Object.defineProperty(globalThis, "IDBKeyRange", {
    value: fakeIDBKeyRange,
    configurable: true,
  });
  await deleteCollageDatabase();
});

afterEach(async () => {
  await deleteCollageDatabase();
  (globalThis as typeof globalThis & { indexedDB: IDBFactory }).indexedDB =
    originalIndexedDB;
  Object.defineProperty(globalThis, "IDBKeyRange", {
    value: originalIDBKeyRange,
    configurable: true,
  });
});

describe("collageStore", () => {
  it("reads back everything a saved collage held", async () => {
    await saveCollage(record());
    const loaded = await loadCollage("collage_1");
    expect(loaded).not.toBeNull();
    expect(loaded?.title).toBe("A collage");
    expect(loaded?.frame).toEqual({ width: 1500, height: 1000 });
    expect(loaded?.format).toBe("postcard");
    expect(loaded?.paper).toEqual({ color: "#fffdf9" });
    expect(loaded?.pieces).toHaveLength(1);
    expect(loaded?.pieces[0].rotation).toBe(12);
    expect(loaded?.pieces[0].crop).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.8,
    });
    expect(loaded?.pieces[0].scrap.pageUrl).toBe("https://example.test/a");
    expect(await loaded?.preview.text()).toBe("fake png bytes");
  });

  it("reports a collage that was never saved as absent", async () => {
    expect(await loadCollage("collage_missing")).toBeNull();
  });

  it("replaces a collage saved again under the same id", async () => {
    await saveCollage(record());
    await saveCollage(
      record({ title: "Second pass", updatedAt: 9_000, pieces: [] }),
    );
    const loaded = await loadCollage("collage_1");
    expect(loaded?.title).toBe("Second pass");
    expect(loaded?.pieces).toEqual([]);
    expect(await listCollages()).toHaveLength(1);
  });

  it("lists collages most recently edited first", async () => {
    await saveCollage(record({ id: "older", updatedAt: 1_000 }));
    await saveCollage(record({ id: "newest", updatedAt: 9_000 }));
    await saveCollage(record({ id: "middle", updatedAt: 5_000 }));
    expect((await listCollages()).map((item) => item.id)).toEqual([
      "newest",
      "middle",
      "older",
    ]);
  });

  it("summarizes listed collages without their pieces", async () => {
    await saveCollage(
      record({ pieces: [piece(), piece({ id: "piece_2", z: 1 })] }),
    );
    const [entry] = await listCollages();
    assert(!isUnreadable(entry));
    expect(entry.pieceCount).toBe(2);
    expect(entry).not.toHaveProperty("pieces");
  });

  it("lists a damaged record instead of failing the whole listing", async () => {
    // One bad row must never hide the good ones or leave itself undeletable.
    await saveCollage(record({ id: "good", title: "a good one" }));
    await putRaw({
      id: "broken",
      title: "a broken one",
      updatedAt: 42,
      pieces: "not an array",
    });

    const listed = await listCollages();
    expect(listed).toHaveLength(2);
    const broken = listed.find((entry) => entry.id === "broken");
    assert(broken && isUnreadable(broken));
    expect(broken.title).toBe("a broken one");
    expect(broken.reason).toMatch(/pieces/);
    const good = listed.find((entry) => entry.id === "good");
    assert(good && !isUnreadable(good));
    expect(good.title).toBe("a good one");
  });

  it("deletes a damaged record like any other", async () => {
    await putRaw({ id: "broken", title: "gone soon", updatedAt: 1 });
    await deleteCollage("broken");
    expect(await listCollages()).toEqual([]);
  });

  it("deletes one collage and leaves the rest", async () => {
    await saveCollage(record({ id: "keep" }));
    await saveCollage(record({ id: "drop" }));
    await deleteCollage("drop");
    expect((await listCollages()).map((item) => item.id)).toEqual(["keep"]);
    expect(await loadCollage("drop")).toBeNull();
  });

  it("returns an empty list when nothing has been saved", async () => {
    expect(await listCollages()).toEqual([]);
  });
});
