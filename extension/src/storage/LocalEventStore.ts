// ABOUTME: Local storage interface for querying collected events by domain
// ABOUTME: Provides domain-based queries for historical data visualization

import type { CollectionEvent, CollectionEventType, NavigationEventData, ViewportEventData } from "../collectors/types";
import { VERBOSE } from "../config";
import {
  normalizeUrl,
  extractDomain as extractDomainUtil,
} from "../utils/urlNormalization";

const DB_NAME = "collection_events_db";
const DB_VERSION = 9;
const STORE_NAME = "events";
const STATS_STORE_NAME = "domain_stats";
const STATS_BACKFILL_STATE_KEY = "__stats_backfill_state__";
const UPLOAD_STATE_PENDING = "pending";
const UPLOAD_STATE_UPLOADED = "uploaded";
const COLLECTION_EVENT_TYPES: CollectionEventType[] = [
  "cursor",
  "navigation",
  "viewport",
  "keyboard",
  "scrap",
];
const STORAGE_SIZE_SAMPLE_LIMIT = 200;

type UploadState = typeof UPLOAD_STATE_PENDING | typeof UPLOAD_STATE_UPLOADED;
type StatsBackfillState = "running" | "complete";

interface StoredCollectionEvent extends CollectionEvent {
  uploaded?: boolean;
  uploadState?: UploadState;
}

// Aggregate key for cross-domain totals (all browsing activity combined)
const GLOBAL_STATS_KEY = "__global__";

export interface QueryOptions {
  type?: CollectionEventType;
  types?: CollectionEventType[];
  limit?: number;
  startTs?: number;
  endTs?: number;
}

export interface DomainStats {
  domain: string;
  totalEvents: number;
  eventsByType: Record<CollectionEventType, number>;
  firstVisit: number;
  lastVisit: number;
}

export interface StorageStats {
  totalEvents: number;
  /** Approximate byte size (sum of JSON string lengths; ~1:1 for ASCII event data). Single stringify per event for perf. */
  estimatedSizeBytes: number;
  oldestEvent: number;
  newestEvent: number;
  countsByType: Record<string, number>;
}

export interface ScreenTimeSession {
  url: string;
  focusTs: number;
  blurTs: number;
  durationMs: number;
}

/**
 * Pre-computed aggregates, updated incrementally on each event.
 * Stored both at domain level (key = domain) and page level (key = domain::normalizedUrl).
 */
export interface DomainStatsAggregate {
  /** Lookup key: domain for domain-level, "domain::normalizedUrl" for page-level */
  key: string;
  domain: string;
  totalTimeMs: number;
  /** Total ms spent per hour-of-day (index 0 = midnight, 23 = 11pm) */
  hourBuckets: number[];
  sessionCount: number;
  /** Pending (unmatched) focus event — set on focus, cleared on blur/beforeunload */
  pendingFocusTs: number | null;
  pendingFocusUrl: string;
  /** Running event counts by type */
  eventsByType: Record<string, number>;
  /** Estimated serialized byte size for events represented by this aggregate. */
  storageSizeBytes: number;
  /** Earliest event timestamp */
  firstVisit: number;
  /** Latest event timestamp */
  lastVisit: number;
  // TODO: uniqueUrls and processedNavIds grow unboundedly on the __global__
  // aggregate (every URL/nav ID ever seen). Consider tracking just a count for
  // uniqueUrls, and capping or clearing processedNavIds after backfill completes.
  /** Set of unique URLs seen (stored as array for JSON serialization, domain-level only) */
  uniqueUrls: string[];
  /** Set of event IDs that have been processed for session stats (prevents double-counting) */
  processedNavIds: string[];
}

function domainStatsKey(domain: string): string {
  return domain;
}

function pageStatsKey(domain: string, normalizedUrl: string): string {
  return `${domain}::${normalizedUrl}`;
}

function getUploadState(event: StoredCollectionEvent): UploadState {
  return event.uploaded === true || event.uploadState === UPLOAD_STATE_UPLOADED
    ? UPLOAD_STATE_UPLOADED
    : UPLOAD_STATE_PENDING;
}

function prepareStoredEvent(event: CollectionEvent): StoredCollectionEvent {
  const storedEvent: StoredCollectionEvent = { ...event };
  storedEvent.uploadState = getUploadState(storedEvent);
  storedEvent.uploaded = storedEvent.uploadState === UPLOAD_STATE_UPLOADED;
  return storedEvent;
}

function toCollectionEvent(event: StoredCollectionEvent): CollectionEvent {
  const { uploaded, uploadState, ...collectionEvent } = event;
  return collectionEvent;
}

export interface ScreenTimeResult {
  totalMs: number;
  sessions: ScreenTimeSession[];
  totalScrollDistancePx: number;
}

/**
 * Extract domain from URL (matches frontend logic)
 * Removes 'www.' prefix and returns hostname
 * @deprecated Use extractDomainUtil from utils/urlNormalization instead
 */
function extractDomain(url: string | null): string {
  return extractDomainUtil(url);
}

/**
 * LocalEventStore provides domain-based querying of stored collection events
 * Works alongside EventBuffer for historical data access
 */
export class LocalEventStore {
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private statsBackfillPromise: Promise<void> | null = null;
  private statsBackfillComplete = false;
  private eventsPendingStatsAfterBackfill: CollectionEvent[] = [];
  private eventIdsPendingStatsAfterBackfill = new Set<string>();

