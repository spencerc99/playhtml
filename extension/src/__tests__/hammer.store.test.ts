// ABOUTME: Tests page-scoped local persistence for hammer impact records.
// ABOUTME: Covers reload, bounded repeated hits, undo order, URL scoping, and corrupt storage.

import { describe, expect, it } from "vitest";
import {
  HammerStore,
  pageHammerStorageKey,
  type HammerHitRecord,
} from "../features/hammer/HammerStore";

function hit(id: string, selector: string, createdAt: number): HammerHitRecord {
  return {
    id,
    selector,
    point: { x: 0.5, y: 0.5 },
    createdAt,
  };
}

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    async get(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(
        keys
          .filter((candidate) => candidate in data)
          .map((candidate) => [candidate, data[candidate]]),
      );
    },
    async set(items: Record<string, unknown>) {
      Object.assign(data, items);
    },
  };
}

describe("HammerStore", () => {
  it("persists and reloads impacts for the current page", async () => {
    const storage = memoryStorage();
    const first = new HammerStore("https://example.com/art#one", storage);
    await first.load();
    await first.put(hit("a", "#card", 1));

    const second = new HammerStore("https://example.com/art#two", storage);
    expect(await second.load()).toEqual([hit("a", "#card", 1)]);
  });

  it("keeps only the six newest impacts on one target", async () => {
    const store = new HammerStore("https://example.com/", memoryStorage());
    await store.load();
    for (let index = 0; index < 8; index += 1) {
      await store.put(hit(`hit-${index}`, "#card", index));
    }

    expect(store.list().map((record) => record.id)).toEqual([
      "hit-2",
      "hit-3",
      "hit-4",
      "hit-5",
      "hit-6",
      "hit-7",
    ]);
  });

  it("caps one target without removing interleaved impacts on another", async () => {
    const store = new HammerStore("https://example.com/", memoryStorage());
    await store.load();
    await store.put(hit("other", "#other", 0));
    for (let index = 0; index < 7; index += 1) {
      await store.put(hit(`card-${index}`, "#card", index + 1));
    }

    expect(store.list().map((record) => record.id)).toEqual([
      "other",
      "card-1",
      "card-2",
      "card-3",
      "card-4",
      "card-5",
      "card-6",
    ]);
  });

  it("undoes the most recently created impact", async () => {
    const store = new HammerStore("https://example.com/", memoryStorage());
    await store.load();
    await store.put(hit("newer", "#one", 20));
    await store.put(hit("older", "#two", 10));

    expect(await store.removeLatest()).toEqual([hit("older", "#two", 10)]);
  });

  it("uses a URL key without the hash and rejects malformed data", async () => {
    expect(pageHammerStorageKey("https://example.com/#a")).toBe(
      pageHammerStorageKey("https://example.com/#b"),
    );
    const key = pageHammerStorageKey("https://example.com/");
    const store = new HammerStore(
      "https://example.com/",
      memoryStorage({ [key]: [{ selector: "#missing-fields" }] }),
    );

    await expect(store.load()).rejects.toThrow("Invalid hammer data");
  });

  it("restores memory state when persistence fails", async () => {
    const storage = memoryStorage();
    const store = new HammerStore("https://example.com/", {
      get: storage.get,
      async set() {
        throw new Error("disk unavailable");
      },
    });
    await store.load();

    await expect(store.put(hit("failed", "#card", 1))).rejects.toThrow(
      "disk unavailable",
    );
    expect(store.list()).toEqual([]);
  });
});
