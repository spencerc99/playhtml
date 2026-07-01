// ABOUTME: Tests for found-item count persistence in browser.storage.local.
// ABOUTME: Installs a stateful in-memory storage fake so persist->reload is genuinely exercised.

import { describe, it, expect, beforeEach } from "vitest";
import browser from "webextension-polyfill";
import { HeldStore } from "../features/inventory/held-store";

// Install a stateful fake over the (non-stateful) global webextension-polyfill mock.
let store: Record<string, unknown>;
beforeEach(() => {
  store = {};
  browser.storage.local.get = (async (keys?: string | string[]) => {
    const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) if (k in store) out[k] = store[k];
    return out;
  }) as typeof browser.storage.local.get;
  browser.storage.local.set = (async (items: Record<string, unknown>) => {
    Object.assign(store, items);
  }) as typeof browser.storage.local.set;
});

describe("HeldStore", () => {
  it("returns 0 for an unknown found item before load", async () => {
    const s = new HeldStore();
    await s.load();
    expect(s.count("beacon")).toBe(0);
  });

  it("persists and reloads found counts", async () => {
    const s1 = new HeldStore();
    await s1.load();
    await s1.set("beacon", 3);
    const s2 = new HeldStore();
    await s2.load();
    expect(s2.count("beacon")).toBe(3);
  });
});
