// ABOUTME: Tests local event database storage, query, and aggregate behavior.
// ABOUTME: Guards hot paths, storage stats, and upload metadata handling in IndexedDB.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDBKeyRange as fakeIDBKeyRange,
  indexedDB as fakeIndexedDB,
} from "fake-indexeddb";
import {
  LocalEventStore,
  type DomainStatsAggregate,
} from "../storage/LocalEventStore";
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
  seedAggregate: Record<string, unknown> = { ...aggregate() },
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
    uniqueUrlCount: 1,
    activeDayCount: 0,
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
  it("fails with reload guidance instead of hanging when an upgrade is blocked", async () => {
    const existingConnection = await openVersion8Database();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createStore();

    await expect(store.getAllDomains()).rejects.toThrow(
      "Reload the extension and open a new tab.",
    );

    existingConnection.close();
    consoleError.mockRestore();
  });

  it("closes its connection when a newer database version is requested", async () => {
    const store = createStore();
    await store.getAllDomains();

    const upgradedDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = fakeIndexedDB.open(DB_NAME, 12);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    expect((store as unknown as { db: IDBDatabase | null }).db).toBeNull();
    upgradedDatabase.close();
  });

  it("updates bounded aggregate fields for non-navigation events", () => {
    const agg = aggregate();

    (LocalEventStore as any).applyEventsToAggregate(agg, [
      event("cursor-1", "cursor"),
    ]);

    expect(agg.uniqueUrlCount).toBe(1);
    expect(agg).not.toHaveProperty("uniqueUrls");
    expect(agg).not.toHaveProperty("processedNavIds");
    expect(agg.eventsByType.cursor).toBe(1);
    expect(agg.storageSizeBytes).toBeGreaterThan(0);
    expect(agg.firstVisit).toBe(1_000);
    expect(agg.lastVisit).toBe(1_000);
  });

  it("tracks exact URL counts without growing aggregate records", async () => {
    const store = createStore();
    const secondUrlEvent = {
      ...event("nav-2", "navigation"),
      meta: {
        ...event("nav-2", "navigation").meta,
        url: "https://example.com/other",
      },
      normalizedUrl: "https://example.com/other",
    };

    await store.addEvents([
      event("nav-1", "navigation"),
      secondUrlEvent,
      event("nav-3", "navigation"),
    ]);

    const [domainStats, globalStats] = await Promise.all([
      store.getSessionStats("example.com"),
      store.getGlobalStats(),
    ]);

    for (const stats of [domainStats, globalStats]) {
      expect(stats?.uniqueUrlCount).toBe(2);
      expect(stats).not.toHaveProperty("uniqueUrls");
      expect(stats).not.toHaveProperty("processedNavIds");
    }
  });

  it("does not count an upserted event twice in aggregates", async () => {
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

    await store.addEvents([focus, blur]);
    await store.addEvents([focus, blur]);

    const stats = await store.getSessionStats("example.com");

    expect(stats).toMatchObject({
      totalTimeMs: 6_000,
      sessionCount: 1,
      eventsByType: { navigation: 2 },
      uniqueUrlCount: 1,
    });
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

  it("restores active-day counts after a bulk import rebuilds domain stats", async () => {
    const store = createStore();
    const firstDay = Date.parse("2026-07-20T12:00:00-04:00");
    const secondDay = Date.parse("2026-07-21T12:00:00-04:00");

    await store.getAllDomains();
    await store.addRestoredEvents([
      {
        ...event("focus-first", "navigation"),
        ts: firstDay,
        data: { event: "focus" },
      },
      {
        ...event("focus-second", "navigation"),
        ts: secondDay,
        data: { event: "focus" },
      },
    ]);

    const [stats, days] = await Promise.all([
      store.getSessionStats("example.com"),
      store.getDomainDayHistory(["example.com"]),
    ]);

    expect(stats?.activeDayCount).toBe(2);
    expect(days.map((day) => day.localDayKey)).toEqual([
      "2026-07-20",
      "2026-07-21",
    ]);
  });

  it("tracks one active day per domain regardless of focus churn", async () => {
    const store = createStore();
    const firstDay = Date.parse("2026-07-20T12:00:00-04:00");
    const secondDay = Date.parse("2026-07-21T12:00:00-04:00");

    await store.addEvents([
      {
        ...event("focus-first", "navigation"),
        ts: firstDay,
        data: { event: "focus" },
      },
      {
        ...event("focus-again", "navigation"),
        ts: firstDay + 60_000,
        data: { event: "focus" },
      },
      {
        ...event("focus-next-day", "navigation"),
        ts: secondDay,
        data: { event: "focus" },
      },
    ]);

    const [stats, days] = await Promise.all([
      store.getSessionStats("example.com"),
      store.getDomainDayHistory(["example.com"]),
    ]);

    expect(stats?.activeDayCount).toBe(2);
    expect(days).toEqual([
      {
        domain: "example.com",
        localDayKey: "2026-07-20",
        firstVisitTs: firstDay,
        lastVisitTs: firstDay + 60_000,
      },
      {
        domain: "example.com",
        localDayKey: "2026-07-21",
        firstVisitTs: secondDay,
        lastVisitTs: secondDay,
      },
    ]);
  });
});

