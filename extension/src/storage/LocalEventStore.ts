// ABOUTME: Local storage interface for querying collected events by domain
// ABOUTME: Provides domain-based queries for historical data visualization

import type { CollectionEvent, CollectionEventType, NavigationEventData, ViewportEventData } from "../collectors/types";
import { VERBOSE } from "../config";
import {
  normalizeUrl,
  extractDomain as extractDomainUtil,
} from "../utils/urlNormalization";

const DB_NAME = "collection_events_db";
const DB_VERSION = 8;
const STORE_NAME = "events";
const STATS_STORE_NAME = "domain_stats";

// Aggregate key for cross-domain totals (all browsing activity combined)
const GLOBAL_STATS_KEY = "__global__";

export interface QueryOptions {
  type?: CollectionEventType;
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

  constructor() {
    this.init().catch(console.error);
  }

  /**
   * Initialize IndexedDB with domain index
   */
  private async init(): Promise<void> {
    if (this.isInitialized) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        console.warn("[LocalEventStore] DB upgrade blocked by another connection");
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        if (VERBOSE) {
          console.log("[LocalEventStore] Initialized successfully");
        }
        resolve();
        // Backfill session stats in the background (non-blocking)
        this.backfillSessionStats().catch((e) =>
          console.error("[LocalEventStore] Session stats backfill failed:", e),
        );
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
            console.log("[LocalEventStore] Created domain_stats store (v8, keyPath: key)");
          }
        }
      };
    });
  }

  /**
   * Ensure database is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }
  }

  /**
   * One-time backfill: compute session aggregates from existing navigation events.
   * Skips if domain_stats already has data (idempotent).
   */
  private async backfillSessionStats(): Promise<void> {
    if (!this.db) return;

    // Check if backfill already ran (any row in domain_stats means it did)
    const hasData = await new Promise<boolean>((resolve, reject) => {
      const tx = this.db!.transaction([STATS_STORE_NAME], "readonly");
      const store = tx.objectStore(STATS_STORE_NAME);
      const countReq = store.count();
      countReq.onsuccess = () => resolve(countReq.result > 0);
      countReq.onerror = () => reject(countReq.error);
    });

    if (hasData) return;

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
          events.push(cursor.value as CollectionEvent);
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

    for (const [key, { domain, events }] of keyToEvents) {
      const agg = LocalEventStore.emptyAggregate(key, domain);
      // Sort events by timestamp so session pairing works correctly
      events.sort((a, b) => a.ts - b.ts);
      LocalEventStore.applyEventsToAggregate(agg, events);
      statsStore.put(agg);
    }

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
          const evt = cursor.value as CollectionEvent;

          let include = true;
          if (options.type && evt.type !== options.type) include = false;
          if (options.startTs && evt.ts < options.startTs) include = false;
          if (options.endTs && evt.ts > options.endTs) include = false;

          if (include) {
            events.push(evt);
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
          const evt = cursor.value as CollectionEvent;

          let include = true;
          if (options.type && evt.type !== options.type) include = false;
          if (options.startTs && evt.ts < options.startTs) include = false;
          if (options.endTs && evt.ts > options.endTs) include = false;

          if (include) {
            events.push(evt);
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
          const evt = cursor.value as CollectionEvent;
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
    }>
  > {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const domainIndex = store.index("domain");

      const domainMap = new Map<string, { count: number; lastVisit: number }>();

      // Walk the domain index — entries are grouped by key so this is efficient
      const request = domainIndex.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as CollectionEvent;
          const domain = evt.domain || extractDomain(evt.meta.url);

          if (domain) {
            const existing = domainMap.get(domain);
            if (existing) {
              existing.count++;
              existing.lastVisit = Math.max(existing.lastVisit, evt.ts);
            } else {
              domainMap.set(domain, { count: 1, lastVisit: evt.ts });
            }
          }

          cursor.continue();
        } else {
          const domains = Array.from(domainMap.entries()).map(
            ([domain, data]) => ({
              domain,
              eventCount: data.count,
              lastVisit: data.lastVisit,
            }),
          );

          domains.sort((a, b) => b.lastVisit - a.lastVisit);
          resolve(domains);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get storage usage stats
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

      // Single cursor pass: collect total count, timestamp bounds, per-type counts, and actual serialized size
      // TODO: decide if we need per-type event counts and if so, we should store counts natively in database so we don't have to count them here
      const countsByType: Record<string, number> = {};
      let totalEvents = 0;
      let oldestEvent = 0;
      let newestEvent = 0;
      let actualSizeBytes = 0;

      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as CollectionEvent;
          totalEvents++;
          countsByType[evt.type] = (countsByType[evt.type] ?? 0) + 1;
          if (oldestEvent === 0 || evt.ts < oldestEvent) oldestEvent = evt.ts;
          if (evt.ts > newestEvent) newestEvent = evt.ts;
          // Serialized size: string length ≈ bytes for mostly-ASCII event JSON (avoids TextEncoder per-event for perf)
          actualSizeBytes += JSON.stringify(evt).length;
          cursor.continue();
        } else {
          resolve({
            totalEvents,
            estimatedSizeBytes: actualSizeBytes,
            oldestEvent,
            newestEvent,
            countsByType,
          });
        }
      };

      request.onerror = () => reject(request.error);
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

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as CollectionEvent;
          let include = true;

          if (options.type && evt.type !== options.type) include = false;

          if (include) {
            events.push(evt);
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

    // Group events by domain for stats updates
    const eventsByDomain = new Map<string, CollectionEvent[]>();
    for (const event of events) {
      if (event.meta?.url) {
        if (!event.domain) {
          event.domain = extractDomain(event.meta.url);
        }
        if (!event.normalizedUrl) {
          event.normalizedUrl = normalizeUrl(event.meta.url);
        }
      }
      if (event.domain) {
        if (!eventsByDomain.has(event.domain)) eventsByDomain.set(event.domain, []);
        eventsByDomain.get(event.domain)!.push(event);
      }
    }

    // Write events to the main store
    await new Promise<void>((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readwrite");
      const evtStore = transaction.objectStore(STORE_NAME);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const event of events) {
        evtStore.put(event);
      }
    });

    // Update domain aggregates in a separate transaction so a stats
    // failure never blocks event storage
    if (eventsByDomain.size > 0) {
      try {
        await this.updateDomainStats(eventsByDomain);
      } catch (e) {
        console.error("[LocalEventStore] Failed to update domain stats:", e);
      }
    }
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
      firstVisit: 0,
      lastVisit: 0,
      uniqueUrls: [],
      processedNavIds: [],
    };
  }

  /**
   * Apply a batch of events to a single aggregate, mutating it in place.
   * Returns the updated urlSet and processedSet for serialization.
   */
  private static applyEventsToAggregate(
    agg: DomainStatsAggregate,
    events: CollectionEvent[],
  ): void {
    const urlSet = new Set(agg.uniqueUrls);
    const processedSet = new Set(agg.processedNavIds);

    for (const evt of events) {
      agg.eventsByType[evt.type] = (agg.eventsByType[evt.type] ?? 0) + 1;
      if (agg.firstVisit === 0 || evt.ts < agg.firstVisit) {
        agg.firstVisit = evt.ts;
      }
      if (evt.ts > agg.lastVisit) {
        agg.lastVisit = evt.ts;
      }
      if (evt.meta?.url) {
        urlSet.add(evt.meta.url);
      }

      if (evt.type === "navigation") {
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

    agg.uniqueUrls = [...urlSet];
    agg.processedNavIds = [...processedSet];
  }

  /**
   * Incrementally update both domain-level and page-level aggregates.
   */
  private async updateDomainStats(
    eventsByDomain: Map<string, CollectionEvent[]>,
  ): Promise<void> {
    // Collect all aggregate keys we need to read/write (global + domain + page)
    const keyToEvents = new Map<string, { domain: string; events: CollectionEvent[] }>();

    // Global aggregate: receives ALL events from every domain
    keyToEvents.set(GLOBAL_STATS_KEY, { domain: "", events: [] });

    for (const [dom, domainEvents] of eventsByDomain) {
      keyToEvents.get(GLOBAL_STATS_KEY)!.events.push(...domainEvents);

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
      const request = store.openCursor();

      const events: CollectionEvent[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor && events.length < limit) {
          const evt = cursor.value;
          if (evt.uploaded !== true) {
            events.push(evt as CollectionEvent);
          }
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

  /**
   * Prune events older than cutoff timestamp
   * Returns number of events deleted
   */
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
    await this.ensureInitialized();

    const deleted = await new Promise<number>((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction(
        [STORE_NAME, STATS_STORE_NAME],
        "readwrite",
      );
      const store = transaction.objectStore(STORE_NAME);
      const statsStore = transaction.objectStore(STATS_STORE_NAME);
      const tsIndex = store.index("ts");

      // Clear domain_stats — will be rebuilt from remaining events
      statsStore.clear();

      const idsToDelete: string[] = [];
      const request = tsIndex.openCursor(IDBKeyRange.upperBound(cutoffTs));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as CollectionEvent;
          idsToDelete.push(evt.id);
          cursor.continue();
        } else {
          for (const id of idsToDelete) {
            store.delete(id);
          }
          transaction.oncomplete = () => {
            if (VERBOSE) {
              console.log(
                `[LocalEventStore] Pruned ${idsToDelete.length} events older than ${new Date(
                  cutoffTs,
                ).toISOString()}`,
              );
            }
            resolve(idsToDelete.length);
          };
        }
      };

      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });

    // Rebuild domain_stats from remaining events
    if (deleted > 0) {
      await this.backfillSessionStats().catch((e) =>
        console.error("[LocalEventStore] Stats rebuild after prune failed:", e),
      );
    }

    return deleted;
  }
}
