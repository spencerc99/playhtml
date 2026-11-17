// ABOUTME: Verifies plain snapshots of shared store values match clonePlain exactly.
// ABOUTME: Proxies skip the structuredClone attempt; other values clone as before.
import { afterEach, describe, expect, it, vi } from "vitest";
import { getYjsDoc, syncedStore } from "@syncedstore/core";
import { clonePlain } from "@playhtml/common";
import { cloneStoreValue } from "../utils";
import { createPageDataChannel, PAGE_TAG } from "../page-data";

type PlayShape = { play: Record<string, Record<string, unknown>> };

function makeProxy<T>(value: T): T {
  const store = syncedStore<PlayShape>({ play: {} });
  store.play.tag = {};
  store.play.tag.el = value as unknown;
  return store.play.tag.el as T;
}

function cyclic() {
  const node: Record<string, unknown> = { name: "loop" };
  node.self = node;
  return node;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cloneStoreValue", () => {
  it("clonePlain on a store proxy throws inside structuredClone (the cost being avoided)", () => {
    const proxy = makeProxy({ count: 1 });
    const spy = vi.spyOn(globalThis, "structuredClone");
    clonePlain(proxy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.results[0].type).toBe("throw");
  });

  it.each([
    ["object", { count: 3, nested: { list: [1, 2, { x: "y" }] } }],
    ["array", [[1, 2], [3, [4, 5]], { a: [6] }]],
    ["object with null and booleans", { a: null, b: true, c: "s", d: 0 }],
  ])("matches clonePlain for a %s proxy without calling structuredClone", (_label, value) => {
    const expected = JSON.stringify(clonePlain(makeProxy(value)));
    const proxy = makeProxy(value);
    const spy = vi.spyOn(globalThis, "structuredClone");
    const result = cloneStoreValue(proxy);
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toBe(expected);
    expect(result).toEqual(value);
    // The snapshot is detached from the store.
    expect(result).not.toBe(proxy);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["number", 42],
    ["string", "hello"],
    ["plain object", { a: 1, b: [1, { c: 2 }] }],
    ["nested arrays", [[1, [2, [3]]], []]],
    ["Date", new Date("2026-01-02T03:04:05Z")],
    ["Map", new Map<string, unknown>([["k", { v: 1 }]])],
    ["typed array", new Uint8Array([1, 2, 3])],
    ["cyclic object", cyclic()],
  ])("clones a non-proxy %s exactly like clonePlain", (_label, value) => {
    const expected = clonePlain(value);
    const result = cloneStoreValue(value);
    expect(result).toEqual(expected);
    // Same kind of value as clonePlain returns (Date stays Date, Map stays Map).
    expect(Object.prototype.toString.call(result)).toBe(
      Object.prototype.toString.call(expected),
    );
    if (value !== null && typeof value === "object") expect(result).not.toBe(value);
  });

  it("page data reads and notifications never attempt structuredClone on the proxy", async () => {
    const store = syncedStore<PlayShape>({ play: {} });
    const doc = getYjsDoc(store);
    const channel = createPageDataChannel<{ count: number }>("counter", { count: 0 }, {
      ensureProxy<T>(tag: string, id: string, defaultData: T): T {
        store.play[tag] ??= {};
        store.play[tag][id] ??= defaultData as unknown;
        return store.play[tag][id] as T;
      },
      getDoc: () => doc,
      getStorePlay: () => store.play,
      proxyByTagAndId: new Map(),
      yObserverByKey: new Map(),
      channelRefCounts: new Map(),
      channelListeners: new Map(),
    } as any);
    const updates: Array<{ count: number }> = [];
    channel.onUpdate((value) => updates.push(value));

    const spy = vi.spyOn(globalThis, "structuredClone");
    channel.setData((draft) => {
      draft.count = 2;
    });
    await new Promise((resolve) => queueMicrotask(resolve));
    expect(channel.getData()).toEqual({ count: 2 });
    expect(updates).toEqual([{ count: 2 }]);
    expect(store.play[PAGE_TAG].counter).toBeDefined();
    expect(spy.mock.results.filter((r) => r.type === "throw")).toEqual([]);

    channel.destroy();
    doc.destroy();
  });
});
