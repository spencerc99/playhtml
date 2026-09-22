// ABOUTME: Covers folding a saved scraps export back into the local scrap store.
// ABOUTME: Guards whole-file validation, canonical dedup counting, and preserved capture fields.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IDBKeyRange as fakeIDBKeyRange,
  indexedDB as fakeIndexedDB,
} from "fake-indexeddb";
import { LocalEventStore } from "../storage/LocalEventStore";
import {
  ScrapImportError,
  readScrapExport,
  type ScrapImportIdentity,
} from "../storage/scrapImport";

const originalIndexedDB = globalThis.indexedDB;
const originalIDBKeyRange = globalThis.IDBKeyRange;
let stores: LocalEventStore[] = [];

const identity: ScrapImportIdentity = {
  pid: "pk_importer",
  sid: "sid_importer",
  timeZone: "America/Los_Angeles",
  viewportWidth: 1440,
  viewportHeight: 900,
};

function imageRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "image-1",
    key: "https://cdn.example.com/kettle.jpg",
    domain: "example.com",
    pageUrl: "https://example.com/kitchen",
    ts: 1787288971906,
    pageTitle: "A kitchen",
    faviconUrl: "https://example.com/favicon.ico",
    kind: "image",
    src: "https://cdn.example.com/kettle.jpg",
    alt: "A copper kettle",
    naturalWidth: 1280,
    naturalHeight: 720,
    ...overrides,
  };
}

function buttonRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "button-1",
    key: "18hurd",
    domain: "example.org",
    pageUrl: "https://example.org/read",
    ts: 1787288985540,
    pageTitle: "Something to read",
    kind: "button",
    text: "Read more",
    styles: { backgroundColor: "rgb(4, 5, 6)", color: "rgb(1, 2, 3)" },
    ...overrides,
  };
}

