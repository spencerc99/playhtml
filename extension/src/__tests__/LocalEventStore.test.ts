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
const STATS_BACKFILL_STATE_KEY = "__stats_backfill_state__";

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

async function openVersion8Database(
  seedAggregate: Partial<DomainStatsAggregate> = aggregate(),
): Promise<IDBDatabase> {
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
      statsStore.put(seedAggregate);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function openVersion7Database(seedEvents: CollectionEvent[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDB.open(DB_NAME, 7);
    request.onupgradeneeded = () => {
      const db = request.result;
      const eventStore = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      eventStore.createIndex("ts", "ts", { unique: false });
      eventStore.createIndex("type", "type", { unique: false });
      eventStore.createIndex("uploaded", "uploaded", { unique: false });
      eventStore.createIndex("domain", "domain", { unique: false });
      eventStore.createIndex("normalizedUrl", "normalizedUrl", { unique: false });
      db.createObjectStore(STATS_STORE_NAME, { keyPath: "key" });

      for (const seedEvent of seedEvents) {
        eventStore.put(seedEvent);
      }
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

async function putStatsRows(db: IDBDatabase, rows: unknown[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STATS_STORE_NAME], "readwrite");
    const statsStore = transaction.objectStore(STATS_STORE_NAME);
    for (const row of rows) {
      statsStore.put(row);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function createStore(): LocalEventStore {
  const store = new LocalEventStore();
  stores.push(store);
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

  it("rebuilds aggregates from unique events in chronological order after a bulk import", async () => {
    const store = createStore();
    const focus = {
      ...event("focus-event", "navigation"),
      ts: 1_000,
      data: { event: "focus" },
    };
    const blur = {
      ...event("blur-event", "navigation"),
      ts: 7_000,
      data: { event: "blur" },
    };

    await store.addRestoredEvents([blur, focus]);
    await store.addRestoredEvents([blur, focus]);

    const [domainStats, pageStats, globalStats] = await Promise.all([
      store.getSessionStats("example.com"),
      store.getSessionStats("example.com", "https://example.com/page"),
      store.getGlobalStats(),
    ]);

    for (const stats of [domainStats, pageStats, globalStats]) {
      expect(stats).toMatchObject({
        totalTimeMs: 6_000,
        sessionCount: 1,
        eventsByType: { navigation: 2 },
        firstVisit: 1_000,
        lastVisit: 7_000,
      });
    }
  });
});

describe("LocalEventStore aggregate migrations", () => {
  it("preserves version 8 stats aggregates when opening version 9", async () => {
    const db = await openVersion8Database({
      ...aggregate(),
      totalTimeMs: 12_345,
      sessionCount: 7,
      storageSizeBytes: undefined,
    });
    db.close();

    const store = createStore();
    const stats = await store.getSessionStats("example.com");

    expect(stats?.totalTimeMs).toBe(12_345);
    expect(stats?.sessionCount).toBe(7);
  });

  it("reports local raw storage stats when preserved version 8 aggregates do not have size data", async () => {
    const db = await openVersion8Database({
      ...aggregate(),
      storageSizeBytes: undefined,
    });
    await putSeedEvent(db, { ...event("cursor-1", "cursor"), ts: 2_000 });
    db.close();

    const store = createStore();
    const stats = await store.getStorageStats();

    expect(stats.totalEvents).toBe(1);
    expect(stats.estimatedSizeBytes).toBeGreaterThan(0);
    expect(stats.oldestEvent).toBe(2_000);
    expect(stats.newestEvent).toBe(2_000);
    expect(stats.countsByType).toEqual({ cursor: 1 });
  });

  it("lists domains from stats aggregates", async () => {
    const store = createStore();
    await store.addEvents([
      event("navigation-1", "navigation"),
      event("cursor-1", "cursor"),
    ]);

    const domains = await store.getAllDomains();

    expect(domains).toEqual([
      expect.objectContaining({
        domain: "example.com",
        eventCount: 2,
        totalTimeMs: 0,
        uniquePageCount: 1,
        eventCounts: { navigation: 1, cursor: 1 },
      }),
    ]);
  });

  it("waits for aggregate backfill before listing domains after older upgrades", async () => {
    const db = await openVersion7Database([
      event("navigation-1", "navigation"),
      event("cursor-1", "cursor"),
    ]);
    db.close();

    const store = createStore();
    const domains = await store.getAllDomains();

    expect(domains).toEqual([
      expect.objectContaining({
        domain: "example.com",
        eventCount: 2,
        uniquePageCount: 1,
        eventCounts: { navigation: 1, cursor: 1 },
      }),
    ]);
  });

  it("counts events queued during aggregate backfill exactly once", async () => {
    const queuedEvent = { ...event("queued-cursor", "cursor"), ts: 2_000 };
    const db = await openVersion7Database([
      { ...event("old-cursor", "cursor"), ts: 1_000 },
      queuedEvent,
    ]);
    db.close();

    const store = createStore();
    (store as any).queueEventsForStatsAfterBackfill([queuedEvent]);
    await store.ensureHistoricalStats();
    const stats = await store.getSessionStats("example.com");

    expect(stats?.eventsByType.cursor).toBe(2);
    expect(stats?.firstVisit).toBe(1_000);
    expect(stats?.lastVisit).toBe(2_000);
  });

  it("rebuilds aggregates when a previous backfill did not complete", async () => {
    const db = await openVersion7Database([
      { ...event("old-cursor", "cursor"), ts: 1_000 },
      { ...event("queued-cursor", "cursor"), ts: 2_000 },
    ]);
    db.close();

    const store = createStore();
    await store.ensureHistoricalStats();
    await putStatsRows((store as any).db, [
      {
        ...aggregate(),
        eventsByType: { cursor: 1 },
        firstVisit: 1_000,
        lastVisit: 1_000,
      },
      {
        key: STATS_BACKFILL_STATE_KEY,
        state: "running",
      },
    ]);
    (store as any).statsBackfillComplete = false;

    const domains = await store.getAllDomains();

    expect(domains).toEqual([
      expect.objectContaining({
        domain: "example.com",
        eventCount: 2,
        eventCounts: { cursor: 2 },
        firstVisit: 1_000,
        lastVisit: 2_000,
      }),
    ]);
  });
});

describe("LocalEventStore storage stats", () => {
  it("reads storage stats from retained local event rows", async () => {
    const store = createStore();
    await store.addEvents([
      { ...event("cursor-1", "cursor"), ts: 100 },
      { ...event("cursor-2", "cursor"), ts: 200 },
      { ...event("keyboard-1", "keyboard"), ts: 300 },
    ]);

    const stats = await store.getStorageStats();

    expect(stats).toMatchObject({
      totalEvents: 3,
      oldestEvent: 100,
      newestEvent: 300,
      countsByType: { cursor: 2, keyboard: 1 },
    });
    expect(stats.estimatedSizeBytes).toBeGreaterThan(0);
  });
});

describe("LocalEventStore pending uploads", () => {
  it("prunes old uploaded events while retaining old pending and recent events", async () => {
    const store = createStore();
    await store.addEvents([
      { ...event("old-uploaded", "cursor"), ts: 1_000 },
      { ...event("old-pending", "cursor"), ts: 2_000 },
      { ...event("recent-uploaded", "cursor"), ts: 5_000 },
    ]);
    await store.markEventsAsUploaded(["old-uploaded", "recent-uploaded"]);

    const deleted = await store.pruneUploadedEventsOlderThan(3_000);
    const remainingEvents = await store.getAllEvents();
    const pendingEvents = await store.getPendingEvents(10);

    expect(deleted).toBe(1);
    expect(remainingEvents.map((storedEvent) => storedEvent.id)).toEqual([
      "old-pending",
      "recent-uploaded",
    ]);
    expect(pendingEvents.map((storedEvent) => storedEvent.id)).toEqual([
      "old-pending",
    ]);
  });

  it("keeps aggregate session stats when old uploaded raw events are pruned", async () => {
    const store = createStore();
    await store.addEvents([
      {
        ...event("focus-event", "navigation"),
        ts: 1_000,
        data: { event: "focus" },
      },
      {
        ...event("blur-event", "navigation"),
        ts: 7_000,
        data: { event: "blur" },
      },
    ]);
    await store.markEventsAsUploaded(["focus-event", "blur-event"]);

    const before = await store.getSessionStats("example.com");
    const deleted = await store.pruneUploadedEventsOlderThan(10_000);
    const after = await store.getSessionStats("example.com");
    const remainingEvents = await store.getAllEvents();

    expect(before?.totalTimeMs).toBe(6_000);
    expect(deleted).toBe(2);
    expect(remainingEvents).toEqual([]);
    expect(after?.totalTimeMs).toBe(6_000);
    expect(after?.sessionCount).toBe(1);
  });

  it("reports storage bounds from retained raw events after pruning", async () => {
    const store = createStore();
    await store.addEvents([
      { ...event("old-uploaded", "cursor"), ts: 1_000 },
      { ...event("old-pending", "cursor"), ts: 2_000 },
      { ...event("recent-uploaded", "keyboard"), ts: 5_000 },
    ]);
    await store.markEventsAsUploaded(["old-uploaded", "recent-uploaded"]);

    await store.pruneUploadedEventsOlderThan(3_000);

    await expect(store.getStorageStats()).resolves.toMatchObject({
      totalEvents: 2,
      oldestEvent: 2_000,
      newestEvent: 5_000,
      countsByType: { cursor: 1, keyboard: 1 },
    });
  });

  it("filters all-event reads by multiple event types", async () => {
    const store = createStore();
    await store.addEvents([
      { ...event("cursor-event", "cursor"), ts: 1_000 },
      { ...event("keyboard-event", "keyboard"), ts: 2_000 },
      { ...event("navigation-event", "navigation"), ts: 3_000 },
    ]);

    const events = await store.getAllEvents({
      types: ["cursor", "navigation"],
      limit: 10,
    });

    expect(events.map((storedEvent) => storedEvent.id)).toEqual([
      "cursor-event",
      "navigation-event",
    ]);
  });

  it("queries one event type newest-first with a limit", async () => {
    const store = createStore();
    await store.addEvents([
      { ...event("scrap-first", "scrap"), ts: 1_000 },
      { ...event("scrap-last", "scrap"), ts: 3_000 },
      { ...event("scrap-middle", "scrap"), ts: 2_000 },
      { ...event("cursor-later", "cursor"), ts: 4_000 },
    ]);

    const events = await store.queryByType("scrap", { limit: 2 });

    expect(events.map((storedEvent) => storedEvent.id)).toEqual([
      "scrap-last",
      "scrap-middle",
    ]);
  });

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

  it("keeps a pending event pending when it is exported and imported", async () => {
    const store = createStore();

    await store.addEvents([event("offline-cursor", "cursor")]);
    const [exportedEvent] = await store.getAllEvents();
    await store.addImportedEvents([exportedEvent]);

    await expect(store.getPendingEvents(100)).resolves.toEqual([
      expect.objectContaining({ id: "offline-cursor" }),
    ]);
  });

  it("does not return trusted restored history as pending", async () => {
    const store = createStore();

    await store.addRestoredEvents([event("restored-cursor", "cursor")]);

    await expect(store.getPendingEvents(100)).resolves.toEqual([]);
    await expect(store.getAllEvents()).resolves.toEqual([
      expect.objectContaining({ id: "restored-cursor" }),
    ]);
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
