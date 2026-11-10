// ABOUTME: Round-trips collages, saved pictures and identity through an export file
// ABOUTME: into empty stores, the way moving to a new browser does, against a real IndexedDB.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as StructuredCloneableBlob } from "node:buffer";
import {
  IDBKeyRange as fakeIDBKeyRange,
  indexedDB as fakeIndexedDB,
} from "fake-indexeddb";
import type { CollectionEvent } from "@playhtml/extension-types";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import type { CollageRecord } from "../entrypoints/scraps/collageRecord";
import { loadCollage, saveCollage } from "../entrypoints/scraps/collageStore";
import {
  closeImageCopies,
  listCollagePins,
  pinCollageSources,
  readImageCopies,
  storeImageCopy,
} from "../storage/ScrapImageCopies";
import { gzipExport } from "../utils/dataTransfer";
import {
  readExportFiles,
  readExportHeader,
  type ExportItem,
} from "../utils/importStream";
import {
  exportedCollages,
  exportedImages,
  importCollage,
  importIdentity,
  importImage,
  picturesToExport,
  readableCollageIds,
} from "../utils/transferSections";

const saved: unknown[] = [];
vi.mock("../storage/playerIdentity", () => ({
  saveStoredPlayerIdentity: async (identity: unknown) => {
    saved.push(identity);
  },
}));

const originalIndexedDB = globalThis.indexedDB;
const originalIDBKeyRange = globalThis.IDBKeyRange;
const originalBlob = globalThis.Blob;

const SRC = "https://example.test/one.png";
const SCRAP_ONLY_SRC = "https://example.test/loose.png";

function blob(text: string, type: string): Blob {
  return new StructuredCloneableBlob([text], { type }) as unknown as Blob;
}

function collage(updatedAt: number): CollageRecord {
  return {
    id: "collage_1",
    title: "Moving day",
    createdAt: 5_000,
    updatedAt,
    frame: { width: 1500, height: 1000 },
    format: "postcard",
    paper: { color: "#fffdf9", grain: false },
    pieces: [
      {
        id: "piece_1",
        scrapId: "scrap_1",
        scrap: {
          id: "scrap_1",
          key: "image:one",
          kind: "image",
          src: SRC,
          naturalWidth: 100,
          naturalHeight: 80,
          pageTitle: "A page",
          domain: "example.test",
          pageUrl: "https://example.test/a",
          ts: 1_000,
        } as ScrapItem,
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        rotation: 12,
        z: 0,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        flipX: false,
        flipY: false,
      },
    ],
    preview: { drawn: true, image: blob("cover bytes", "image/png") },
  };
}

const you = {
  public: {
    publicKey: "pk_" + "ab".repeat(65),
    playerStyle: { colorPalette: ["#b49ae0"] },
  },
  privateKey: { kty: "EC", crv: "P-256", d: "secret" },
};

async function deleteDatabase(name: string) {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`${name} delete blocked`));
  });
}

async function emptyStores() {
  await closeImageCopies();
  await deleteDatabase("scrap_collages_db");
  await deleteDatabase("scrap_image_copies_db");
}

/** A file stand-in: jsdom's Blob cannot read its bytes back. */
function fileOf(bytes: Uint8Array) {
  return {
    size: bytes.byteLength,
    slice: (start: number, end: number) => ({
      arrayBuffer: async () => bytes.slice(start, end).buffer as ArrayBuffer,
    }),
  };
}

async function packUp(withYou: boolean): Promise<Uint8Array> {
  const pictures = await picturesToExport(false, true);
  const ids = await readableCollageIds();
  let served = false;
  const events = [
    { id: "e1", type: "navigation", ts: 1, data: {} },
    { id: "e2", type: "element", ts: 2, data: {} },
  ] as unknown as CollectionEvent[];
  const file = await gzipExport({
    exportedAt: 42,
    contents: { history: 1, scraps: 1, collages: ids.length, you: withYou },
    packedIn: "Chrome",
    readEventPage: async () => {
      if (served) return null;
      served = true;
      return events;
    },
    images: exportedImages(pictures),
    collages: exportedCollages(ids),
    identity: you.public as never,
    you: withYou ? (you as never) : null,
  });
  return new Uint8Array(await file.arrayBuffer());
}

async function bringIn(bytes: Uint8Array) {
  const events: string[] = [];
  const items: ExportItem[] = [];
  const results: string[] = [];
  await readExportFiles(
    [fileOf(bytes)],
    async (batch) => {
      events.push(...batch.map((event) => event.id));
    },
    async (item) => {
      items.push(item);
      if (item.section === "images") await importImage(item.value);
      if (item.section === "collages")
        results.push(await importCollage(item.value));
      if (item.section === "you") await importIdentity(item.value);
    },
  );
  return { events, items, results };
}

beforeEach(() => {
  globalThis.indexedDB = fakeIndexedDB;
  globalThis.IDBKeyRange = fakeIDBKeyRange;
  globalThis.Blob = StructuredCloneableBlob as unknown as typeof Blob;
  saved.length = 0;
});

afterEach(async () => {
  await emptyStores();
  globalThis.indexedDB = originalIndexedDB;
  globalThis.IDBKeyRange = originalIDBKeyRange;
  globalThis.Blob = originalBlob;
});

describe("moving collages, pictures and identity", () => {
  it("brings a collage and its pictures into a browser that has none", async () => {
    await saveCollage(collage(6_000));
    await pinCollageSources("collage_1", [SRC]);
    await storeImageCopy({
      src: SRC,
      hash: "hash_one",
      blob: blob("picture bytes", "image/webp"),
      form: "reduced",
      mimeType: "image/webp",
      width: 100,
      height: 80,
    });
    await storeImageCopy({
      src: SCRAP_ONLY_SRC,
      hash: "hash_loose",
      blob: blob("loose bytes", "image/webp"),
      form: "reduced",
      mimeType: "image/webp",
    });

    const bytes = await packUp(true);
    const header = await readExportHeader(fileOf(bytes));
    expect(header).toEqual({
      version: 1,
      exportedAt: 42,
      packedIn: "Chrome",
      contents: { history: 1, scraps: 1, collages: 1, you: true },
    });

    await emptyStores();
    const { events, items, results } = await bringIn(bytes);

    expect(events).toEqual(["e1", "e2"]);
    // Collages alone bring only the pictures they hold.
    expect(items.filter((item) => item.section === "images")).toHaveLength(1);
    expect(results).toEqual(["added"]);

    const back = await loadCollage("collage_1");
    expect(back?.title).toBe("Moving day");
    expect(back?.updatedAt).toBe(6_000);
    expect(await listCollagePins()).toEqual([
      { collageId: "collage_1", srcs: [SRC] },
    ]);
    const pictures = await readImageCopies([SRC, SCRAP_ONLY_SRC]);
    expect([...pictures.keys()]).toEqual([SRC]);
    expect(await pictures.get(SRC)!.text()).toBe("picture bytes");
    expect(saved).toEqual([you]);
  });

  it("keeps a collage changed here more recently, and leaves identity out unless chosen", async () => {
    await saveCollage(collage(6_000));
    const bytes = await packUp(false);
    await emptyStores();
    await saveCollage(collage(9_000));

    const { items, results } = await bringIn(bytes);

    expect(results).toEqual(["kept"]);
    expect((await loadCollage("collage_1"))?.updatedAt).toBe(9_000);
    expect(items.some((item) => item.section === "you")).toBe(false);
    expect(items.find((item) => item.section === "identity")?.value).toEqual(
      you.public,
    );
    expect(saved).toEqual([]);
  });
});
