// ABOUTME: Local storage interface for querying collected events by domain
// ABOUTME: Provides domain-based queries for historical data visualization

import type {
  CollectionEvent,
  CollectionEventType,
  CursorEventData,
  NavigationEventData,
} from "../collectors/types";
import { VERBOSE } from "../config";
import {
  normalizeUrl,
  extractDomain as extractDomainUtil,
} from "../utils/urlNormalization";
import { getCanonicalScrapKey } from "../collectors/scrapUtils";

const DB_NAME = "collection_events_db";
const DB_VERSION = 12;
const STORE_NAME = "events";
const STATS_STORE_NAME = "domain_stats";
const AGGREGATE_URLS_STORE_NAME = "aggregate_urls";
const AGGREGATE_DAYS_STORE_NAME = "aggregate_days";
const STATS_BACKFILL_STATE_KEY = "__stats_backfill_state__";
const DAYS_BACKFILL_STATE_KEY = "__days_backfill_state__";
const UPLOAD_STATE_PENDING = "pending";
const UPLOAD_STATE_UPLOADED = "uploaded";
const LANDSCAPE_SEGMENT_POINT_LIMIT = 96;
const LANDSCAPE_SEGMENT_DURATION_MS = 12_000;
const LANDSCAPE_SEGMENTS_PER_TARGET = 8;
const LANDSCAPE_SOURCE_PATH_LIMIT = 8;
export const WALKING_RECORD_FAVICON_DOMAIN_LIMIT = 24;
const WALKING_RECORD_FAVICON_URL_LENGTH_LIMIT = 128 * 1024;
const COLLECTION_EVENT_TYPES: CollectionEventType[] = [
  "cursor",
  "navigation",
  "viewport",
  "keyboard",
  "element",
];
const STORAGE_SIZE_SAMPLE_LIMIT = 200;
const RECENT_FOCUS_VISIT_LIMIT = 5;
const AGGREGATE_FAVICON_URL_LENGTH_LIMIT = 2048;

type UploadState = typeof UPLOAD_STATE_PENDING | typeof UPLOAD_STATE_UPLOADED;
type StatsBackfillState = "running" | "complete";

interface StoredCollectionEvent extends CollectionEvent {
  canonicalScrapKey?: string;
  uploaded?: boolean;
  uploadState?: UploadState;
}

interface AggregateUrl {
  aggregateKey: string;
  url: string;
}

export interface AggregateDay {
  domain: string;
  localDayKey: string;
  firstVisitTs: number;
  lastVisitTs: number;
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
  /** Approximate serialized byte size grouped by collection event type. */
  estimatedSizeBytesByType: Record<string, number>;
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
  /** Number of unique URLs represented by this aggregate */
  uniqueUrlCount: number;
  /** Number of local calendar days with at least one focused visit */
  activeDayCount: number;
  /** Latest bounded favicon observed for domain-level milestone UI. */
  latestFaviconUrl?: string;
  /** Most recent focused visit on up to five distinct local days. */
  recentFocusVisits?: number[];
  /** Compact daily activity used by the global milestone check. */
  milestoneActivity?: MilestoneActivityAggregate;
}

export interface MilestoneActivityAggregate {
  localDayKey: string;
  cursorDistancePx: number;
  lastCursorPosition: { x: number; y: number } | null;
  screenTimeMs: number;
  pendingFocusTs: number | null;
}

function domainStatsKey(domain: string): string {
  return domain;
}

function pageStatsKey(domain: string, normalizedUrl: string): string {
  return `${domain}::${normalizedUrl}`;
}

function localDayKey(timestamp: number, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(timestamp);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
  } catch {
    const date = new Date(timestamp);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }
}

function getUploadState(event: StoredCollectionEvent): UploadState {
  return event.uploaded === true || event.uploadState === UPLOAD_STATE_UPLOADED
    ? UPLOAD_STATE_UPLOADED
    : UPLOAD_STATE_PENDING;
}

function prepareStoredEvent(event: CollectionEvent): StoredCollectionEvent {
  const storedEvent: StoredCollectionEvent = { ...event };
  delete storedEvent.canonicalScrapKey;
  storedEvent.uploadState = getUploadState(storedEvent);
  storedEvent.uploaded = storedEvent.uploadState === UPLOAD_STATE_UPLOADED;
  return storedEvent;
}

function toCollectionEvent(event: StoredCollectionEvent): CollectionEvent {
  const { canonicalScrapKey, uploaded, uploadState, ...collectionEvent } =
    event;
  return collectionEvent;
}

export interface ScreenTimeResult {
  totalMs: number;
  sessions: ScreenTimeSession[];
}

export interface WalkingRecordEventResult {
  events: CollectionEvent[];
  cursorDistancePx: number;
  activity: WalkingRecordActivity[];
  sessions: ScreenTimeSession[];
  favicons: Record<string, string>;
}

export interface WalkingRecordActivity {
  url: string;
  windowStarts: number[];
}

export interface WalkingRecordTracePoint {
  x: number;
  y: number;
}

export interface WalkingRecordTraceTarget {
  id: string;
  url: string;
  startTs: number;
  endTs: number;
}

export interface WalkingRecordTrace {
  targetId: string;
  paths: WalkingRecordTracePoint[][];
}

export interface WalkingRecordMovement {
  traces: WalkingRecordTrace[];
  landscapePaths: CollectionEvent[][];
}

interface TimedTracePoint extends WalkingRecordTracePoint {
  ts: number;
  event: CollectionEvent;
}

function squaredDistance(
  first: WalkingRecordTracePoint,
  second: WalkingRecordTracePoint,
): number {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}

function squaredSegmentDistance(
  point: WalkingRecordTracePoint,
  start: WalkingRecordTracePoint,
  end: WalkingRecordTracePoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) return squaredDistance(point, start);

  const progress = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return squaredDistance(point, {
    x: start.x + progress * dx,
    y: start.y + progress * dy,
  });
}