describe("LocalEventStore walking record events", () => {
  it("derives screen time from navigation events without reading cursor or viewport data", async () => {
    const store = createStore();
    await store.addEvents([
      {
        ...event("focus", "navigation"),
        ts: 1_000,
        data: { event: "focus" },
      },
      {
        ...event("cursor", "cursor"),
        ts: 2_000,
      },
      {
        ...event("viewport", "viewport"),
        ts: 3_000,
        data: { event: "scroll", scrollDistancePx: 500 },
      },
      {
        ...event("blur", "navigation"),
        ts: 6_000,
        data: { event: "blur" },
      },
    ]);

    await expect(
      store.getScreenTime({ startTs: 0, endTs: 10_000 }),
    ).resolves.toEqual({
      totalMs: 5_000,
      sessions: [
        {
          url: "https://example.com/page",
          focusTs: 1_000,
          blurTs: 6_000,
          durationMs: 5_000,
        },
      ],
    });
  });

  it("compresses interaction events into active browsing windows", async () => {
    const store = createStore();
    await store.addEvents([
      {
        ...event("cursor-first", "cursor"),
        ts: 1_000,
        data: { event: "move", x: 0.1, y: 0.1 },
      },
      {
        ...event("scroll-same-window", "viewport"),
        ts: 20_000,
        data: { event: "scroll", scrollDistancePx: 300 },
      },
      {
        ...event("keyboard-next-window", "keyboard"),
        ts: 35_000,
        data: { event: "typing", x: 0.5, y: 0.5 },
      },
      {
        ...event("resize-ignored", "viewport"),
        ts: 65_000,
        data: { event: "resize", width: 1_000, height: 800 },
      },
    ]);

    const result = await store.getWalkingRecordEvents({
      startTs: 0,
      endTs: 90_000,
    });

    expect(result.activity).toEqual([
      {
        url: "https://example.com/page",
        windowStarts: [0, 30_000],
      },
    ]);
  });

  it("keeps navigation events and samples cursors without losing measured distance", async () => {
    const store = createStore();
    const otherPage = {
      meta: {
        ...event("other-page", "cursor").meta,
        url: "https://example.com/other",
      },
      normalizedUrl: "https://example.com/other",
    };

    await store.addEvents([
      {
        ...event("navigation-1", "navigation"),
        ts: 1_000,
      },
      {
        ...event("cursor-1", "cursor"),
        ts: 2_000,
        data: { event: "move", x: 0.1, y: 0.2 },
      },
      {
        ...event("cursor-2", "cursor"),
        ts: 3_000,
        data: { event: "move", x: 0.2, y: 0.2 },
      },
      {
        ...event("viewport-1", "viewport"),
        ts: 4_000,
        data: { event: "scroll", scrollDistancePx: 400 },
      },
      {
        ...event("viewport-2", "viewport"),
        ts: 5_000,
        data: { event: "scroll", scrollDistancePx: 600 },
      },
      {
        ...event("cursor-other-page", "cursor"),
        ...otherPage,
        ts: 6_000,
        data: { event: "move", x: 0.5, y: 0.5 },
      },
      {
        ...event("cursor-next-window", "cursor"),
        ts: 5 * 60_000 + 2_000,
        data: { event: "move", x: 0.3, y: 0.2 },
      },
      {
        ...event("navigation-2", "navigation"),
        ...otherPage,
        ts: 5 * 60_000 + 3_000,
        data: { event: "focus" },
      },
    ]);

    const result = await store.getWalkingRecordEvents({
      startTs: 0,
      endTs: 10 * 60_000,
    });

    expect(result.events.map((storedEvent) => storedEvent.id)).toEqual([
      "navigation-1",
      "cursor-1",
      "cursor-other-page",
      "cursor-next-window",
      "navigation-2",
    ]);
    expect(result.cursorDistancePx).toBeCloseTo(102.4);
    expect(result.activity).toEqual([
      {
        url: "https://example.com/page",
        windowStarts: [0, 300_000],
      },
      {
        url: "https://example.com/other",
        windowStarts: [0],
      },
    ]);
  });

  it("requires an explicit walking-record range", async () => {
    const store = createStore();

    await expect(store.getWalkingRecordEvents({})).rejects.toThrow(
      "Walking record event bounds are required",
    );
  });

  it("returns simplified cursor paths from the exact selected page and session", async () => {
    const store = createStore();
    const cursor = (
      id: string,
      ts: number,
      x: number,
      y: number,
      url = "https://example.com/page",
    ): CollectionEvent => ({
      ...event(id, "cursor"),
      ts,
      data: { event: "move", x, y },
      meta: { ...event(id, "cursor").meta, url },
      normalizedUrl: url,
    });

    await store.addEvents([
      cursor("before", 500, 0, 0),
      cursor("first", 2_000, 0.1, 0.2),
      cursor("middle", 3_000, 0.2, 0.3),
      cursor("other-page", 4_000, 0.9, 0.9, "https://example.com/other"),
      cursor("after-gap", 9_001, 0.6, 0.4),
      cursor("last", 9_500, 0.8, 0.7),
      cursor("after", 12_000, 1, 1),
    ]);

    const movement = await store.getWalkingRecordMovement([
      {
        id: "day:2026-07-20",
        url: "https://example.com/page",
        startTs: 1_000,
        endTs: 10_000,
      },
    ]);

    expect(movement.traces).toEqual([
      {
        targetId: "day:2026-07-20",
        paths: [
          [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.3 }],
          [{ x: 0.6, y: 0.4 }, { x: 0.8, y: 0.7 }],
        ],
      },
    ]);
    expect(movement.landscapePaths).toHaveLength(2);
    expect(movement.landscapePaths[0].map((event) => event.id)).toEqual([
      "first",
      "middle",
    ]);
    expect(movement.landscapePaths[1].map((event) => event.id)).toEqual([
      "after-gap",
      "last",
    ]);
  });

  it("turns long movement into a bounded queue of consecutive landscape trails", async () => {
    const store = createStore();
    const cursorEvents = Array.from({ length: 300 }, (_, index) => ({
      ...event(`cursor-${index}`, "cursor"),
      ts: 1_000 + index * 100,
      data: {
        event: "move" as const,
        x: index / 300,
        y: index % 2 === 0 ? 0.25 : 0.75,
      },
    }));
    await store.addEvents(cursorEvents);

    const movement = await store.getWalkingRecordMovement([
      {
        id: "day:2026-07-20",
        url: "https://example.com/page",
        startTs: 1_000,
        endTs: 31_000,
      },
    ]);

    expect(movement.landscapePaths).toHaveLength(4);
    expect(
      movement.landscapePaths.every((path) => path.length <= 96),
    ).toBe(true);
    expect(movement.landscapePaths[0][0].id).toBe("cursor-0");
    expect(movement.landscapePaths.at(-1)?.at(-1)?.id).toBe("cursor-299");
    expect(movement.landscapePaths.at(-1)?.at(-1)?.ts).toBe(30_900);
  });
});

