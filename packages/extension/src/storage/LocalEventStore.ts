// ABOUTME: Local storage interface for querying collected events by domain
// ABOUTME: Provides domain-based queries for historical data visualization

import type { CollectionEvent, CollectionEventType } from '../collectors/types';
import { VERBOSE } from '../config';
import { normalizeUrl, extractDomain as extractDomainUtil } from '../utils/urlNormalization';

const DB_NAME = 'collection_events_db';
const DB_VERSION = 3; // Incremented for uploaded flag addition
const STORE_NAME = 'events';

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
  estimatedSizeBytes: number;
  oldestEvent: number;
  newestEvent: number;
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
          console.log('[LocalEventStore] Initialized successfully');
        }
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;

        // Create object store if it doesn't exist (v1)
        let store: IDBObjectStore;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('ts', 'ts', { unique: false });
          store.createIndex('type', 'type', { unique: false });
        } else {
          const transaction = (event.target as IDBOpenDBRequest).transaction!;
          store = transaction.objectStore(STORE_NAME);
        }

        // Add url index for domain queries (v2)
        if (oldVersion < 2) {
          if (!store.indexNames.contains('url')) {
            store.createIndex('url', 'meta.url', { unique: false });
            if (VERBOSE) {
              console.log('[LocalEventStore] Added url index');
            }
          }
        }

        // Add uploaded index to track which events have been synced (v3)
        if (oldVersion < 3) {
          if (!store.indexNames.contains('uploaded')) {
            store.createIndex('uploaded', 'uploaded', { unique: false });
            if (VERBOSE) {
              console.log('[LocalEventStore] Added uploaded index');
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
    options: QueryOptions = {}
  ): Promise<CollectionEvent[]> {
    await this.ensureInitialized();

    console.log(`[LocalEventStore] Querying domain: ${domain}`, options);

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const urlIndex = store.index('url');

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
          console.log(`[LocalEventStore] Query complete: ${events.length} events for ${domain}`);
          resolve(events);
        }
      };

      request.onerror = () => {
        console.error('[LocalEventStore] Query error:', request.error);
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
    options: QueryOptions = {}
  ): Promise<CollectionEvent[]> {
    await this.ensureInitialized();

    const normalizedUrl = normalizeUrl(url);

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const urlIndex = store.index('url');

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
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const urlIndex = store.index('url');

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
  async getAllDomains(): Promise<Array<{
    domain: string;
    eventCount: number;
    lastVisit: number;
  }>> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], 'readonly');
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
          const domains = Array.from(domainMap.entries()).map(([domain, data]) => ({
            domain,
            eventCount: data.count,
            lastVisit: data.lastVisit,
          }));

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
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const countRequest = store.count();

      countRequest.onsuccess = () => {
        const totalEvents = countRequest.result;

        // Get timestamp bounds
        const tsIndex = store.index('ts');
        const oldestRequest = tsIndex.openCursor(null, 'next');
        const newestRequest = tsIndex.openCursor(null, 'prev');

        let oldestEvent = 0;
        let newestEvent = 0;

        oldestRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            oldestEvent = (cursor.value as CollectionEvent).ts;
          }

          newestRequest.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
              newestEvent = (cursor.value as CollectionEvent).ts;
            }

            // Estimate size (rough approximation)
            const estimatedSizeBytes = totalEvents * 300; // ~300 bytes per event

            resolve({
              totalEvents,
              estimatedSizeBytes,
              oldestEvent,
              newestEvent,
            });
          };

          newestRequest.onerror = () => reject(newestRequest.error);
        };

        oldestRequest.onerror = () => reject(oldestRequest.error);
      };

      countRequest.onerror = () => reject(countRequest.error);
    });
  }

  /**
   * Prune events older than cutoff timestamp
   * Returns number of events deleted
   */
  async pruneOlderThan(cutoffTs: number): Promise<number> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const tsIndex = store.index('ts');

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
                  console.log(`[LocalEventStore] Pruned ${deleted} events older than ${new Date(cutoffTs).toISOString()}`);
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
