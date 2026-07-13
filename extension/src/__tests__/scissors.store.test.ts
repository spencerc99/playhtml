// ABOUTME: Tests page-scoped local persistence for scissors cut records.
// ABOUTME: Covers reload, per-element replacement, undo order, URL scoping, and corrupt storage.

import { describe, expect, it } from "vitest";
import {
  CutStore,
  pageCutStorageKey,
  type CutRecord,
} from "../features/scissors/CutStore";

function cut(
  id: string,
  selector: string,
  createdAt: number,
): CutRecord {
  return {
    id,
    selector,
    start: { x: 0, y: 0.5 },
    end: { x: 1, y: 0.5 },
    gap: 20,
    createdAt,
  };
}

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    data,
    async get(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(
        keys.filter((candidate) => candidate in data).map((candidate) => [candidate, data[candidate]]),
      );
    },
    async set(items: Record<string, unknown>) {
      Object.assign(data, items);
    },
  };
}

describe("CutStore", () => {
  it("persists and reloads cuts for the current page", async () => {
    const storage = memoryStorage();
    const first = new CutStore("https://example.com/art?mode=1#section", storage);
    await first.load();
    await first.put(cut("a", "#card", 1));

    const second = new CutStore("https://example.com/art?mode=1#other", storage);
    expect(await second.load()).toEqual([cut("a", "#card", 1)]);
  });

  it("keeps query-distinct pages separate and ignores hashes", () => {
    expect(pageCutStorageKey("https://example.com/art?mode=1#a")).toBe(
      pageCutStorageKey("https://example.com/art?mode=1#b"),
    );
    expect(pageCutStorageKey("https://example.com/art?mode=1")).not.toBe(
      pageCutStorageKey("https://example.com/art?mode=2"),
    );
  });

  it("replaces an earlier cut on the same element", async () => {
    const storage = memoryStorage();
    const store = new CutStore("https://example.com/", storage);
    await store.load();
    await store.put(cut("a", "#card", 1));

    expect(await store.put(cut("b", "#card", 2))).toEqual([
      cut("b", "#card", 2),
    ]);
  });

  it("undoes the most recently created cut", async () => {
    const storage = memoryStorage();
    const store = new CutStore("https://example.com/", storage);
    await store.load();
    await store.put(cut("newer", "#one", 20));
    await store.put(cut("older", "#two", 10));

    expect(await store.removeLatest()).toEqual([cut("older", "#two", 10)]);
  });

  it("rejects malformed stored data", async () => {
    const key = pageCutStorageKey("https://example.com/");
    const storage = memoryStorage({ [key]: [{ selector: "#missing-fields" }] });
    const store = new CutStore("https://example.com/", storage);

    await expect(store.load()).rejects.toThrow("Invalid scissors data");
  });

  it("rolls memory back when persistence fails", async () => {
    const storage = memoryStorage();
    const store = new CutStore("https://example.com/", storage);
    await store.load();
    await store.put(cut("kept", "#one", 1));
    storage.set = async () => {
      throw new Error("storage unavailable");
    };

    await expect(store.put(cut("lost", "#two", 2))).rejects.toThrow(
      "storage unavailable",
    );
    expect(store.list()).toEqual([cut("kept", "#one", 1)]);
  });
});
