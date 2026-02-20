// ABOUTME: Local storage interface for querying collected events by domain
// ABOUTME: Provides domain-based queries for historical data visualization

import type { CollectionEvent, CollectionEventType, NavigationEventData, ViewportEventData } from "../collectors/types";
import { VERBOSE } from "../config";
import {
  normalizeUrl,
  extractDomain as extractDomainUtil,
} from "../utils/urlNormalization";

const DB_NAME = "collection_events_db";
const DB_VERSION = 3; // Incremented for uploaded flag addition
const STORE_NAME = "events";

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
      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        if (VERBOSE) {
          console.log("[LocalEventStore] Initialized successfully");
        }
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

        // Add url index for domain queries (v2)
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
   * Query events by domain (extracted from meta.url)
   */
  async queryByDomain(
    domain: string,
    options: QueryOptions = {},
  ): Promise<CollectionEvent[]> {
    await this.ensureInitialized();

    console.log(`[LocalEventStore] Querying domain: ${domain}`, options);

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const urlIndex = store.index("url");

      const events: CollectionEvent[] = [];
      const request = urlIndex.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as CollectionEvent;
          const eventDomain = extractDomain(evt.meta.url);

          // Filter by domain
          if (eventDomain === domain) {
            // Apply optional filters
            let include = true;

            if (options.type && evt.type !== options.type) {
              include = false;
            }
            if (options.startTs && evt.ts < options.startTs) {
              include = false;
            }
            if (options.endTs && evt.ts > options.endTs) {
              include = false;
            }

            if (include) {
              events.push(evt);
            }

            // Check limit
            if (options.limit && events.length >= options.limit) {
              resolve(events);
              return;
            }
          }

          cursor.continue();
        } else {
          // Sort by timestamp (ascending - oldest first)
          events.sort((a, b) => a.ts - b.ts);
          console.log(
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
   *
   * Note: Currently does client-side filtering since we don't store
   * normalized URLs. For better performance, consider storing normalized
   * URLs in the future (see TASKS.md)
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
      const urlIndex = store.index("url");

      const events: CollectionEvent[] = [];
      const request = urlIndex.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as CollectionEvent;
          const eventNormalizedUrl = normalizeUrl(evt.meta.url);

          // Filter by normalized URL
          if (eventNormalizedUrl === normalizedUrl) {
            // Apply optional filters
            let include = true;

            if (options.type && evt.type !== options.type) {
              include = false;
            }
            if (options.startTs && evt.ts < options.startTs) {
              include = false;
            }
            if (options.endTs && evt.ts > options.endTs) {
              include = false;
            }

            if (include) {
              events.push(evt);
            }

            // Check limit
            if (options.limit && events.length >= options.limit) {
              resolve(events);
              return;
            }
          }

          cursor.continue();
        } else {
          // Sort by timestamp (ascending - oldest first)
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
      const urlIndex = store.index("url");

      let totalEvents = 0;
      const eventsByType: Record<string, number> = {};
      let firstVisit = Infinity;
      let lastVisit = 0;

      const request = urlIndex.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as CollectionEvent;
          const eventDomain = extractDomain(evt.meta.url);

          if (eventDomain === domain) {
            totalEvents++;
            eventsByType[evt.type] = (eventsByType[evt.type] || 0) + 1;
            firstVisit = Math.min(firstVisit, evt.ts);
            lastVisit = Math.max(lastVisit, evt.ts);
          }

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
      const request = store.openCursor();

      const domainMap = new Map<string, { count: number; lastVisit: number }>();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as CollectionEvent;
          const domain = extractDomain(evt.meta.url);

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

          // Sort by last visit (most recent first)
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
      const request = store.openCursor();

      const events: CollectionEvent[] = [];

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

      const transaction = this.db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async pruneOlderThan(cutoffTs: number): Promise<number> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const tsIndex = store.index("ts");

      const idsToDelete: string[] = [];
      const request = tsIndex.openCursor(IDBKeyRange.upperBound(cutoffTs));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          const evt = cursor.value as CollectionEvent;
          idsToDelete.push(evt.id);
          cursor.continue();
        } else {
          // Delete collected IDs
          let deleted = 0;
          idsToDelete.forEach((id) => {
            const deleteRequest = store.delete(id);
            deleteRequest.onsuccess = () => {
              deleted++;
              if (deleted === idsToDelete.length) {
                if (VERBOSE) {
                  console.log(
                    `[LocalEventStore] Pruned ${deleted} events older than ${new Date(
                      cutoffTs,
                    ).toISOString()}`,
                  );
                }
                resolve(deleted);
              }
            };
            deleteRequest.onerror = () => reject(deleteRequest.error);
          });

          // Handle empty case
          if (idsToDelete.length === 0) {
            resolve(0);
          }
        }
      };

      request.onerror = () => reject(request.error);
    });
  }
}
