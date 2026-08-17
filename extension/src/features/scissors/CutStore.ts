// ABOUTME: Persists the scissors cuts for one page in extension-local browser storage.
// ABOUTME: Keeps the storage boundary separate from rendering so shared persistence can replace it later.

import browser from "webextension-polyfill";
import type { CutStyle, Point } from "./geometry";

export interface CutRecord {
  id: string;
  selector: string;
  start: Point;
  end: Point;
  gap: number;
  style: CutStyle;
  seed: number;
  createdAt: number;
}

interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const STORAGE_PREFIX = "inventory:scissors:cuts:v2:";

export function pageCutStorageKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return `${STORAGE_PREFIX}${parsed.toString()}`;
}

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === "number" && typeof point.y === "number";
}

function isCutRecord(value: unknown): value is CutRecord {
  if (!value || typeof value !== "object") return false;
  const cut = value as Record<string, unknown>;
  return (
    typeof cut.id === "string" &&
    typeof cut.selector === "string" &&
    isPoint(cut.start) &&
    isPoint(cut.end) &&
    typeof cut.gap === "number" &&
    (cut.style === "paper" || cut.style === "cloth" || cut.style === "pixel") &&
    typeof cut.seed === "number" &&
    typeof cut.createdAt === "number"
  );
}

export class CutStore {
  private cuts: CutRecord[] = [];
  private readonly storageKey: string;

  constructor(
    pageUrl: string,
    private storage: StorageArea = browser.storage.local,
  ) {
    this.storageKey = pageCutStorageKey(pageUrl);
  }

  async load(): Promise<CutRecord[]> {
    const result = await this.storage.get(this.storageKey);
    const stored = result[this.storageKey];
    if (stored === undefined) {
      this.cuts = [];
      return [];
    }
    if (!Array.isArray(stored) || !stored.every(isCutRecord)) {
      throw new Error(`Invalid scissors data at ${this.storageKey}`);
    }
    this.cuts = stored;
    return this.list();
  }

  list(): CutRecord[] {
    return this.cuts.map((cut) => ({
      ...cut,
      start: { ...cut.start },
      end: { ...cut.end },
    }));
  }

  async put(cut: CutRecord): Promise<CutRecord[]> {
    const previousCuts = this.list();
    const existingIndex = this.cuts.findIndex(
      (existing) => existing.selector === cut.selector,
    );
    if (existingIndex === -1) {
      this.cuts.push(cut);
    } else {
      this.cuts.splice(existingIndex, 1, cut);
    }
    try {
      await this.persist();
    } catch (error) {
      this.cuts = previousCuts;
      throw error;
    }
    return this.list();
  }

  async removeLatest(): Promise<CutRecord[]> {
    const previousCuts = this.list();
    let latestIndex = -1;
    for (let index = 0; index < this.cuts.length; index += 1) {
      if (
        latestIndex === -1 ||
        this.cuts[index].createdAt > this.cuts[latestIndex].createdAt
      ) {
        latestIndex = index;
      }
    }
    if (latestIndex !== -1) {
      this.cuts.splice(latestIndex, 1);
      try {
        await this.persist();
      } catch (error) {
        this.cuts = previousCuts;
        throw error;
      }
    }
    return this.list();
  }

  private async persist(): Promise<void> {
    await this.storage.set({ [this.storageKey]: this.cuts });
  }
}