function simplifyTracePath(
  points: TimedTracePoint[],
  tolerance = 0.004,
): WalkingRecordTracePoint[] {
  if (points.length <= 2) return points.map(({ x, y }) => ({ x, y }));

  const keep = new Set([0, points.length - 1]);
  const segments: Array<[number, number]> = [[0, points.length - 1]];
  const squaredTolerance = tolerance * tolerance;

  while (segments.length > 0) {
    const [startIndex, endIndex] = segments.pop()!;
    let farthestIndex = -1;
    let farthestDistance = squaredTolerance;

    for (let index = startIndex + 1; index < endIndex; index++) {
      const distance = squaredSegmentDistance(
        points[index],
        points[startIndex],
        points[endIndex],
      );
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }

    if (farthestIndex !== -1) {
      keep.add(farthestIndex);
      segments.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }

  const simplified = [...keep]
    .sort((a, b) => a - b)
    .map((index) => ({ x: points[index].x, y: points[index].y }));
  if (simplified.length <= 48) return simplified;

  return Array.from({ length: 48 }, (_, index) => {
    const sourceIndex = Math.round((index / 47) * (simplified.length - 1));
    return simplified[sourceIndex];
  });
}

function tracePathDistance(points: TimedTracePoint[]): number {
  let distance = 0;
  for (let index = 1; index < points.length; index++) {
    distance += Math.sqrt(squaredDistance(points[index - 1], points[index]));
  }
  return distance;
}

function splitLandscapePath(points: TimedTracePoint[]): TimedTracePoint[][] {
  const segments: TimedTracePoint[][] = [];
  let current: TimedTracePoint[] = [];

  for (const point of points) {
    const first = current[0];
    if (
      current.length >= 2 &&
      (current.length >= LANDSCAPE_SEGMENT_POINT_LIMIT ||
        point.ts - first.ts > LANDSCAPE_SEGMENT_DURATION_MS)
    ) {
      segments.push(current);
      current = [current.at(-1)!, point];
    } else {
      current.push(point);
    }
  }

  if (current.length >= 2) segments.push(current);
  return segments;
}

function evenlySpacedPaths(
  paths: TimedTracePoint[][],
  limit: number,
): TimedTracePoint[][] {
  if (paths.length <= limit) return paths;

  return Array.from({ length: limit }, (_, index) => {
    const sourceIndex = Math.round((index / (limit - 1)) * (paths.length - 1));
    return paths[sourceIndex];
  });
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
  private daysBackfillPromise: Promise<void> | null = null;
  private daysBackfillComplete = false;
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
      let upgradeBlocked = false;

      request.onerror = () => {
        this.initPromise = null;
        reject(request.error);
      };
      request.onblocked = () => {
        upgradeBlocked = true;
        this.initPromise = null;
        reject(
          new Error(
            "Local history is waiting for an older extension process to close. Reload the extension and open a new tab.",
          ),
        );
      };

      request.onsuccess = () => {
        const db = request.result;
        if (upgradeBlocked) {
          db.close();
          return;
        }

        db.onversionchange = () => {
          db.close();
          if (this.db === db) {
            this.db = null;
            this.isInitialized = false;
            this.initPromise = null;
          }
        };
        this.db = db;
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
            store.createIndex("normalizedUrl", "normalizedUrl", {
              unique: false,
            });
            if (VERBOSE) {
              console.log("[LocalEventStore] Added normalizedUrl index");
            }
          }
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
            console.log(
              "[LocalEventStore] Created domain_stats store (keyPath: key)",
            );
          }
        } else if (!db.objectStoreNames.contains(STATS_STORE_NAME)) {
          db.createObjectStore(STATS_STORE_NAME, { keyPath: "key" });
        }

        if (oldVersion < 10) {
          let aggregateUrlsStore: IDBObjectStore;
          if (!db.objectStoreNames.contains(AGGREGATE_URLS_STORE_NAME)) {
            aggregateUrlsStore = db.createObjectStore(
              AGGREGATE_URLS_STORE_NAME,
              {
                keyPath: ["aggregateKey", "url"],
              },
            );
          } else {
            const tx = (event.target as IDBOpenDBRequest).transaction!;
            aggregateUrlsStore = tx.objectStore(AGGREGATE_URLS_STORE_NAME);
          }

          const tx = (event.target as IDBOpenDBRequest).transaction!;
          const statsStore = tx.objectStore(STATS_STORE_NAME);
          const migrateRequest = statsStore.openCursor();
          migrateRequest.onsuccess = () => {
            const cursor = migrateRequest.result;
            if (!cursor) return;

            const aggregate = cursor.value as DomainStatsAggregate & {
              uniqueUrls?: unknown;
              processedNavIds?: string[];
            };
            if (aggregate.key !== STATS_BACKFILL_STATE_KEY) {
              const uniqueUrls = Array.isArray(aggregate.uniqueUrls)
                ? [
                    ...new Set(
                      aggregate.uniqueUrls.filter(
                        (url): url is string => typeof url === "string",
                      ),
                    ),
                  ]
                : [];
              aggregate.uniqueUrlCount = uniqueUrls.length;
              delete aggregate.uniqueUrls;
              delete aggregate.processedNavIds;
              cursor.update(aggregate);

              for (const url of uniqueUrls) {
                aggregateUrlsStore.put({
                  aggregateKey: aggregate.key,
                  url,
                } satisfies AggregateUrl);
              }
            }
            cursor.continue();
          };
        }

        if (oldVersion < 11) {
          if (!db.objectStoreNames.contains(AGGREGATE_DAYS_STORE_NAME)) {
            db.createObjectStore(AGGREGATE_DAYS_STORE_NAME, {
              keyPath: ["domain", "localDayKey"],
            });
          }

          const tx = (event.target as IDBOpenDBRequest).transaction!;
          tx.objectStore(STATS_STORE_NAME).put({
            key: DAYS_BACKFILL_STATE_KEY,
            state: oldVersion === 0 ? "complete" : "running",
          });
        }

        if (oldVersion < 12) {
          if (!store.indexNames.contains("canonicalScrapKey")) {
            store.createIndex("canonicalScrapKey", "canonicalScrapKey", {
              unique: false,
            });
          }
        }

        if (oldVersion < 9) {
          if (store.indexNames.contains("uploaded")) {
            store.deleteIndex("uploaded");
          }
          if (!store.indexNames.contains("uploadState")) {
            store.createIndex("uploadState", "uploadState", { unique: false });
          }

        }

        if (oldVersion < 12) {
          // Backfill event fields in one cursor so every migrated row is written once.
          const backfillRequest = store.openCursor();
          backfillRequest.onsuccess = () => {
            const cursor = backfillRequest.result;
            if (!cursor) return;

            const storedEvent = cursor.value as StoredCollectionEvent;
            let updated = false;

            if (oldVersion < 5 && storedEvent.meta?.url) {
              if (!storedEvent.domain) {
                storedEvent.domain = extractDomain(storedEvent.meta.url);
                updated = true;
              }
              if (!storedEvent.normalizedUrl) {
                storedEvent.normalizedUrl = normalizeUrl(storedEvent.meta.url);
                updated = true;
              }
            }

            if (oldVersion < 9) {
              const uploadState = getUploadState(storedEvent);
              const uploaded = uploadState === UPLOAD_STATE_UPLOADED;
              if (
                storedEvent.uploadState !== uploadState ||
                storedEvent.uploaded !== uploaded
              ) {
                storedEvent.uploadState = uploadState;
                storedEvent.uploaded = uploaded;
                updated = true;
              }
            }

            if (storedEvent.type === "element") {
              const domain =
                storedEvent.domain || extractDomain(storedEvent.meta.url);
              const canonicalScrapKey = getCanonicalScrapKey(
                domain,
                storedEvent.data,
              );
              if (
                canonicalScrapKey !== undefined &&
                storedEvent.canonicalScrapKey !== canonicalScrapKey
              ) {
                storedEvent.canonicalScrapKey = canonicalScrapKey;
                updated = true;
              }
            }

            if (updated) cursor.update(storedEvent);
            cursor.continue();
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

  private async ensureAggregateDaysBackfilled(): Promise<void> {
    if (this.daysBackfillComplete) return;

    if (!this.daysBackfillPromise) {
      this.daysBackfillPromise = this.readDaysBackfillState()
        .then(async (state) => {
          if (state !== "complete") {
            await this.rebuildAggregateDays();
          }
        })
        .then(() => this.writeDaysBackfillState("complete"))
        .then(() => {
          this.daysBackfillComplete = true;
        })
        .finally(() => {
          this.daysBackfillPromise = null;
        });
    }

    return this.daysBackfillPromise;
  }

  private async readDaysBackfillState(): Promise<StatsBackfillState | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STATS_STORE_NAME], "readonly");
      const request = transaction
        .objectStore(STATS_STORE_NAME)
        .get(DAYS_BACKFILL_STATE_KEY);
      request.onsuccess = () => {
        const state = (request.result as { state?: unknown } | undefined)
          ?.state;
        resolve(state === "running" || state === "complete" ? state : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async writeDaysBackfillState(
    state: StatsBackfillState,
  ): Promise<void> {
    if (!this.db) return;

    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction([STATS_STORE_NAME], "readwrite");
      transaction.objectStore(STATS_STORE_NAME).put({
        key: DAYS_BACKFILL_STATE_KEY,
        state,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  private static aggregateDaysForEvents(
    events: CollectionEvent[],
  ): AggregateDay[] {
    const days = new Map<string, AggregateDay>();

    for (const event of events) {
      if (event.type !== "navigation") continue;
      const data = event.data as NavigationEventData;
      if (data.event !== "focus") continue;

      const domain = event.domain || extractDomain(event.meta?.url);
      if (!domain) continue;
      const dayKey = localDayKey(event.ts, event.meta.tz);
      const key = `${domain}\n${dayKey}`;
      const existing = days.get(key);
      if (existing) {
        existing.firstVisitTs = Math.min(existing.firstVisitTs, event.ts);
        existing.lastVisitTs = Math.max(existing.lastVisitTs, event.ts);
      } else {
        days.set(key, {
          domain,
          localDayKey: dayKey,
          firstVisitTs: event.ts,
          lastVisitTs: event.ts,
        });
      }
    }

    return [...days.values()];
  }

  private async upsertAggregateDays(events: CollectionEvent[]): Promise<void> {
    const days = LocalEventStore.aggregateDaysForEvents(events);
    if (days.length === 0 || !this.db) return;

    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(
        [AGGREGATE_DAYS_STORE_NAME, STATS_STORE_NAME],
        "readwrite",
      );
      const daysStore = transaction.objectStore(AGGREGATE_DAYS_STORE_NAME);
      const statsStore = transaction.objectStore(STATS_STORE_NAME);
      const newDaysByDomain = new Map<string, number>();
      let pendingDayReads = days.length;

      const updateActiveDayCounts = () => {
        for (const [domain, count] of newDaysByDomain) {
          const request = statsStore.get(domainStatsKey(domain));
          request.onsuccess = () => {
            const aggregate = request.result as
              | DomainStatsAggregate
              | undefined;
            if (!aggregate) return;
            aggregate.activeDayCount = (aggregate.activeDayCount ?? 0) + count;
            statsStore.put(aggregate);
          };
        }
      };

      for (const day of days) {
        const request = daysStore.get([day.domain, day.localDayKey]);
        request.onsuccess = () => {
          const existing = request.result as AggregateDay | undefined;
          if (existing) {
            daysStore.put({
              ...existing,
              firstVisitTs: Math.min(existing.firstVisitTs, day.firstVisitTs),
              lastVisitTs: Math.max(existing.lastVisitTs, day.lastVisitTs),
            } satisfies AggregateDay);
          } else {
            daysStore.put(day);
            newDaysByDomain.set(
              day.domain,
              (newDaysByDomain.get(day.domain) ?? 0) + 1,
            );
          }

          pendingDayReads--;
          if (pendingDayReads === 0) updateActiveDayCounts();
        };
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  private async rebuildAggregateDays(): Promise<void> {
    if (!this.db) return;
    await this.writeDaysBackfillState("running");

    const days = await new Promise<AggregateDay[]>((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly");
      const index = transaction.objectStore(STORE_NAME).index("type");
      const request = index.openCursor(IDBKeyRange.only("navigation"));
      const aggregated = new Map<string, AggregateDay>();

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve([...aggregated.values()]);
          return;
        }

        const event = toCollectionEvent(cursor.value as StoredCollectionEvent);
        for (const day of LocalEventStore.aggregateDaysForEvents([event])) {
          const key = `${day.domain}\n${day.localDayKey}`;
          const existing = aggregated.get(key);
          if (existing) {
            existing.firstVisitTs = Math.min(
              existing.firstVisitTs,
              day.firstVisitTs,
            );
            existing.lastVisitTs = Math.max(
              existing.lastVisitTs,
              day.lastVisitTs,
            );
          } else {
            aggregated.set(key, day);
          }
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });

    const counts = new Map<string, number>();
    for (const day of days) {
      counts.set(day.domain, (counts.get(day.domain) ?? 0) + 1);
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(
        [AGGREGATE_DAYS_STORE_NAME, STATS_STORE_NAME],
        "readwrite",
      );
      transaction.objectStore(AGGREGATE_DAYS_STORE_NAME).clear();
      const request = transaction.objectStore(STATS_STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const aggregate = cursor.value as DomainStatsAggregate;
        if (aggregate.domain && !aggregate.key.includes("::")) {
          aggregate.activeDayCount = counts.get(aggregate.domain) ?? 0;
          cursor.update(aggregate);
        }
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    for (let index = 0; index < days.length; index += 1_000) {
      const batch = days.slice(index, index + 1_000);
      await new Promise<void>((resolve, reject) => {
        const transaction = this.db!.transaction(
          [AGGREGATE_DAYS_STORE_NAME],
          "readwrite",
        );
        const store = transaction.objectStore(AGGREGATE_DAYS_STORE_NAME);
        for (const day of batch) store.put(day);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }
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
      const statsCursorRequest = statsStore.openCursor();
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
      statsCursorRequest.onsuccess = () => {
        const cursor = statsCursorRequest.result;
        if (cursor) {
          const value = cursor.value as Partial<DomainStatsAggregate>;
          if (typeof value.domain === "string") statsCount++;
          cursor.continue();
          return;
        }
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
      statsCursorRequest.onerror = () => reject(statsCursorRequest.error);
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

  private removeEventsQueuedForStatsAfterBackfill(
    events: CollectionEvent[],
  ): void {
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

  private async writeStatsBackfillState(
    state: StatsBackfillState,
  ): Promise<void> {
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
      const countReq = store.openCursor();
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
        const cursor = countReq.result;
        if (cursor) {
          const value = cursor.value as Partial<DomainStatsAggregate>;
          if (typeof value.domain === "string") statsCount++;
          cursor.continue();
          return;
        }
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
    const allEvents = await new Promise<CollectionEvent[]>(
      (resolve, reject) => {
        const tx = this.db!.transaction([STORE_NAME], "readonly");
        const store = tx.objectStore(STORE_NAME);
        const events: CollectionEvent[] = [];
        const req = store.openCursor();

        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const evt = toCollectionEvent(
              cursor.value as StoredCollectionEvent,
            );
            if (!this.eventIdsPendingStatsAfterBackfill.has(evt.id)) {
              events.push(evt);
            }
            cursor.continue();
          } else {
            resolve(events);
          }
        };
        req.onerror = () => reject(req.error);
      },
    );

    // Group events by aggregate key (global + domain-level + page-level)
    const keyToEvents = new Map<
      string,
      { domain: string; events: CollectionEvent[] }
    >();

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
      const nUrl =
        (evt as any).normalizedUrl || normalizeUrl(evt.meta?.url ?? "");
      if (nUrl) {
        const pKey = pageStatsKey(dom, nUrl);
        if (!keyToEvents.has(pKey)) {
          keyToEvents.set(pKey, { domain: dom, events: [] });
        }
        keyToEvents.get(pKey)!.events.push(evt);
      }
    }

    // Compute and write aggregates
    const tx = this.db!.transaction(
      [STATS_STORE_NAME, AGGREGATE_URLS_STORE_NAME],
      "readwrite",
    );
    const statsStore = tx.objectStore(STATS_STORE_NAME);
    const aggregateUrlsStore = tx.objectStore(AGGREGATE_URLS_STORE_NAME);
    statsStore.clear();
    aggregateUrlsStore.clear();

    for (const [key, { domain, events }] of keyToEvents) {
      const agg = LocalEventStore.emptyAggregate(key, domain);
      // Sort events by timestamp so session pairing works correctly
      events.sort((a, b) => a.ts - b.ts);
      const uniqueUrls = LocalEventStore.uniqueUrlsForEvents(events);
      agg.uniqueUrlCount = uniqueUrls.length;
      LocalEventStore.applyEventsToAggregate(agg, events);
      statsStore.put(agg);
      for (const url of uniqueUrls) {
        aggregateUrlsStore.put({
          aggregateKey: key,
          url,
        } satisfies AggregateUrl);
      }
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

    if (VERBOSE)
      console.log(`[LocalEventStore] Querying domain: ${domain}`, options);

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
          if (VERBOSE)
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
            options.limit === undefined
              ? events
              : events.slice(0, options.limit),
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
      sessionCount: number;
      activeDayCount: number;
      eventCounts: Record<string, number>;
      latestFaviconUrl?: string;
      recentFocusVisits: number[];
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
        sessionCount: number;
        activeDayCount: number;
        eventCounts: Record<string, number>;
        latestFaviconUrl?: string;
        recentFocusVisits: number[];
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
              uniquePageCount: aggregate.uniqueUrlCount,
              sessionCount: aggregate.sessionCount,
              activeDayCount: aggregate.activeDayCount ?? 0,
              eventCounts,
              ...(aggregate.latestFaviconUrl
                ? { latestFaviconUrl: aggregate.latestFaviconUrl }
                : {}),
              recentFocusVisits: aggregate.recentFocusVisits ?? [],
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
      const sampleCountsByType: Record<string, number> = {};
      const sampleSizesByType: Record<string, number> = {};
      let totalEvents = 0;
      let oldestEvent = 0;
      let newestEvent = 0;
      let pendingRequests = 3 + COLLECTION_EVENT_TYPES.length * 2;
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
        const estimatedSizeBytesByType: Record<string, number> = {};
        let estimatedSizeBytes = 0;
        for (const eventType of COLLECTION_EVENT_TYPES) {
          const typeSampleCount = sampleCountsByType[eventType] ?? 0;
          const typeCount = countsByType[eventType] ?? 0;
          if (typeSampleCount === 0 || typeCount === 0) continue;

          const typeSizeBytes = Math.round(
            ((sampleSizesByType[eventType] ?? 0) / typeSampleCount) * typeCount,
          );
          estimatedSizeBytesByType[eventType] = typeSizeBytes;
          estimatedSizeBytes += typeSizeBytes;
        }
        resolve({
          totalEvents,
          estimatedSizeBytes,
          estimatedSizeBytesByType,
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
          (oldestRequest.result?.value as StoredCollectionEvent | undefined)
            ?.ts ?? 0;
        complete();
      };
      oldestRequest.onerror = () => fail(oldestRequest.error);

      const newestRequest = tsIndex.openCursor(null, "prev");
      newestRequest.onsuccess = () => {
        newestEvent =
          (newestRequest.result?.value as StoredCollectionEvent | undefined)
            ?.ts ?? 0;
        complete();
      };
      newestRequest.onerror = () => fail(newestRequest.error);

      for (const eventType of COLLECTION_EVENT_TYPES) {
        const typeCountRequest = typeIndex.count(IDBKeyRange.only(eventType));
        typeCountRequest.onsuccess = () => {
          if (typeCountRequest.result > 0) {
            countsByType[eventType] = typeCountRequest.result;
          }
          complete();
        };
        typeCountRequest.onerror = () => fail(typeCountRequest.error);

        const typeSampleRequest = typeIndex.openCursor(
          IDBKeyRange.only(eventType),
        );
        typeSampleRequest.onsuccess = () => {
          const cursor = typeSampleRequest.result;
          const typeSampleCount = sampleCountsByType[eventType] ?? 0;
          if (cursor && typeSampleCount < STORAGE_SIZE_SAMPLE_LIMIT) {
            sampleCountsByType[eventType] = typeSampleCount + 1;
            sampleSizesByType[eventType] =
              (sampleSizesByType[eventType] ?? 0) +
              JSON.stringify(cursor.value).length;
            cursor.continue();
            return;
          }

          complete();
        };
        typeSampleRequest.onerror = () => fail(typeSampleRequest.error);
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
   * Read the event subset needed by the walking record without transferring
   * every high-frequency cursor sample to the new-tab page.
   */
  async getWalkingRecordEvents(
    options: Pick<QueryOptions, "startTs" | "endTs">,
  ): Promise<WalkingRecordEventResult> {
    await this.ensureInitialized();

    const { startTs, endTs } = options;
    if (startTs === undefined || endTs === undefined) {
      throw new Error("Walking record event bounds are required");
    }

    const sampleIntervalMs = 5 * 60_000;
    const activityWindowMs = 30_000;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const tsIndex = store.index("ts");
      const range = IDBKeyRange.bound(startTs, endTs);
      const request = tsIndex.openCursor(range);
      const events: CollectionEvent[] = [];
      const sampledCursorWindows = new Set<string>();
      const activityWindowsByUrl = new Map<string, Set<number>>();
      const sessions: ScreenTimeSession[] = [];
      const favicons = new Map<string, string>();
      let previousCursorEvent: CollectionEvent | null = null;
      let pendingFocus: { ts: number; url: string } | null = null;
      let cursorDistancePx = 0;

      const recordActivity = (event: CollectionEvent) => {
        const url = event.normalizedUrl ?? normalizeUrl(event.meta.url);
        if (!url) return;
        const windowStart =
          startTs +
          Math.floor((event.ts - startTs) / activityWindowMs) *
            activityWindowMs;
        const windows = activityWindowsByUrl.get(url) ?? new Set<number>();
        windows.add(windowStart);
        activityWindowsByUrl.set(url, windows);
      };

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          const visitedDomains = new Set(
            sessions.map((session) => extractDomain(session.url)),
          );
          resolve({
            events,
            cursorDistancePx,
            activity: [...activityWindowsByUrl].map(([url, windowStarts]) => ({
              url,
              windowStarts: [...windowStarts].sort((a, b) => a - b),
            })),
            sessions,
            favicons: Object.fromEntries(
              [...favicons].filter(([domain]) => visitedDomains.has(domain)),
            ),
          });
          return;
        }

        const storedEvent = cursor.value as StoredCollectionEvent;
        const event = toCollectionEvent(storedEvent);

        if (event.type === "navigation") {
          const data = event.data as NavigationEventData;
          if (data.event === "focus") {
            pendingFocus = { ts: event.ts, url: event.meta.url };
            const faviconUrl = data.favicon_url;
            if (
              typeof faviconUrl === "string" &&
              faviconUrl.length > 0 &&
              faviconUrl.length <= AGGREGATE_FAVICON_URL_LENGTH_LIMIT
            ) {
              try {
                const parsed = new URL(faviconUrl);
                if (
                  parsed.protocol === "https:" ||
                  parsed.protocol === "http:" ||
                  parsed.protocol === "data:"
                ) {
                  favicons.set(extractDomain(event.meta.url), faviconUrl);
                }
              } catch {
                // Ignore malformed favicon metadata from the visited page.
              }
            }
            events.push({
              ...event,
              data: { event: data.event },
            });
          } else if (
            (data.event === "blur" || data.event === "beforeunload") &&
            pendingFocus
          ) {
            const durationMs = event.ts - pendingFocus.ts;
            if (durationMs >= 1_000 && durationMs <= 8 * 60 * 60_000) {
              sessions.push({
                url: pendingFocus.url,
                focusTs: pendingFocus.ts,
                blurTs: event.ts,
                durationMs,
              });
            }
            pendingFocus = null;
          }
          if (data.event === "popstate") recordActivity(event);
        } else if (event.type === "cursor") {
          const data = event.data as CursorEventData;
          if (
            data.event === "move" ||
            data.event === "click" ||
            data.event === "hold" ||
            data.event === undefined
          ) {
            recordActivity(event);
          }
          if (data.event === "move" || data.event === undefined) {
            if (previousCursorEvent) {
              const previous = previousCursorEvent.data as CursorEventData;
              const previousUrl =
                previousCursorEvent.normalizedUrl ??
                normalizeUrl(previousCursorEvent.meta.url);
              const currentUrl =
                event.normalizedUrl ?? normalizeUrl(event.meta.url);
              if (
                previousUrl === currentUrl &&
                event.ts - previousCursorEvent.ts <= 5_000 &&
                Number.isFinite(previous.x) &&
                Number.isFinite(previous.y) &&
                Number.isFinite(data.x) &&
                Number.isFinite(data.y)
              ) {
                const width = event.meta.vw || previousCursorEvent.meta.vw;
                const height = event.meta.vh || previousCursorEvent.meta.vh;
                const dx = (data.x - previous.x) * width;
                const dy = (data.y - previous.y) * height;
                cursorDistancePx += Math.sqrt(dx * dx + dy * dy);
              }
            }
            previousCursorEvent = event;
          }

          const sampleWindow = Math.floor(
            (event.ts - startTs) / sampleIntervalMs,
          );
          const page = event.normalizedUrl ?? normalizeUrl(event.meta.url);
          const sampleKey = `cursor:${page}:${sampleWindow}`;
          if (!sampledCursorWindows.has(sampleKey)) {
            sampledCursorWindows.add(sampleKey);
            events.push(event);
          }
        } else if (event.type === "viewport") {
          const data = event.data as {
            event?: unknown;
            scrollDistancePx?: unknown;
          };
          if (
            data.event === "scroll" &&
            typeof data.scrollDistancePx === "number" &&
            data.scrollDistancePx > 0
          ) {
            recordActivity(event);
          }
        } else if (event.type === "keyboard") {
          recordActivity(event);
        }

        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getWalkingRecordFavicons(
    domains: string[],
  ): Promise<Record<string, string>> {
    await this.ensureInitialized();

    const requestedDomains = [
      ...new Set(domains.filter((domain) => domain.length > 0)),
    ];
    if (requestedDomains.length > WALKING_RECORD_FAVICON_DOMAIN_LIMIT) {
      throw new Error("Walking record favicon domain limit exceeded");
    }
    if (requestedDomains.length === 0) return {};

    if (!this.db) {
      throw new Error("Database not initialized");
    }

    const transaction = this.db.transaction([STORE_NAME], "readonly");
    const domainIndex = transaction.objectStore(STORE_NAME).index("domain");
    const entries = await Promise.all(
      requestedDomains.map(
        (domain) =>
          new Promise<[string, string] | null>((resolve, reject) => {
            const request = domainIndex.openCursor(IDBKeyRange.only(domain));
            let latest: { ts: number; url: string } | null = null;

            request.onsuccess = () => {
              const cursor = request.result;
              if (!cursor) {
                resolve(latest ? [domain, latest.url] : null);
                return;
              }

              const event = cursor.value as StoredCollectionEvent;
              if (event.type === "navigation") {
                const faviconUrl = (event.data as NavigationEventData)
                  .favicon_url;
                if (
                  typeof faviconUrl === "string" &&
                  faviconUrl.length <=
                    WALKING_RECORD_FAVICON_URL_LENGTH_LIMIT &&
                  event.ts > (latest?.ts ?? -Infinity)
                ) {
                  try {
                    const parsed = new URL(faviconUrl);
                    if (
                      parsed.protocol === "https:" ||
                      parsed.protocol === "http:" ||
                      parsed.protocol === "data:"
                    ) {
                      latest = { ts: event.ts, url: faviconUrl };
                    }
                  } catch {
                    // Ignore malformed favicon metadata from the visited page.
                  }
                }
              }
              cursor.continue();
            };
            request.onerror = () => reject(request.error);
          }),
      ),
    );

    return Object.fromEntries(
      entries.filter((entry): entry is [string, string] => entry !== null),
    );
  }

  /**
   * Extract representative cursor paths for cards and animated playback.
   * Card paths are simplified more heavily; playback keeps original timestamps.
   */
  async getWalkingRecordMovement(
    targets: WalkingRecordTraceTarget[],
  ): Promise<WalkingRecordMovement> {
    await this.ensureInitialized();

    if (targets.length > 16) {
      throw new Error("Walking record movement target limit exceeded");
    }
    if (targets.length === 0) {
      return { traces: [], landscapePaths: [] };
    }

    for (const target of targets) {
      if (
        !target.id ||
        !/^https?:\/\//.test(target.url) ||
        !Number.isFinite(target.startTs) ||
        !Number.isFinite(target.endTs) ||
        target.endTs < target.startTs
      ) {
        throw new Error("Walking record movement target is invalid");
      }
    }

    const collectors = new Map(
      targets.map((target) => [
        target.id,
        {
          target,
          normalizedUrl: normalizeUrl(target.url),
          paths: [] as TimedTracePoint[][],
          currentPath: [] as TimedTracePoint[],
        },
      ]),
    );

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const tsIndex = store.index("ts");
      let remainingCollectors = collectors.size;

      const finish = () => {
        const completed = [...collectors.values()].map((collector) => {
          if (collector.currentPath.length >= 2) {
            collector.paths.push(collector.currentPath);
          }

          const rankedPaths = collector.paths
            .map((points, index) => ({
              points,
              index,
              distance: tracePathDistance(points),
            }))
            .filter(({ points }) => points.length >= 2)
            .sort((a, b) => b.distance - a.distance);

          const selectedPaths = rankedPaths
            .slice(0, 3)
            .sort((a, b) => a.index - b.index);
          const paths = selectedPaths.map(({ points }) =>
            simplifyTracePath(points),
          );
          const landscapePaths = evenlySpacedPaths(
            rankedPaths
              .slice(0, LANDSCAPE_SOURCE_PATH_LIMIT)
              .sort((a, b) => a.index - b.index)
              .flatMap(({ points }) => splitLandscapePath(points)),
            LANDSCAPE_SEGMENTS_PER_TARGET,
          ).map((points) => points.map(({ event }) => event));

          return {
            trace: { targetId: collector.target.id, paths },
            landscapePaths,
          };
        });
        resolve({
          traces: completed.map(({ trace }) => trace),
          landscapePaths: completed
            .flatMap(({ landscapePaths }) => landscapePaths)
            .filter((path) => path.length >= 2),
        });
      };

      for (const collector of collectors.values()) {
        const request = tsIndex.openCursor(
          IDBKeyRange.bound(collector.target.startTs, collector.target.endTs),
        );

        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            remainingCollectors -= 1;
            if (remainingCollectors === 0) finish();
            return;
          }

          const event = cursor.value as StoredCollectionEvent;
          if (event.type === "cursor") {
            const data = event.data as CursorEventData;
            const eventUrl =
              event.normalizedUrl ?? normalizeUrl(event.meta.url);

            if (
              eventUrl === collector.normalizedUrl &&
              (data.event === "move" || data.event === undefined) &&
              Number.isFinite(data.x) &&
              Number.isFinite(data.y)
            ) {
              const point: TimedTracePoint = {
                x: Math.max(0, Math.min(1, data.x)),
                y: Math.max(0, Math.min(1, data.y)),
                ts: event.ts,
                event: toCollectionEvent(event),
              };
              const previous = collector.currentPath.at(-1);

              if (previous && point.ts - previous.ts > 5_000) {
                if (
                  collector.currentPath.length >= 2 &&
                  collector.paths.length < 256
                ) {
                  collector.paths.push(collector.currentPath);
                }
                collector.currentPath = [];
              }

              const lastAccepted = collector.currentPath.at(-1);
              if (
                !lastAccepted ||
                squaredDistance(lastAccepted, point) >= 0.000004 ||
                point.ts - lastAccepted.ts >= 500
              ) {
                collector.currentPath.push(point);
              }

              if (collector.currentPath.length >= 1_024) {
                const lastPoint = collector.currentPath.at(-1)!;
                collector.currentPath = collector.currentPath.filter(
                  (_, index) => index % 2 === 0,
                );
                if (collector.currentPath.at(-1) !== lastPoint) {
                  collector.currentPath.push(lastPoint);
                }
              }
            }
          }

          cursor.continue();
        };

        request.onerror = () => reject(request.error);
      }
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
   */
  async getScreenTime(
    options: Pick<QueryOptions, "startTs" | "endTs"> = {},
  ): Promise<ScreenTimeResult> {
    await this.ensureInitialized();

    const navEvents = await this.queryByType("navigation", options);
    navEvents.sort((a, b) => a.ts - b.ts);

    // Pair focus → blur into sessions
    const sessions: ScreenTimeSession[] = [];
    let pendingFocus: { ts: number; url: string } | null = null;

    for (const evt of navEvents) {
      const d = evt.data as NavigationEventData;
      if (d.event === "focus") {
        pendingFocus = { ts: evt.ts, url: evt.meta.url };
      } else if (
        (d.event === "blur" || d.event === "beforeunload") &&
        pendingFocus
      ) {
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
    return { totalMs, sessions };
  }

  /**
   * Add a batch of events using ID upserts and canonical scrap deduplication.
   * Incrementally updates aggregates for accepted events.
   */
  async addEvents(events: CollectionEvent[]): Promise<void> {
    await this.ensureInitialized();

    if (events.length === 0) return;

    const canUpdateStats = await this.canUpdateStatsIncrementally();

    const storedEventsById = new Map<string, StoredCollectionEvent>();
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
      if (storedEvent.type === "element") {
        const canonicalScrapKey = getCanonicalScrapKey(
          storedEvent.domain ?? "",
          storedEvent.data,
        );
        if (canonicalScrapKey !== undefined) {
          storedEvent.canonicalScrapKey = canonicalScrapKey;
        }
      }
      storedEventsById.set(storedEvent.id, storedEvent);
    }
    const canonicalScrapKeys = new Set<string>();
    const storedEvents = [...storedEventsById.values()].filter((event) => {
      if (event.canonicalScrapKey === undefined) return true;
      if (canonicalScrapKeys.has(event.canonicalScrapKey)) return false;
      canonicalScrapKeys.add(event.canonicalScrapKey);
      return true;
    });
    let eventsForStats = storedEvents.map(toCollectionEvent);

    if (!canUpdateStats) {
      this.queueEventsForStatsAfterBackfill(eventsForStats);
    }

    // Write events to the main store
    try {
      const insertedEvents = await new Promise<StoredCollectionEvent[]>(
        (resolve, reject) => {
          if (!this.db) {
            reject(new Error("Database not initialized"));
            return;
          }

          const transaction = this.db.transaction([STORE_NAME], "readwrite");
          const evtStore = transaction.objectStore(STORE_NAME);
          const canonicalScrapIndex = evtStore.index("canonicalScrapKey");
          const insertedEvents: StoredCollectionEvent[] = [];

          transaction.oncomplete = () => resolve(insertedEvents);
          transaction.onerror = () => reject(transaction.error);

          const writeEvent = (event: StoredCollectionEvent) => {
            if (!canUpdateStats) {
              evtStore.put(event);
              insertedEvents.push(event);
              return;
            }

            const getKeyRequest = evtStore.getKey(event.id);
            getKeyRequest.onsuccess = () => {
              if (getKeyRequest.result === undefined) {
                insertedEvents.push(event);
              }
              evtStore.put(event);
            };
          };

          for (const event of storedEvents) {
            if (event.canonicalScrapKey === undefined) {
              writeEvent(event);
              continue;
            }

            const canonicalKeyRequest = canonicalScrapIndex.getKey(
              event.canonicalScrapKey,
            );
            canonicalKeyRequest.onsuccess = () => {
              if (canonicalKeyRequest.result === undefined) {
                writeEvent(event);
              }
            };
          }
        },
      );

      if (!canUpdateStats) {
        const insertedEventIds = new Set(
          insertedEvents.map((event) => event.id),
        );
        this.removeEventsQueuedForStatsAfterBackfill(
          eventsForStats.filter((event) => !insertedEventIds.has(event.id)),
        );
      }
      eventsForStats = insertedEvents.map(toCollectionEvent);
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
    if (eventsForStats.length > 0) {
      const eventsByDomain =
        LocalEventStore.groupEventsByDomain(eventsForStats);
      try {
        await this.updateDomainStats(eventsForStats, eventsByDomain);
      } catch (e) {
        console.error("[LocalEventStore] Failed to update domain stats:", e);
      }

      try {
        await this.upsertAggregateDays(eventsForStats);
      } catch (e) {
        console.error("[LocalEventStore] Failed to update active days:", e);
      }
    }
  }

  /** Rebuild aggregates after importing event history from a file. */
  async addImportedEvents(events: CollectionEvent[]): Promise<void> {
    await this.ensureSessionStatsBackfilled();
    await this.addEvents(events);
    await this.rebuildSessionStats();
    await this.rebuildAggregateDays();
    await this.writeDaysBackfillState("complete");
    this.daysBackfillComplete = true;
    await this.writeStatsBackfillState("complete");
    this.statsBackfillComplete = true;
  }

  /** Store server-restored history as uploaded before rebuilding aggregates. */
  async addRestoredEvents(events: CollectionEvent[]): Promise<void> {
    await this.addImportedEvents(
      events.map((event) => ({ ...event, uploaded: true })),
    );
  }

  private static emptyAggregate(
    key: string,
    domain: string,
  ): DomainStatsAggregate {
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
      uniqueUrlCount: 0,
      activeDayCount: 0,
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

  private static uniqueUrlsForEvents(events: CollectionEvent[]): string[] {
    if (!events.some((event) => event.type === "navigation")) {
      return [];
    }

    const uniqueUrls = new Set<string>();
    for (const event of events) {
      if (event.meta?.url) {
        uniqueUrls.add(event.meta.url);
      }
    }
    return [...uniqueUrls];
  }

  /**
   * Apply a batch of events to a single aggregate, mutating it in place.
   */
  private static applyEventsToAggregate(
    agg: DomainStatsAggregate,
    events: CollectionEvent[],
  ): void {
    agg.storageSizeBytes ??= 0;

    for (const evt of events) {
      const previousLastVisit = agg.lastVisit;
      agg.eventsByType[evt.type] = (agg.eventsByType[evt.type] ?? 0) + 1;
      agg.storageSizeBytes += JSON.stringify(evt).length;
      if (agg.firstVisit === 0 || evt.ts < agg.firstVisit) {
        agg.firstVisit = evt.ts;
      }
      if (evt.ts > agg.lastVisit) {
        agg.lastVisit = evt.ts;
      }

      if (evt.type === "navigation") {
        const d = evt.data as NavigationEventData;
        if (d.event === "focus") {
          if (agg.domain && !agg.key.includes("::")) {
            const faviconUrl = d.favicon_url;
            if (
              typeof faviconUrl === "string" &&
              faviconUrl.length > 0 &&
              faviconUrl.length <= AGGREGATE_FAVICON_URL_LENGTH_LIMIT
            ) {
              agg.latestFaviconUrl = faviconUrl;
            }

            const visitDay = localDayKey(evt.ts, evt.meta.tz);
            const recentVisits =
              agg.recentFocusVisits ??
              (previousLastVisit > 0 && previousLastVisit < evt.ts
                ? [previousLastVisit]
                : []);
            agg.recentFocusVisits = [
              evt.ts,
              ...recentVisits.filter(
                (timestamp) => localDayKey(timestamp, evt.meta.tz) !== visitDay,
              ),
            ].slice(0, RECENT_FOCUS_VISIT_LIMIT);
          }

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

    if (agg.key === GLOBAL_STATS_KEY) {
      LocalEventStore.applyEventsToMilestoneActivity(agg, events);
    }
  }

  private static applyEventsToMilestoneActivity(
    agg: DomainStatsAggregate,
    events: CollectionEvent[],
  ): void {
    for (const evt of [...events].sort((a, b) => a.ts - b.ts)) {
      const eventDay = localDayKey(evt.ts, evt.meta.tz);
      if (
        agg.milestoneActivity &&
        eventDay < agg.milestoneActivity.localDayKey
      ) {
        continue;
      }
      if (agg.milestoneActivity?.localDayKey !== eventDay) {
        agg.milestoneActivity = {
          localDayKey: eventDay,
          cursorDistancePx: 0,
          lastCursorPosition: null,
          screenTimeMs: 0,
          pendingFocusTs: null,
        };
      }

      const activity = agg.milestoneActivity;
      if (evt.type === "cursor") {
        const data = evt.data as CursorEventData;
        if (
          data.event === "move" &&
          Number.isFinite(data.x) &&
          Number.isFinite(data.y)
        ) {
          if (activity.lastCursorPosition) {
            const dx = (data.x - activity.lastCursorPosition.x) * 1920;
            const dy = (data.y - activity.lastCursorPosition.y) * 1080;
            activity.cursorDistancePx += Math.sqrt(dx * dx + dy * dy);
          }
          activity.lastCursorPosition = { x: data.x, y: data.y };
        }
      } else if (evt.type === "navigation") {
        const data = evt.data as NavigationEventData;
        if (data.event === "focus") {
          activity.pendingFocusTs = evt.ts;
        } else if (
          (data.event === "blur" || data.event === "beforeunload") &&
          activity.pendingFocusTs !== null
        ) {
          activity.screenTimeMs += Math.max(
            0,
            evt.ts - activity.pendingFocusTs,
          );
          activity.pendingFocusTs = null;
        }
      }
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
    const keyToEvents = new Map<
      string,
      { domain: string; events: CollectionEvent[] }
    >();

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
        const nUrl =
          (evt as any).normalizedUrl || normalizeUrl(evt.meta?.url ?? "");
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

      const transaction = this.db.transaction(
        [STATS_STORE_NAME, AGGREGATE_URLS_STORE_NAME],
        "readwrite",
      );
      const statsStore = transaction.objectStore(STATS_STORE_NAME);
      const aggregateUrlsStore = transaction.objectStore(
        AGGREGATE_URLS_STORE_NAME,
      );

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const [key, { domain, events }] of keyToEvents) {
        const getReq = statsStore.get(key);
        getReq.onsuccess = () => {
          const agg: DomainStatsAggregate =
            getReq.result ?? LocalEventStore.emptyAggregate(key, domain);

          LocalEventStore.applyEventsToAggregate(agg, events);
          const uniqueUrls = LocalEventStore.uniqueUrlsForEvents(events);
          if (uniqueUrls.length === 0) {
            statsStore.put(agg);
            return;
          }

          let pendingUrlReads = uniqueUrls.length;
          let addedUrlCount = 0;
          const finishUrlRead = () => {
            pendingUrlReads--;
            if (pendingUrlReads > 0) return;

            agg.uniqueUrlCount += addedUrlCount;
            statsStore.put(agg);
          };

          for (const url of uniqueUrls) {
            const getUrlRequest = aggregateUrlsStore.getKey([key, url]);
            getUrlRequest.onsuccess = () => {
              if (getUrlRequest.result === undefined) {
                aggregateUrlsStore.put({
                  aggregateKey: key,
                  url,
                } satisfies AggregateUrl);
                addedUrlCount++;
              }
              finishUrlRead();
            };
          }
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
      const request = uploadStateIndex.openCursor(
        IDBKeyRange.only(UPLOAD_STATE_PENDING),
      );

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
        [
          STORE_NAME,
          STATS_STORE_NAME,
          AGGREGATE_URLS_STORE_NAME,
          AGGREGATE_DAYS_STORE_NAME,
        ],
        "readwrite",
      );
      const evtStore = transaction.objectStore(STORE_NAME);
      const statsStore = transaction.objectStore(STATS_STORE_NAME);
      const aggregateUrlsStore = transaction.objectStore(
        AGGREGATE_URLS_STORE_NAME,
      );
      const aggregateDaysStore = transaction.objectStore(
        AGGREGATE_DAYS_STORE_NAME,
      );
      evtStore.clear();
      statsStore.clear();
      aggregateUrlsStore.clear();
      aggregateDaysStore.clear();
      transaction.oncomplete = () => {
        this.statsBackfillComplete = false;
        this.daysBackfillComplete = false;
        resolve();
      };
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
      const request = tsIndex.openCursor(
        IDBKeyRange.upperBound(cutoffTs, true),
      );

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