describe("LocalEventStore aggregate migrations", () => {
  it("migrates version 8 aggregates without losing retained history", async () => {
    const db = await openVersion8Database({
      ...aggregate(),
      totalTimeMs: 12_345,
      sessionCount: 7,
      uniqueUrlCount: undefined,
      uniqueUrls: ["https://example.com/stale"],
      processedNavIds: ["nav-stale"],
    });
    db.close();

    const store = createStore();
    await store.getSessionStats("example.com");
    await store.addEvents([
      {
        ...event("nav-after-upgrade", "navigation"),
        meta: {
          ...event("nav-after-upgrade", "navigation").meta,
          url: "https://example.com/stale",
        },
        normalizedUrl: "https://example.com/stale",
      },
    ]);
    const stats = await store.getSessionStats("example.com");

    expect(stats).toMatchObject({
      totalTimeMs: 12_345,
      sessionCount: 7,
      uniqueUrlCount: 1,
    });
    expect(stats).not.toHaveProperty("uniqueUrls");
    expect(stats).not.toHaveProperty("processedNavIds");
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
        sessionCount: 0,
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
      { ...event("scrap-first", "element"), ts: 1_000 },
      { ...event("scrap-last", "element"), ts: 3_000 },
      { ...event("scrap-middle", "element"), ts: 2_000 },
      { ...event("cursor-later", "cursor"), ts: 4_000 },
    ]);

    const events = await store.queryByType("element", { limit: 2 });

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
