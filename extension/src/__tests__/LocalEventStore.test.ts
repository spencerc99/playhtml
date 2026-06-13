// ABOUTME: Tests local event database storage, query, and aggregate behavior.
// ABOUTME: Guards hot paths, storage stats, and upload metadata handling in IndexedDB.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IDBKeyRange as fakeIDBKeyRange,
  indexedDB as fakeIndexedDB,
} from "fake-indexeddb";
import { LocalEventStore, type DomainStatsAggregate } from "../storage/LocalEventStore";
import type { CollectionEvent } from "../collectors/types";

const DB_NAME = "collection_events_db";
const STORE_NAME = "events";
const STATS_STORE_NAME = "domain_stats";

const originalIndexedDB = globalThis.indexedDB;
const originalIDBKeyRange = globalThis.IDBKeyRange;
let stores: LocalEventStore[] = [];

type StoredTestEvent = CollectionEvent & {
  uploaded?: boolean;
  uploadState?: string;
};

function setIndexedDBGlobals(): void {
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
}

function restoreIndexedDBGlobals(): void {
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
}

async function deleteEventDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB delete blocked"));
  });
}

async function waitForBackgroundDatabaseWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function openVersion8Database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDB.open(DB_NAME, 8);
    request.onupgradeneeded = () => {
      const db = request.result;
      const eventStore = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      eventStore.createIndex("ts", "ts", { unique: false });
      eventStore.createIndex("type", "type", { unique: false });
      eventStore.createIndex("uploaded", "uploaded", { unique: false });
      eventStore.createIndex("domain", "domain", { unique: false });
      eventStore.createIndex("normalizedUrl", "normalizedUrl", { unique: false });
      const statsStore = db.createObjectStore(STATS_STORE_NAME, { keyPath: "key" });
      statsStore.put(aggregate());
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putSeedEvent(db: IDBDatabase, seedEvent: CollectionEvent): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    transaction.objectStore(STORE_NAME).put(seedEvent);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function createStore(): LocalEventStore {
  const store = new LocalEventStore();
  stores.push(store);
  return store;
}

function createStoreWithGlobalStats(globalStats: unknown): LocalEventStore {
  const store = Object.create(LocalEventStore.prototype) as LocalEventStore;
  (store as any).isInitialized = true;
  (store as any).db = {
    transaction(storeNames: string[]) {
      expect(storeNames).toEqual([STATS_STORE_NAME]);
      return {
        objectStore(name: string) {
          expect(name).toBe(STATS_STORE_NAME);
          return {
            get(key: string) {
              expect(key).toBe("__global__");
              const request: any = {};
              queueMicrotask(() => {
                request.result = globalStats;
                request.onsuccess?.();
              });
              return request;
            },
          };
        },
      };
    },
  };
  return store;
}

function closeStores(): void {
  for (const store of stores) {
    (store as unknown as { db: IDBDatabase | null }).db?.close();
  }
  stores = [];
}

function aggregate(): DomainStatsAggregate {
  return {
    key: "example.com",
    domain: "example.com",
    totalTimeMs: 0,
    hourBuckets: new Array(24).fill(0),
    sessionCount: 0,
    pendingFocusTs: null,
    pendingFocusUrl: "",
    eventsByType: {},
    storageSizeBytes: 0,
    firstVisit: 0,
    lastVisit: 0,
    uniqueUrls: ["https://example.com/"],
    processedNavIds: ["nav-1"],
  };
}

function event(id: string, type: CollectionEvent["type"]): CollectionEvent {
  return {
    id,
    type,
    ts: 1_000,
    data: type === "navigation" ? { event: "focus" } : { event: "move" },
    meta: {
      pid: "pid",
      sid: "sid",
      url: "https://example.com/page",
      vw: 1024,
      vh: 768,
      tz: "America/New_York",
    },
    domain: "example.com",
    normalizedUrl: "https://example.com/page",
  };
}

function contentScriptEvent(id: string, type: CollectionEvent["type"]): CollectionEvent {
  const { domain, normalizedUrl, ...sourceEvent } = event(id, type);
  return sourceEvent;
}

beforeEach(async () => {
  setIndexedDBGlobals();
  await deleteEventDatabase();
});

afterEach(async () => {
  await waitForBackgroundDatabaseWork();
  closeStores();
  await deleteEventDatabase();
  restoreIndexedDBGlobals();
});

describe("LocalEventStore aggregates", () => {
  it("preserves URL and navigation ID arrays for non-navigation events", () => {
    const agg = aggregate();
    const uniqueUrls = agg.uniqueUrls;
    const processedNavIds = agg.processedNavIds;

    (LocalEventStore as any).applyEventsToAggregate(agg, [
      event("cursor-1", "cursor"),
    ]);

    expect(agg.uniqueUrls).toBe(uniqueUrls);
    expect(agg.processedNavIds).toBe(processedNavIds);
    expect(agg.eventsByType.cursor).toBe(1);
    expect(agg.storageSizeBytes).toBeGreaterThan(0);
    expect(agg.firstVisit).toBe(1_000);
    expect(agg.lastVisit).toBe(1_000);
  });

  it("tracks URLs and navigation IDs for navigation events", () => {
    const agg = aggregate();

    (LocalEventStore as any).applyEventsToAggregate(agg, [
      event("nav-2", "navigation"),
    ]);

    expect(agg.uniqueUrls).toContain("https://example.com/page");
    expect(agg.processedNavIds).toContain("nav-2");
    expect(agg.pendingFocusTs).toBe(1_000);
    expect(agg.pendingFocusUrl).toBe("https://example.com/page");
  });
});

describe("LocalEventStore storage stats", () => {
  it("reads storage stats from the global aggregate", async () => {
    const store = createStoreWithGlobalStats({
      key: "__global__",
      domain: "",
      totalTimeMs: 0,
      hourBuckets: new Array(24).fill(0),
      sessionCount: 0,
      pendingFocusTs: null,
      pendingFocusUrl: "",
      eventsByType: { cursor: 2, keyboard: 1 },
      storageSizeBytes: 4096,
      firstVisit: 100,
      lastVisit: 300,
      uniqueUrls: [],
      processedNavIds: [],
    });

    await expect(store.getStorageStats()).resolves.toEqual({
      totalEvents: 3,
      estimatedSizeBytes: 4096,
      oldestEvent: 100,
      newestEvent: 300,
      countsByType: { cursor: 2, keyboard: 1 },
    });
  });
});

describe("LocalEventStore pending uploads", () => {
  it("derives query indexes when storing content script events", async () => {
    const store = createStore();
    await store.addEvents([contentScriptEvent("cursor-indexed", "cursor")]);

    const domainEvents = await store.queryByDomain("example.com");
    const urlEvents = await store.queryByUrl("https://example.com/page?ignored=true#hash");

    expect(domainEvents.map((storedEvent) => storedEvent.id)).toEqual(["cursor-indexed"]);
    expect(urlEvents.map((storedEvent) => storedEvent.id)).toEqual(["cursor-indexed"]);
  });

  it("stores new events as pending when uploaded is missing", async () => {
    const store = createStore();
    const sourceEvent = event("cursor-pending", "cursor");
    await store.addEvents([sourceEvent]);

    const events = await store.getPendingEvents(100);

    expect(events.map((pendingEvent) => pendingEvent.id)).toEqual(["cursor-pending"]);
    expect((sourceEvent as StoredTestEvent).uploaded).toBeUndefined();
    expect((sourceEvent as StoredTestEvent).uploadState).toBeUndefined();
    expect((events[0] as StoredTestEvent).uploaded).toBeUndefined();
    expect((events[0] as StoredTestEvent).uploadState).toBeUndefined();
  });

  it("backfills existing events with missing uploaded flags as pending", async () => {
    const db = await openVersion8Database();
    const pendingEvent = event("migrated-pending", "cursor");
    const uploadedEvent = {
      ...event("already-uploaded", "cursor"),
      uploaded: true,
    } as CollectionEvent & { uploaded: boolean };

    await putSeedEvent(db, pendingEvent);
    await putSeedEvent(db, uploadedEvent);
    db.close();

    const store = createStore();
    const events = await store.getPendingEvents(100);

    expect(events.map((storedEvent) => storedEvent.id)).toEqual(["migrated-pending"]);
    expect((events[0] as StoredTestEvent).uploaded).toBeUndefined();
    expect((events[0] as StoredTestEvent).uploadState).toBeUndefined();
  });

  it("removes uploaded events from pending reads", async () => {
    const store = createStore();
    await store.addEvents([event("cursor-pending", "cursor")]);

    await store.markEventsAsUploaded(["cursor-pending"]);

    const pendingEvents = await store.getPendingEvents(100);
    const storedEvents = await store.getAllEvents();
    expect(pendingEvents).toEqual([]);
    expect((storedEvents[0] as StoredTestEvent).uploaded).toBeUndefined();
    expect((storedEvents[0] as StoredTestEvent).uploadState).toBeUndefined();
  });
});
