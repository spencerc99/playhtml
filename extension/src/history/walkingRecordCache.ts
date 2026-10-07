// ABOUTME: Persists recent walking records so new tabs can render them immediately.
// ABOUTME: Keeps a bounded set of snapshots with a fifteen-minute freshness window.

import browser from "webextension-polyfill";
import type {
  WalkingRecord,
  WalkingRecordPeriod,
  WalkingRecordRange,
} from "./walkingRecord";

const STORAGE_KEY = "walking_record_cache";
const CACHE_ENTRY_LIMIT = 6;
export const WALKING_RECORD_CACHE_MAX_AGE_MS = 15 * 60_000;

interface WalkingRecordCacheEntry {
  key: string;
  cachedAt: number;
  record: WalkingRecord;
}

interface WalkingRecordCacheStore {
  entries: WalkingRecordCacheEntry[];
}

export interface CachedWalkingRecord {
  record: WalkingRecord;
  fresh: boolean;
}

export function walkingRecordCacheKey(
  period: WalkingRecordPeriod,
  range: WalkingRecordRange,
  baseColor: string,
): string {
  return `${period}:${range.startTs}:${baseColor}`;
}

function isWalkingRecord(value: unknown): value is WalkingRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<WalkingRecord>;
  return (
    (record.period === "week" ||
      record.period === "month" ||
      record.period === "year") &&
    !!record.range &&
    Number.isFinite(record.range.startTs) &&
    Number.isFinite(record.range.endTs) &&
    typeof record.rangeLabel === "string" &&
    typeof record.totalTimeLabel === "string" &&
    Array.isArray(record.hourBuckets) &&
    Array.isArray(record.departures) &&
    Array.isArray(record.settledPlaces) &&
    Array.isArray(record.dayPlates) &&
    Array.isArray(record.landscapePaths) &&
    Array.isArray(record.timeSpent)
  );
}

function cacheEntries(value: unknown): WalkingRecordCacheEntry[] {
  if (!value || typeof value !== "object") return [];
  const store = value as Partial<WalkingRecordCacheStore>;
  if (!Array.isArray(store.entries)) return [];

  return store.entries.filter((entry): entry is WalkingRecordCacheEntry => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Partial<WalkingRecordCacheEntry>;
    return (
      typeof candidate.key === "string" &&
      Number.isFinite(candidate.cachedAt) &&
      isWalkingRecord(candidate.record)
    );
  });
}

async function readCacheEntries(): Promise<WalkingRecordCacheEntry[]> {
  const stored = (await browser.storage.local.get(STORAGE_KEY)) as Record<
    string,
    unknown
  >;
  return cacheEntries(stored[STORAGE_KEY]);
}

export async function readWalkingRecordCache(
  key: string,
  now = Date.now(),
): Promise<CachedWalkingRecord | null> {
  const entry = (await readCacheEntries()).find(
    (candidate) => candidate.key === key,
  );
  if (!entry) return null;

  return {
    record: entry.record,
    fresh:
      entry.cachedAt >= entry.record.range.endTs &&
      now - entry.cachedAt >= 0 &&
      now - entry.cachedAt <= WALKING_RECORD_CACHE_MAX_AGE_MS,
  };
}

export async function writeWalkingRecordCache(
  key: string,
  record: WalkingRecord,
  cachedAt = Date.now(),
): Promise<void> {
  const entries = (await readCacheEntries())
    .filter((entry) => entry.key !== key)
    .concat({ key, cachedAt, record })
    .sort((first, second) => second.cachedAt - first.cachedAt)
    .slice(0, CACHE_ENTRY_LIMIT);

  const cache: WalkingRecordCacheStore = {
    entries,
  };
  await browser.storage.local.set({ [STORAGE_KEY]: cache });
}
