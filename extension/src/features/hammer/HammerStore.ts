// ABOUTME: Persists hammer impacts for one page in extension-local browser storage.
// ABOUTME: Caps repeated damage per target and keeps storage failures from corrupting memory state.

import browser from "webextension-polyfill";
import type { Point } from "../scissors/geometry";

export interface HammerHitRecord {
  id: string;
  selector: string;
  point: Point;
  createdAt: number;
}

interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const STORAGE_PREFIX = "inventory:hammer:hits:v1:";
const MAX_HITS_PER_TARGET = 6;

export function pageHammerStorageKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return `${STORAGE_PREFIX}${parsed.toString()}`;
}

function isHammerHitRecord(value: unknown): value is HammerHitRecord {
  if (!value || typeof value !== "object") return false;
  const hit = value as Record<string, unknown>;
  if (!hit.point || typeof hit.point !== "object") return false;
  const point = hit.point as Record<string, unknown>;
  return (
    typeof hit.id === "string" &&
    typeof hit.selector === "string" &&
    typeof point.x === "number" &&
    typeof point.y === "number" &&
    typeof hit.createdAt === "number"
  );
}

export class HammerStore {
  private hits: HammerHitRecord[] = [];
  private readonly storageKey: string;

  constructor(
    pageUrl: string,
    private storage: StorageArea = browser.storage.local,
  ) {
    this.storageKey = pageHammerStorageKey(pageUrl);
  }

  async load(): Promise<HammerHitRecord[]> {
    const result = await this.storage.get(this.storageKey);
    const stored = result[this.storageKey];
    if (stored === undefined) {
      this.hits = [];
      return [];
    }
    if (!Array.isArray(stored) || !stored.every(isHammerHitRecord)) {
      throw new Error(`Invalid hammer data at ${this.storageKey}`);
    }
    this.hits = stored;
    return this.list();
  }

  list(): HammerHitRecord[] {
    return this.hits.map((hit) => ({ ...hit, point: { ...hit.point } }));
  }

  async put(hit: HammerHitRecord): Promise<HammerHitRecord[]> {
    const previousHits = this.list();
    this.hits.push(hit);
    const matching = this.hits
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => record.selector === hit.selector);
    if (matching.length > MAX_HITS_PER_TARGET) {
      const indexesToRemove = matching
        .slice(0, matching.length - MAX_HITS_PER_TARGET)
        .map(({ index }) => index)
        .reverse();
      for (const index of indexesToRemove) this.hits.splice(index, 1);
    }
    try {
      await this.persist();
    } catch (error) {
      this.hits = previousHits;
      throw error;
    }
    return this.list();
  }

  async removeLatest(): Promise<HammerHitRecord[]> {
    const previousHits = this.list();
    let latestIndex = -1;
    for (let index = 0; index < this.hits.length; index += 1) {
      if (
        latestIndex === -1 ||
        this.hits[index].createdAt > this.hits[latestIndex].createdAt
      ) {
        latestIndex = index;
      }
    }
    if (latestIndex !== -1) {
      this.hits.splice(latestIndex, 1);
      try {
        await this.persist();
      } catch (error) {
        this.hits = previousHits;
        throw error;
      }
    }
    return this.list();
  }

  private async persist(): Promise<void> {
    await this.storage.set({ [this.storageKey]: this.hits });
  }
}