  constructor() {
    this.init().catch(console.error);
  }

  /**
   * Initialize IndexedDB with domain index
   */
  private async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        this.initPromise = null;
        reject(request.error);
      };
      request.onblocked = () => {
        console.warn("[LocalEventStore] DB upgrade blocked by another connection");
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        if (VERBOSE) {
          console.log("[LocalEventStore] Initialized successfully");
        }
        this.initPromise = null;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;

        // Create object store if it doesn't exist (v1)
        let store: IDBObjectStore;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("ts", "ts", { unique: false });
          store.createIndex("type", "type", { unique: false });
        } else {
          const transaction = (event.target as IDBOpenDBRequest).transaction!;
          store = transaction.objectStore(STORE_NAME);
        }

        // Add url index on raw meta.url (v2, dropped in v5)
        if (oldVersion < 2) {
          if (!store.indexNames.contains("url")) {
            store.createIndex("url", "meta.url", { unique: false });
            if (VERBOSE) {
              console.log("[LocalEventStore] Added url index");
            }
          }
        }

        // Add uploaded index to track which events have been synced (v3)
        if (oldVersion < 3) {
          if (!store.indexNames.contains("uploaded")) {
            store.createIndex("uploaded", "uploaded", { unique: false });
            if (VERBOSE) {
              console.log("[LocalEventStore] Added uploaded index");
            }
          }
        }

        // Add domain index for fast domain-scoped queries (v4)
        if (oldVersion < 4) {
          if (!store.indexNames.contains("domain")) {
            store.createIndex("domain", "domain", { unique: false });
            if (VERBOSE) {
              console.log("[LocalEventStore] Added domain index");
            }
          }
        }

        // Replace raw url index with normalizedUrl index (v5)
        if (oldVersion < 5) {
          // Drop the old url index (indexed raw meta.url which was never queried)
          if (store.indexNames.contains("url")) {
            store.deleteIndex("url");
            if (VERBOSE) {
              console.log("[LocalEventStore] Removed old url index");
            }
          }
          if (!store.indexNames.contains("normalizedUrl")) {
            store.createIndex("normalizedUrl", "normalizedUrl", { unique: false });
            if (VERBOSE) {
              console.log("[LocalEventStore] Added normalizedUrl index");
            }
          }
        }

        // Backfill domain and normalizedUrl fields on existing events
        if (oldVersion < 5) {
          const tx = (event.target as IDBOpenDBRequest).transaction!;
          const objStore = tx.objectStore(STORE_NAME);
          const backfillReq = objStore.openCursor();
          backfillReq.onsuccess = () => {
            const cursor = backfillReq.result;
            if (cursor) {
              const evt = cursor.value;
              let updated = false;
              if (!evt.domain && evt.meta?.url) {
                evt.domain = extractDomain(evt.meta.url);
                updated = true;
              }
              if (!evt.normalizedUrl && evt.meta?.url) {
                evt.normalizedUrl = normalizeUrl(evt.meta.url);
                updated = true;
              }
              if (updated) cursor.update(evt);
              cursor.continue();
            }
          };
        }

        // v6: create domain_stats store (keyPath: "domain")
        // v7: recreate with keyPath: "key" to support both domain and page-level aggregates
        // v8: force rebuild to populate page-level + global aggregates added after v7
        if (oldVersion < 8) {
          if (db.objectStoreNames.contains(STATS_STORE_NAME)) {
            db.deleteObjectStore(STATS_STORE_NAME);
          }
          db.createObjectStore(STATS_STORE_NAME, { keyPath: "key" });
          if (VERBOSE) {
            console.log("[LocalEventStore] Created domain_stats store (keyPath: key)");
          }
        } else if (!db.objectStoreNames.contains(STATS_STORE_NAME)) {
          db.createObjectStore(STATS_STORE_NAME, { keyPath: "key" });
        }

        if (oldVersion < 9) {
          if (store.indexNames.contains("uploaded")) {
            store.deleteIndex("uploaded");
          }
          if (!store.indexNames.contains("uploadState")) {
            store.createIndex("uploadState", "uploadState", { unique: false });
          }

          const tx = (event.target as IDBOpenDBRequest).transaction!;
          const objStore = tx.objectStore(STORE_NAME);
          const backfillReq = objStore.openCursor();
          backfillReq.onsuccess = () => {
            const cursor = backfillReq.result;
            if (cursor) {
              const evt = cursor.value as StoredCollectionEvent;
              const nextState = getUploadState(evt);
              if (
                evt.uploadState !== nextState ||
                evt.uploaded !== (nextState === UPLOAD_STATE_UPLOADED)
              ) {
                evt.uploadState = nextState;
                evt.uploaded = nextState === UPLOAD_STATE_UPLOADED;
                cursor.update(evt);
              }
              cursor.continue();
            }
          };
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Ensure database is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }
  }

  private async ensureSessionStatsBackfilled(): Promise<void> {
    if (this.statsBackfillComplete) return;

    if (!this.statsBackfillPromise) {
      this.statsBackfillPromise = this.backfillSessionStats()
        .then(() => this.flushEventsPendingStatsAfterBackfill())
        .then(() => this.writeStatsBackfillState("complete"))
        .then(() => {
          this.statsBackfillComplete = true;
        })
        .finally(() => {
          this.statsBackfillPromise = null;
        });
    }

    return this.statsBackfillPromise;
  }

  private async canUpdateStatsIncrementally(): Promise<boolean> {
    if (this.statsBackfillComplete) return true;
    if (this.statsBackfillPromise) return false;

    if (!this.db) {
      throw new Error("Database not initialized");
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [STORE_NAME, STATS_STORE_NAME],
        "readonly",
      );
      const eventStore = transaction.objectStore(STORE_NAME);
      const statsStore = transaction.objectStore(STATS_STORE_NAME);
      const eventCountRequest = eventStore.count();
      const statsCountRequest = statsStore.count();
      const stateRequest = statsStore.get(STATS_BACKFILL_STATE_KEY);
      let eventCount = 0;
      let statsCount = 0;
      let state: StatsBackfillState | null = null;
      let pendingRequests = 3;

      const complete = () => {
        pendingRequests--;
        if (pendingRequests > 0) return;

        const canUpdate =
          state === "complete" ||
          (state === null && (statsCount > 0 || eventCount === 0));
        if (canUpdate) {
          this.statsBackfillComplete = true;
        }
        resolve(canUpdate);
      };

      eventCountRequest.onsuccess = () => {
        eventCount = eventCountRequest.result;
        complete();
      };
      statsCountRequest.onsuccess = () => {
        statsCount = statsCountRequest.result;
        complete();
      };
      stateRequest.onsuccess = () => {
        const result = stateRequest.result as
          | { state?: StatsBackfillState }
          | undefined;
        state =
          result?.state === "running" || result?.state === "complete"
            ? result.state
            : null;
        complete();
      };
      eventCountRequest.onerror = () => reject(eventCountRequest.error);
      statsCountRequest.onerror = () => reject(statsCountRequest.error);
      stateRequest.onerror = () => reject(stateRequest.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async ensureHistoricalStats(): Promise<void> {
    await this.ensureInitialized();
    await this.ensureSessionStatsBackfilled();
  }

  private queueEventsForStatsAfterBackfill(events: CollectionEvent[]): void {
    for (const event of events) {
      if (this.eventIdsPendingStatsAfterBackfill.has(event.id)) continue;
      this.eventIdsPendingStatsAfterBackfill.add(event.id);
      this.eventsPendingStatsAfterBackfill.push(event);
    }
  }

  private removeEventsQueuedForStatsAfterBackfill(events: CollectionEvent[]): void {
    const idsToRemove = new Set(events.map((event) => event.id));
    this.eventsPendingStatsAfterBackfill =
      this.eventsPendingStatsAfterBackfill.filter((event) => {
        if (!idsToRemove.has(event.id)) return true;
        this.eventIdsPendingStatsAfterBackfill.delete(event.id);
        return false;
      });
  }

  private async flushEventsPendingStatsAfterBackfill(): Promise<void> {
    while (this.eventsPendingStatsAfterBackfill.length > 0) {
      const events = this.eventsPendingStatsAfterBackfill;
      this.eventsPendingStatsAfterBackfill = [];
      this.eventIdsPendingStatsAfterBackfill.clear();

      await this.updateDomainStats(
        events,
        LocalEventStore.groupEventsByDomain(events),
      );
    }
  }

  private async writeStatsBackfillState(state: StatsBackfillState): Promise<void> {
    if (!this.db) return;

    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction([STATS_STORE_NAME], "readwrite");
      const statsStore = transaction.objectStore(STATS_STORE_NAME);
      statsStore.put({
        key: STATS_BACKFILL_STATE_KEY,
        state,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * One-time backfill: compute session aggregates from existing navigation events.
   * Skips if domain_stats already has data (idempotent).
   */
  private async backfillSessionStats(): Promise<void> {
    if (!this.db) return;

    const backfillState = await new Promise<{
      state: StatsBackfillState | null;
      statsCount: number;
    }>((resolve, reject) => {
      const tx = this.db!.transaction([STATS_STORE_NAME], "readonly");
      const store = tx.objectStore(STATS_STORE_NAME);
      const countReq = store.count();
      const stateReq = store.get(STATS_BACKFILL_STATE_KEY);
      let statsCount = 0;
      let state: StatsBackfillState | null = null;
      let pendingRequests = 2;

      const complete = () => {
        pendingRequests--;
        if (pendingRequests > 0) return;
        resolve({ state, statsCount });
      };

      countReq.onsuccess = () => {
        statsCount = countReq.result;
        complete();
      };
      stateReq.onsuccess = () => {
        const result = stateReq.result as
          | { state?: StatsBackfillState }
          | undefined;
        state =
          result?.state === "running" || result?.state === "complete"
            ? result.state
            : null;
        complete();
      };
      countReq.onerror = () => reject(countReq.error);
      stateReq.onerror = () => reject(stateReq.error);
    });

    if (
      backfillState.state === "complete" ||
      (backfillState.state === null && backfillState.statsCount > 0)
    ) {
      return;
    }

    await this.rebuildSessionStats();
  }

  private async rebuildSessionStats(): Promise<void> {
    if (!this.db) return;

    await this.writeStatsBackfillState("running");

    if (VERBOSE) {
      console.log("[LocalEventStore] Starting domain stats backfill...");
    }

    // Walk ALL events to build complete aggregates (counts, timestamps, URLs, sessions)
    const allEvents = await new Promise<CollectionEvent[]>((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const events: CollectionEvent[] = [];
      const req = store.openCursor();

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const evt = toCollectionEvent(cursor.value as StoredCollectionEvent);
          if (!this.eventIdsPendingStatsAfterBackfill.has(evt.id)) {
            events.push(evt);
          }
          cursor.continue();
        } else {
          resolve(events);
        }
      };
      req.onerror = () => reject(req.error);
    });

    // Group events by aggregate key (global + domain-level + page-level)
    const keyToEvents = new Map<string, { domain: string; events: CollectionEvent[] }>();

    // Global aggregate: all events regardless of domain
    keyToEvents.set(GLOBAL_STATS_KEY, { domain: "", events: [] });

    for (const evt of allEvents) {
      keyToEvents.get(GLOBAL_STATS_KEY)!.events.push(evt);

      const dom = (evt as any).domain || extractDomain(evt.meta?.url);
      if (!dom) continue;

      // Domain-level
      const dKey = domainStatsKey(dom);
      if (!keyToEvents.has(dKey)) {
        keyToEvents.set(dKey, { domain: dom, events: [] });
      }
      keyToEvents.get(dKey)!.events.push(evt);

      // Page-level
      const nUrl = (evt as any).normalizedUrl || normalizeUrl(evt.meta?.url ?? "");
      if (nUrl) {
        const pKey = pageStatsKey(dom, nUrl);
        if (!keyToEvents.has(pKey)) {
          keyToEvents.set(pKey, { domain: dom, events: [] });
        }
        keyToEvents.get(pKey)!.events.push(evt);
      }
    }

    // Compute and write aggregates
    const tx = this.db!.transaction([STATS_STORE_NAME], "readwrite");
    const statsStore = tx.objectStore(STATS_STORE_NAME);
    statsStore.clear();

    for (const [key, { domain, events }] of keyToEvents) {
      const agg = LocalEventStore.emptyAggregate(key, domain);
      // Sort events by timestamp so session pairing works correctly
      events.sort((a, b) => a.ts - b.ts);
      LocalEventStore.applyEventsToAggregate(agg, events);
      statsStore.put(agg);
    }
    statsStore.put({
      key: STATS_BACKFILL_STATE_KEY,
      state: "running",
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    if (VERBOSE) {
      console.log(
        `[LocalEventStore] Backfilled domain stats for ${keyToEvents.size} keys`,
      );
    }
  }

  /**
   * Query events by domain (extracted from meta.url)
   */
  async queryByDomain(
    domain: string,
    options: QueryOptions = {},
  ): Promise<CollectionEvent[]> {
    await this.ensureInitialized();

    if (VERBOSE) console.log(`[LocalEventStore] Querying domain: ${domain}`, options);

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const domainIndex = store.index("domain");

      const events: CollectionEvent[] = [];
      const keyRange = IDBKeyRange.only(domain);
      const request = domainIndex.openCursor(keyRange);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as StoredCollectionEvent;

          let include = true;
          if (options.type && evt.type !== options.type) include = false;
          if (options.startTs && evt.ts < options.startTs) include = false;
          if (options.endTs && evt.ts > options.endTs) include = false;

          if (include) {
            events.push(toCollectionEvent(evt));
          }

          if (options.limit && events.length >= options.limit) {
            resolve(events);
            return;
          }

          cursor.continue();
        } else {
          events.sort((a, b) => a.ts - b.ts);
          if (VERBOSE) console.log(
            `[LocalEventStore] Query complete: ${events.length} events for ${domain}`,
          );
          resolve(events);
        }
      };

      request.onerror = () => {
        console.error("[LocalEventStore] Query error:", request.error);
        reject(request.error);
      };
    });
  }

  async queryByType(
    type: CollectionEventType,
    options: Pick<QueryOptions, "limit" | "startTs" | "endTs"> = {},
  ): Promise<CollectionEvent[]> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const typeIndex = store.index("type");
      const request = typeIndex.openCursor(IDBKeyRange.only(type));
      const events: CollectionEvent[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) {
          events.sort((a, b) => b.ts - a.ts);
          resolve(
            options.limit === undefined ? events : events.slice(0, options.limit),
          );
          return;
        }

        const storedEvent = cursor.value as StoredCollectionEvent;
        const afterStart =
          options.startTs === undefined || storedEvent.ts >= options.startTs;
        const beforeEnd =
          options.endTs === undefined || storedEvent.ts <= options.endTs;
        if (afterStart && beforeEnd) {
          events.push(toCollectionEvent(storedEvent));
        }
        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Query events by URL (normalized - strips query params and hash)
   * Uses the normalizedUrl index for direct key lookup
   */
  async queryByUrl(
    url: string,
    options: QueryOptions = {},
  ): Promise<CollectionEvent[]> {
    await this.ensureInitialized();

    const normalizedUrl = normalizeUrl(url);

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const urlIndex = store.index("normalizedUrl");

      const events: CollectionEvent[] = [];
      const keyRange = IDBKeyRange.only(normalizedUrl);
      const request = urlIndex.openCursor(keyRange);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as StoredCollectionEvent;

          let include = true;
          if (options.type && evt.type !== options.type) include = false;
          if (options.startTs && evt.ts < options.startTs) include = false;
          if (options.endTs && evt.ts > options.endTs) include = false;

          if (include) {
            events.push(toCollectionEvent(evt));
          }

          if (options.limit && events.length >= options.limit) {
            resolve(events);
            return;
          }

          cursor.continue();
        } else {
          events.sort((a, b) => a.ts - b.ts);
          resolve(events);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get aggregate stats for a domain
   */
  async getDomainStats(domain: string): Promise<DomainStats> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const domainIndex = store.index("domain");

      let totalEvents = 0;
      const eventsByType: Record<string, number> = {};
      let firstVisit = Infinity;
      let lastVisit = 0;

      const keyRange = IDBKeyRange.only(domain);
      const request = domainIndex.openCursor(keyRange);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as StoredCollectionEvent;
          totalEvents++;
          eventsByType[evt.type] = (eventsByType[evt.type] || 0) + 1;
          firstVisit = Math.min(firstVisit, evt.ts);
          lastVisit = Math.max(lastVisit, evt.ts);
          cursor.continue();
        } else {
          resolve({
            domain,
            totalEvents,
            eventsByType: eventsByType as Record<CollectionEventType, number>,
            firstVisit: firstVisit === Infinity ? 0 : firstVisit,
            lastVisit,
          });
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Read pre-computed stats from the domain_stats store (O(1) lookup).
   * Pass normalizedUrl to get page-level stats; omit for domain-level.
   */
  async getSessionStats(
    domain: string,
    normalizedUrl?: string,
  ): Promise<DomainStatsAggregate | null> {
    await this.ensureInitialized();
    await this.ensureSessionStatsBackfilled();

    const key = normalizedUrl
      ? pageStatsKey(domain, normalizedUrl)
      : domainStatsKey(domain);

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STATS_STORE_NAME], "readonly");
      const statsStore = transaction.objectStore(STATS_STORE_NAME);
      const request = statsStore.get(key);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Read the global (all-domains) aggregate from the domain_stats store (O(1) lookup).
   */
  async getGlobalStats(): Promise<DomainStatsAggregate | null> {
    await this.ensureInitialized();
    await this.ensureSessionStatsBackfilled();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STATS_STORE_NAME], "readonly");
      const statsStore = transaction.objectStore(STATS_STORE_NAME);
      const request = statsStore.get(GLOBAL_STATS_KEY);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Read all page-level aggregates for a domain from the domain_stats store.
   * Page keys use the format "domain::normalizedUrl", so we scan the key range
   * ["domain::", "domain::\uffff") to find them.
   */
  async getPageStats(domain: string): Promise<DomainStatsAggregate[]> {
    await this.ensureInitialized();
    await this.ensureSessionStatsBackfilled();

    const prefix = `${domain}::`;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STATS_STORE_NAME], "readonly");
      const statsStore = transaction.objectStore(STATS_STORE_NAME);
      const range = IDBKeyRange.bound(prefix, prefix + "\uffff", false, false);
      const results: DomainStatsAggregate[] = [];
      const request = statsStore.openCursor(range);

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          results.push(cursor.value as DomainStatsAggregate);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all domains with stored events
   */
  async getAllDomains(): Promise<
    Array<{
      domain: string;
      eventCount: number;
      lastVisit: number;
      firstVisit: number;
      totalTimeMs: number;
      uniquePageCount: number;
      eventCounts: Record<string, number>;
    }>
  > {
    await this.ensureInitialized();
    await this.ensureSessionStatsBackfilled();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STATS_STORE_NAME], "readonly");
      const statsStore = transaction.objectStore(STATS_STORE_NAME);
      const request = statsStore.openCursor();
      const domains: Array<{
        domain: string;
        eventCount: number;
        lastVisit: number;
        firstVisit: number;
        totalTimeMs: number;
        uniquePageCount: number;
        eventCounts: Record<string, number>;
      }> = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const aggregate = cursor.value as DomainStatsAggregate;
          if (
            aggregate.key !== GLOBAL_STATS_KEY &&
            aggregate.domain &&
            !aggregate.key.includes("::")
          ) {
            const eventCounts = aggregate.eventsByType ?? {};
            const eventCount = Object.values(eventCounts).reduce(
              (sum, count) => sum + count,
              0,
            );
            domains.push({
              domain: aggregate.domain,
              eventCount,
              lastVisit: aggregate.lastVisit,
              firstVisit: aggregate.firstVisit,
              totalTimeMs: aggregate.totalTimeMs,
              uniquePageCount: aggregate.uniqueUrls?.length ?? 0,
              eventCounts,
            });
          }

          cursor.continue();
        } else {
          domains.sort((a, b) => b.lastVisit - a.lastVisit);
          resolve(domains);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get retained raw-event storage stats.
   */
  async getStorageStats(): Promise<StorageStats> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const tsIndex = store.index("ts");
      const typeIndex = store.index("type");
      const countsByType: Record<string, number> = {};
      let totalEvents = 0;
      let oldestEvent = 0;
      let newestEvent = 0;
      let sampleCount = 0;
      let sampleSizeBytes = 0;
      let pendingRequests = 4 + COLLECTION_EVENT_TYPES.length;
      let settled = false;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const complete = () => {
        pendingRequests--;
        if (pendingRequests > 0 || settled) return;

        settled = true;
        resolve({
          totalEvents,
          estimatedSizeBytes:
            sampleCount > 0
              ? Math.round((sampleSizeBytes / sampleCount) * totalEvents)
              : 0,
          oldestEvent,
          newestEvent,
          countsByType,
        });
      };

      const countRequest = store.count();
      countRequest.onsuccess = () => {
        totalEvents = countRequest.result;
        complete();
      };
      countRequest.onerror = () => fail(countRequest.error);

      const oldestRequest = tsIndex.openCursor();
      oldestRequest.onsuccess = () => {
        oldestEvent =
          (oldestRequest.result?.value as StoredCollectionEvent | undefined)?.ts ?? 0;
        complete();
      };
      oldestRequest.onerror = () => fail(oldestRequest.error);

      const newestRequest = tsIndex.openCursor(null, "prev");
      newestRequest.onsuccess = () => {
        newestEvent =
          (newestRequest.result?.value as StoredCollectionEvent | undefined)?.ts ?? 0;
        complete();
      };
      newestRequest.onerror = () => fail(newestRequest.error);

      const sampleRequest = store.openCursor();
      sampleRequest.onsuccess = () => {
        const cursor = sampleRequest.result;
        if (cursor && sampleCount < STORAGE_SIZE_SAMPLE_LIMIT) {
          sampleCount++;
          sampleSizeBytes += JSON.stringify(cursor.value).length;
          cursor.continue();
          return;
        }

        complete();
      };
      sampleRequest.onerror = () => fail(sampleRequest.error);

      for (const eventType of COLLECTION_EVENT_TYPES) {
        const typeCountRequest = typeIndex.count(IDBKeyRange.only(eventType));
        typeCountRequest.onsuccess = () => {
          if (typeCountRequest.result > 0) {
            countsByType[eventType] = typeCountRequest.result;
          }
          complete();
        };
        typeCountRequest.onerror = () => fail(typeCountRequest.error);
      }

      transaction.onerror = () => fail(transaction.error);
    });
  }

  /**
   * Get all events across all domains, sorted by timestamp ascending
   */
  async getAllEvents(options: QueryOptions = {}): Promise<CollectionEvent[]> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const tsIndex = store.index("ts");

      // Build a key range from startTs/endTs if provided
      let range: IDBKeyRange | null = null;
      if (options.startTs && options.endTs) {
        range = IDBKeyRange.bound(options.startTs, options.endTs);
      } else if (options.startTs) {
        range = IDBKeyRange.lowerBound(options.startTs);
      } else if (options.endTs) {
        range = IDBKeyRange.upperBound(options.endTs);
      }

      // When limited without a date range, iterate newest-first so we
      // return the most recent events rather than the oldest.
      const useReverse = !!options.limit && !range;
      const direction: IDBCursorDirection = useReverse ? "prev" : "next";
      const request = tsIndex.openCursor(range, direction);

      const events: CollectionEvent[] = [];
      const typeSet = options.types ? new Set(options.types) : null;

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as CollectionEvent;
          let include = true;

          if (options.type && evt.type !== options.type) include = false;
          if (typeSet && !typeSet.has(evt.type)) include = false;

          if (include) {
            events.push(toCollectionEvent(evt));
            if (options.limit && events.length >= options.limit) {
              events.sort((a, b) => a.ts - b.ts);
              resolve(events);
              return;
            }
          }

          cursor.continue();
        } else {
          events.sort((a, b) => a.ts - b.ts);
          resolve(events);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Count events grouped by calendar day (YYYY-MM-DD) across all domains.
   * Uses the ts index to iterate chronologically without loading full event objects.
   */
  async countEventsByDay(): Promise<Map<string, number>> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const tsIndex = store.index("ts");
      const request = tsIndex.openKeyCursor();

      const counts = new Map<string, number>();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursor>).result;
        if (cursor) {
          // Use local timezone so day labels match local midnight boundaries
          const d = new Date(cursor.key as number);
          const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          counts.set(day, (counts.get(day) ?? 0) + 1);
          cursor.continue();
        } else {
          resolve(counts);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Compute screen time by pairing focus→blur navigation events.
   * Also sums scroll distance from viewport events.
   *
   * Optional domain/url filter via QueryOptions.type is ignored here since
   * navigation events are what drive the session calculation; pass startTs/endTs
   * to restrict the time window.
   */
  async getScreenTime(options: Pick<QueryOptions, 'startTs' | 'endTs'> = {}): Promise<ScreenTimeResult> {
    await this.ensureInitialized();

    // Pull all navigation events (focus/blur) and viewport scroll events in one pass
    const navEvents = await this.getAllEvents({ type: 'navigation', ...options });
    const viewportEvents = await this.getAllEvents({ type: 'viewport', ...options });

    // Pair focus → blur into sessions
    const sessions: ScreenTimeSession[] = [];
    let pendingFocus: { ts: number; url: string } | null = null;

    for (const evt of navEvents) {
      const d = evt.data as NavigationEventData;
      if (d.event === 'focus') {
        pendingFocus = { ts: evt.ts, url: evt.meta.url };
      } else if ((d.event === 'blur' || d.event === 'beforeunload') && pendingFocus) {
        const durationMs = evt.ts - pendingFocus.ts;
        // Discard sessions under 1s (noise) or over 8h (forgot to close tab)
        if (durationMs >= 1000 && durationMs <= 8 * 60 * 60 * 1000) {
          sessions.push({
            url: pendingFocus.url,
            focusTs: pendingFocus.ts,
            blurTs: evt.ts,
            durationMs,
          });
        }
        pendingFocus = null;
      }
    }

    const totalMs = sessions.reduce((sum, s) => sum + s.durationMs, 0);

    // Sum scroll distance from viewport scroll events
    let totalScrollDistancePx = 0;
    for (const evt of viewportEvents) {
      const d = evt.data as ViewportEventData;
      if (d.event === 'scroll' && d.scrollDistancePx != null) {
        totalScrollDistancePx += d.scrollDistancePx;
      }
    }

    return { totalMs, sessions, totalScrollDistancePx };
  }

  /**
   * Add a batch of events using upsert (put), so duplicate IDs don't error.
   * Incrementally updates domain_stats aggregates.
   */
  async addEvents(events: CollectionEvent[]): Promise<void> {
    await this.ensureInitialized();

    if (events.length === 0) return;

    const canUpdateStats = await this.canUpdateStatsIncrementally();

    const storedEvents: StoredCollectionEvent[] = [];
    for (const event of events) {
      const storedEvent = prepareStoredEvent(event);
      if (storedEvent.meta?.url) {
        if (!storedEvent.domain) {
          storedEvent.domain = extractDomain(storedEvent.meta.url);
        }
        if (!storedEvent.normalizedUrl) {
          storedEvent.normalizedUrl = normalizeUrl(storedEvent.meta.url);
        }
      }
      storedEvents.push(storedEvent);
    }
    const eventsForStats = storedEvents.map(toCollectionEvent);
    const eventsByDomain = LocalEventStore.groupEventsByDomain(eventsForStats);

    if (!canUpdateStats) {
      this.queueEventsForStatsAfterBackfill(eventsForStats);
    }

    // Write events to the main store
    try {
      await new Promise<void>((resolve, reject) => {
        if (!this.db) {
          reject(new Error("Database not initialized"));
          return;
        }

        const transaction = this.db.transaction([STORE_NAME], "readwrite");
        const evtStore = transaction.objectStore(STORE_NAME);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);

        for (const event of storedEvents) {
          evtStore.put(event);
        }
      });
    } catch (e) {
      if (!canUpdateStats) {
        this.removeEventsQueuedForStatsAfterBackfill(eventsForStats);
      }
      throw e;
    }

    if (!canUpdateStats) {
      this.ensureSessionStatsBackfilled().catch((e) =>
        console.error("[LocalEventStore] Session stats backfill failed:", e),
      );
      return;
    }

    // Update domain aggregates in a separate transaction so a stats
    // failure never blocks event storage
    if (events.length > 0) {
      try {
        await this.updateDomainStats(eventsForStats, eventsByDomain);
      } catch (e) {
        console.error("[LocalEventStore] Failed to update domain stats:", e);
      }
    }
  }

  /** Rebuild aggregates after importing event history from a file. */
  async addImportedEvents(events: CollectionEvent[]): Promise<void> {
    await this.ensureSessionStatsBackfilled();
    await this.addEvents(events);
    await this.rebuildSessionStats();
    await this.writeStatsBackfillState("complete");
    this.statsBackfillComplete = true;
  }

  /** Store server-restored history as uploaded before rebuilding aggregates. */
  async addRestoredEvents(events: CollectionEvent[]): Promise<void> {
    await this.addImportedEvents(
      events.map((event) => ({ ...event, uploaded: true })),
    );
  }

  private static emptyAggregate(key: string, domain: string): DomainStatsAggregate {
    return {
      key,
      domain,
      totalTimeMs: 0,
      hourBuckets: new Array(24).fill(0),
      sessionCount: 0,
      pendingFocusTs: null,
      pendingFocusUrl: "",
      eventsByType: {},
      storageSizeBytes: 0,
      firstVisit: 0,
      lastVisit: 0,
      uniqueUrls: [],
      processedNavIds: [],
    };
  }

  private static groupEventsByDomain(
    events: CollectionEvent[],
  ): Map<string, CollectionEvent[]> {
    const eventsByDomain = new Map<string, CollectionEvent[]>();
    for (const event of events) {
      if (!event.domain) continue;
      if (!eventsByDomain.has(event.domain)) {
        eventsByDomain.set(event.domain, []);
      }
      eventsByDomain.get(event.domain)!.push(event);
    }
    return eventsByDomain;
  }

  /**
   * Apply a batch of events to a single aggregate, mutating it in place.
   * Returns the updated urlSet and processedSet for serialization.
   */
  private static applyEventsToAggregate(
    agg: DomainStatsAggregate,
    events: CollectionEvent[],
  ): void {
    const hasNavigationEvents = events.some((evt) => evt.type === "navigation");
    const urlSet = hasNavigationEvents ? new Set(agg.uniqueUrls) : null;
    const processedSet = hasNavigationEvents ? new Set(agg.processedNavIds) : null;
    agg.storageSizeBytes ??= 0;

    for (const evt of events) {
      agg.eventsByType[evt.type] = (agg.eventsByType[evt.type] ?? 0) + 1;
      agg.storageSizeBytes += JSON.stringify(evt).length;
      if (agg.firstVisit === 0 || evt.ts < agg.firstVisit) {
        agg.firstVisit = evt.ts;
      }
      if (evt.ts > agg.lastVisit) {
        agg.lastVisit = evt.ts;
      }
      if (urlSet && evt.meta?.url) {
        urlSet.add(evt.meta.url);
      }

      if (evt.type === "navigation") {
        if (!processedSet) continue;
        if (processedSet.has(evt.id)) continue;
        processedSet.add(evt.id);

        const d = evt.data as NavigationEventData;
        if (d.event === "focus") {
          agg.pendingFocusTs = evt.ts;
          agg.pendingFocusUrl = evt.meta?.url ?? "";
        } else if (
          (d.event === "blur" || d.event === "beforeunload") &&
          agg.pendingFocusTs !== null
        ) {
          const durationMs = evt.ts - agg.pendingFocusTs;
          if (durationMs >= 1000 && durationMs <= 8 * 60 * 60 * 1000) {
            agg.totalTimeMs += durationMs;
            agg.sessionCount++;
            const hour = new Date(agg.pendingFocusTs).getHours();
            agg.hourBuckets[hour] += durationMs;
          }
          agg.pendingFocusTs = null;
          agg.pendingFocusUrl = "";
        }
      }
    }

    if (urlSet) {
      agg.uniqueUrls = [...urlSet];
    }
    if (processedSet) {
      agg.processedNavIds = [...processedSet];
    }
  }

  /**
   * Incrementally update both domain-level and page-level aggregates.
   */
  private async updateDomainStats(
    events: CollectionEvent[],
    eventsByDomain: Map<string, CollectionEvent[]>,
  ): Promise<void> {
    // Collect all aggregate keys we need to read/write (global + domain + page)
    const keyToEvents = new Map<string, { domain: string; events: CollectionEvent[] }>();

    // Global aggregate: receives ALL events from every domain
    keyToEvents.set(GLOBAL_STATS_KEY, { domain: "", events });

    for (const [dom, domainEvents] of eventsByDomain) {
      // Domain-level aggregate
      const dKey = domainStatsKey(dom);
      if (!keyToEvents.has(dKey)) {
        keyToEvents.set(dKey, { domain: dom, events: [] });
      }
      keyToEvents.get(dKey)!.events.push(...domainEvents);

      // Page-level aggregates: group by normalizedUrl
      for (const evt of domainEvents) {
        const nUrl = (evt as any).normalizedUrl || normalizeUrl(evt.meta?.url ?? "");
        if (!nUrl) continue;
        const pKey = pageStatsKey(dom, nUrl);
        if (!keyToEvents.has(pKey)) {
          keyToEvents.set(pKey, { domain: dom, events: [] });
        }
        keyToEvents.get(pKey)!.events.push(evt);
      }
    }

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STATS_STORE_NAME], "readwrite");
      const statsStore = transaction.objectStore(STATS_STORE_NAME);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const [key, { domain, events }] of keyToEvents) {
        const getReq = statsStore.get(key);
        getReq.onsuccess = () => {
          const agg: DomainStatsAggregate =
            getReq.result ?? LocalEventStore.emptyAggregate(key, domain);

          LocalEventStore.applyEventsToAggregate(agg, events);
          statsStore.put(agg);
        };
      }
    });
  }

  /**
   * Add a single event — delegates to addEvents
   */
  async addEvent(event: CollectionEvent): Promise<void> {
    return this.addEvents([event]);
  }

  /**
   * Get events that have not yet been uploaded (uploaded !== true)
   */
  async getPendingEvents(limit: number): Promise<CollectionEvent[]> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const uploadStateIndex = store.index("uploadState");
      const request = uploadStateIndex.openCursor(IDBKeyRange.only(UPLOAD_STATE_PENDING));

      const events: CollectionEvent[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor && events.length < limit) {
          const evt = cursor.value as StoredCollectionEvent;
          events.push(toCollectionEvent(evt));
          cursor.continue();
        } else {
          resolve(events);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Mark events as uploaded by setting uploaded = true on each ID
   */
  async markEventsAsUploaded(ids: string[]): Promise<void> {
    await this.ensureInitialized();

    if (ids.length === 0) return;

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      let completed = 0;
      const total = ids.length;

      ids.forEach((id) => {
        const getRequest = store.get(id);
        getRequest.onsuccess = () => {
          const evt = getRequest.result;
          if (evt) {
            evt.uploaded = true;
            evt.uploadState = UPLOAD_STATE_UPLOADED;
            store.put(evt);
          }
          completed++;
          if (completed === total) {
            resolve();
          }
        };
        getRequest.onerror = () => reject(getRequest.error);
      });
    });
  }

  async clearAll(): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction(
        [STORE_NAME, STATS_STORE_NAME],
        "readwrite",
      );
      const evtStore = transaction.objectStore(STORE_NAME);
      const statsStore = transaction.objectStore(STATS_STORE_NAME);
      evtStore.clear();
      statsStore.clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async pruneOlderThan(cutoffTs: number): Promise<number> {
    return this.pruneUploadedEventsOlderThan(cutoffTs);
  }

  /**
   * Prune uploaded events older than cutoff timestamp.
   * Pending events stay local until a successful upload marks them uploaded.
   */
  async pruneUploadedEventsOlderThan(cutoffTs: number): Promise<number> {
    await this.ensureInitialized();

    return new Promise<number>((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      let deleted = 0;
      const transaction = this.db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const tsIndex = store.index("ts");
      const request = tsIndex.openCursor(IDBKeyRange.upperBound(cutoffTs, true));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as StoredCollectionEvent;
          if (getUploadState(evt) !== UPLOAD_STATE_UPLOADED) {
            cursor.continue();
            return;
          }

          const deleteRequest = cursor.delete();
          deleteRequest.onsuccess = () => {
            deleted++;
            cursor.continue();
          };
          deleteRequest.onerror = () => reject(deleteRequest.error);
        }
      };

      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => {
        if (VERBOSE && deleted > 0) {
          console.log(
            `[LocalEventStore] Pruned ${deleted} uploaded events older than ${new Date(
              cutoffTs,
            ).toISOString()}`,
          );
        }
        resolve(deleted);
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }
}