async function freshStore(): Promise<LocalEventStore> {
  await new Promise<void>((resolve) => {
    const request = fakeIndexedDB.deleteDatabase("collection_events_db");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  const store = new LocalEventStore();
  stores.push(store);
  return store;
}

async function storedElementEvents(store: LocalEventStore) {
  return store.queryByType("element");
}

describe("scraps export import", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { indexedDB: IDBFactory }).indexedDB =
      fakeIndexedDB;
    Object.defineProperty(globalThis, "IDBKeyRange", {
      value: fakeIDBKeyRange,
      configurable: true,
    });
    window.indexedDB = fakeIndexedDB;
    Object.defineProperty(window, "IDBKeyRange", {
      value: fakeIDBKeyRange,
      configurable: true,
    });
  });

  afterEach(async () => {
    for (const store of stores) {
      (store as unknown as { db: IDBDatabase | null }).db?.close();
    }
    stores = [];
    (globalThis as typeof globalThis & { indexedDB: IDBFactory }).indexedDB =
      originalIndexedDB;
    Object.defineProperty(globalThis, "IDBKeyRange", {
      value: originalIDBKeyRange,
      configurable: true,
    });
    window.indexedDB = originalIndexedDB;
    Object.defineProperty(window, "IDBKeyRange", {
      value: originalIDBKeyRange,
      configurable: true,
    });
  });

  it("preserves each record's capture fields and leaves absent ones absent", () => {
    const [image, button] = readScrapExport(
      { scraps: [imageRecord(), buttonRecord()] },
      identity,
    );

    expect(image.ts).toBe(1787288971906);
    expect(image.domain).toBe("example.com");
    expect(image.meta.url).toBe("https://example.com/kitchen");
    expect(image.type).toBe("element");
    expect(image.data).toEqual({
      kind: "image",
      src: "https://cdn.example.com/kettle.jpg",
      alt: "A copper kettle",
      naturalWidth: 1280,
      naturalHeight: 720,
      pageTitle: "A kitchen",
      faviconUrl: "https://example.com/favicon.ico",
    });
    // An older export carries no capture-time display size or content hash;
    // the import must not conjure them.
    expect(image.data).not.toHaveProperty("displayWidth");
    expect(image.data).not.toHaveProperty("contentHash");
    expect(image).not.toHaveProperty("normalizedUrl");

    expect(button.data).toEqual({
      kind: "button",
      text: "Read more",
      styles: { backgroundColor: "rgb(4, 5, 6)", color: "rgb(1, 2, 3)" },
      pageTitle: "Something to read",
    });
    expect(button.data).not.toHaveProperty("faviconUrl");
    expect(button.data).not.toHaveProperty("innerSvg");
  });

  it("carries the importing browser's identity, session, timezone, and viewport", () => {
    const [image] = readScrapExport({ scraps: [imageRecord()] }, identity);

    expect(image.meta).toEqual({
      pid: "pk_importer",
      sid: "sid_importer",
      url: "https://example.com/kitchen",
      vw: 1440,
      vh: 900,
      tz: "America/Los_Angeles",
    });
  });

  it("rejects the whole file on the first malformed record", () => {
    const file = {
      scraps: [imageRecord(), { ...buttonRecord(), styles: "not-styles" }],
    };

    expect(() => readScrapExport(file, identity)).toThrow(ScrapImportError);
    expect(() => readScrapExport(file, identity)).toThrow(
      "scraps export record 1 is missing its button styles",
    );
  });

  it("accepts the blank titles and button labels real pages produce", () => {
    const [image, button] = readScrapExport(
      {
        scraps: [
          imageRecord({ pageTitle: "" }),
          buttonRecord({ text: "", pageTitle: "" }),
        ],
      },
      identity,
    );

    expect(image.data.pageTitle).toBe("");
    expect(button.data).toMatchObject({ text: "", pageTitle: "" });
  });

  it("rejects a title that is absent rather than merely blank", () => {
    const { pageTitle: _omitted, ...untitled } = imageRecord();

    expect(() => readScrapExport({ scraps: [untitled] }, identity)).toThrow(
      "scraps export record 0 has a pageTitle that is not a string",
    );
  });

  it("names an unknown kind rather than skipping the record", () => {
    expect(() =>
      readScrapExport(
        { scraps: [{ ...imageRecord(), kind: "postcard" }] },
        identity,
      ),
    ).toThrow('scraps export record 0 has an unknown kind "postcard"');
  });

  it("rejects a file that is not a scraps export", () => {
    expect(() => readScrapExport({ events: [] }, identity)).toThrow(
      "scraps export is missing its scraps list",
    );
    expect(() => readScrapExport("nope", identity)).toThrow(
      "scraps export is not an object",
    );
  });

  it("leaves the store untouched when validation fails", async () => {
    const store = await freshStore();
    const good = readScrapExport({ scraps: [imageRecord()] }, identity);
    await store.addImportedEvents(good);
    expect(await storedElementEvents(store)).toHaveLength(1);

    expect(() =>
      readScrapExport(
        { scraps: [buttonRecord(), { ...imageRecord(), ts: "later" }] },
        identity,
      ),
    ).toThrow(ScrapImportError);

    const remaining = await storedElementEvents(store);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("image-1");
  });

  it("stores every new record and preserves its original timestamp", async () => {
    const store = await freshStore();
    const events = readScrapExport(
      { scraps: [imageRecord(), buttonRecord()] },
      identity,
    );

    const stored = await store.addImportedEvents(events);

    expect(stored).toHaveLength(2);
    const held = await storedElementEvents(store);
    expect(held.map((event) => event.ts).sort()).toEqual(
      [1787288971906, 1787288985540].sort(),
    );
  });

  it("skips records whose canonical key is already held and counts them", async () => {
    const store = await freshStore();
    const file = { scraps: [imageRecord(), buttonRecord()] };

    const first = await store.addImportedEvents(
      readScrapExport(file, identity),
    );
    expect(first).toHaveLength(2);

    // The same file again, with fresh event ids, is the same two scraps.
    const again = await store.addImportedEvents(
      readScrapExport(
        {
          scraps: [
            imageRecord({ id: "image-repeat" }),
            buttonRecord({ id: "button-repeat" }),
          ],
        },
        identity,
      ),
    );

    expect(again).toHaveLength(0);
    expect(await storedElementEvents(store)).toHaveLength(2);
  });

  it("keeps the same photo seen on another day as its own encounter", async () => {
    const store = await freshStore();
    await store.addImportedEvents(
      readScrapExport({ scraps: [imageRecord()] }, identity),
    );

    const anotherDay = await store.addImportedEvents(
      readScrapExport(
        {
          scraps: [
            imageRecord({
              id: "image-yesterday",
              ts: 1787288971906 - 86_400_000,
            }),
          ],
        },
        identity,
      ),
    );

    expect(anotherDay).toHaveLength(1);
    expect(await storedElementEvents(store)).toHaveLength(2);
  });
});
