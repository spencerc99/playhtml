import { describe, it, expect, beforeAll } from "vitest";
import { getYjsDoc, syncedStore } from "@syncedstore/core";
import * as Y from "yjs";
import { playhtml } from "../index";
import { createPageDataChannel, PAGE_TAG } from "../page-data";

function createPageDataTestDeps(
  store: ReturnType<typeof syncedStore<{ play: Record<string, Record<string, unknown>> }>>,
) {
  const doc = getYjsDoc(store);
  const proxyByTagAndId = new Map<string, Map<string, unknown>>();
  const yObserverByKey = new Map<string, (...args: unknown[]) => void>();

  return {
    ensureProxy<T>(tag: string, id: string, defaultData: T): T {
      if (!proxyByTagAndId.has(tag)) proxyByTagAndId.set(tag, new Map());
      const proxies = proxyByTagAndId.get(tag)!;
      if (!proxies.has(id)) {
        store.play[tag] ??= {};
        store.play[tag][id] ??= defaultData;
        proxies.set(id, store.play[tag][id]);
      }
      return proxies.get(id) as T;
    },
    getProxy: (tag: string, id: string) => proxyByTagAndId.get(tag)?.get(id),
    getDoc: () => doc,
    getStorePlay: () => store.play,
    proxyByTagAndId,
    yObserverByKey,
    channelRefCounts: new Map<string, number>(),
    channelListeners: new Map<string, Set<(data: unknown) => void>>(),
  };
}

beforeAll(async () => {
  await playhtml.init({});
  await new Promise((r) => setTimeout(r, 0));
});

describe("playhtml.createPageData", () => {
  it("creates a page data channel with default value", () => {
    const channel = playhtml.createPageData("test-basic", { count: 0 });
    expect(channel.getData()).toEqual({ count: 0 });
  });

  it("setData with value form replaces data", async () => {
    const channel = playhtml.createPageData("test-set-value", { count: 0 });
    channel.setData({ count: 5 });
    await new Promise((r) => queueMicrotask(r));
    expect(channel.getData()).toEqual({ count: 5 });
  });

  it("setData with mutator form mutates via proxy", async () => {
    const channel = playhtml.createPageData("test-set-mutator", { count: 0 });
    channel.setData((draft) => {
      draft.count = 10;
    });
    await new Promise((r) => queueMicrotask(r));
    expect(channel.getData()).toEqual({ count: 10 });
  });

  it("ignores terse object mutator returns", async () => {
    const channel = playhtml.createPageData("test-terse-mutator", { count: 0 });

    channel.setData((draft) => draft.count++);
    await new Promise((r) => queueMicrotask(r));

    expect(channel.getData()).toEqual({ count: 1 });
  });

  it("replaces primitive roots with values and functional updates", async () => {
    const channel = playhtml.createPageData("test-primitive-root", 0);
    const updates: number[] = [];
    channel.onUpdate((value) => updates.push(value));

    channel.setData(1);
    await new Promise((r) => queueMicrotask(r));
    channel.setData((value) => value + 1);
    await new Promise((r) => queueMicrotask(r));

    expect(channel.getData()).toBe(2);
    expect(updates).toEqual([1, 2]);
  });

  it("coalesces synchronous primitive notifications", async () => {
    const channel = playhtml.createPageData("test-primitive-coalescing", 0);
    const updates: number[] = [];
    channel.onUpdate((value) => updates.push(value));

    for (let value = 1; value <= 100; value++) {
      channel.setData(value);
    }
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(channel.getData()).toBe(100);
    expect(updates).toEqual([100]);
  });

  it("keeps notifying after a nullable root becomes an object", async () => {
    type Value = { nested: { count: number } } | null;
    const store = syncedStore<{ play: Record<string, Record<string, unknown>> }>({
      play: {},
    });
    const channel = createPageDataChannel<Value>(
      "nullable-object",
      null,
      createPageDataTestDeps(store),
    );
    const updates: Value[] = [];
    channel.onUpdate((value) => updates.push(value));

    channel.setData({ nested: { count: 1 } });
    await new Promise((resolve) => queueMicrotask(resolve));
    channel.setData({ nested: { count: 2 } });
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(channel.getData()).toEqual({ nested: { count: 2 } });
    expect(updates).toEqual([
      { nested: { count: 1 } },
      { nested: { count: 2 } },
    ]);
  });

  it("keeps notifying after a remote nullable root becomes an object", async () => {
    type Value = { nested: { count: number } } | null;
    const firstStore = syncedStore<{ play: Record<string, Record<string, unknown>> }>({
      play: {},
    });
    const secondStore = syncedStore<{ play: Record<string, Record<string, unknown>> }>({
      play: {},
    });
    const firstDoc = getYjsDoc(firstStore);
    const secondDoc = getYjsDoc(secondStore);
    const secondChannel = createPageDataChannel<Value>(
      "remote-nullable-object",
      null,
      createPageDataTestDeps(secondStore),
    );
    const updates: Value[] = [];
    secondChannel.onUpdate((value) => updates.push(value));
    Y.applyUpdate(firstDoc, Y.encodeStateAsUpdate(secondDoc));

    firstStore.play[PAGE_TAG]!["remote-nullable-object"] = {
      nested: { count: 1 },
    };
    Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(firstDoc));
    await new Promise((resolve) => queueMicrotask(resolve));

    const firstValue = firstStore.play[PAGE_TAG]!["remote-nullable-object"] as {
      nested: { count: number };
    };
    firstValue.nested.count = 2;
    Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(firstDoc));
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(secondChannel.getData()).toEqual({ nested: { count: 2 } });
    expect(updates).toEqual([
      { nested: { count: 1 } },
      { nested: { count: 2 } },
    ]);
  });

  it("uses a remotely updated primitive value for functional updates", () => {
    const firstStore = syncedStore<{ play: Record<string, Record<string, unknown>> }>({
      play: {},
    });
    const secondStore = syncedStore<{ play: Record<string, Record<string, unknown>> }>({
      play: {},
    });
    const firstDoc = getYjsDoc(firstStore);
    const secondDoc = getYjsDoc(secondStore);
    const secondChannel = createPageDataChannel(
      "view-count",
      0,
      createPageDataTestDeps(secondStore),
    );

    Y.applyUpdate(firstDoc, Y.encodeStateAsUpdate(secondDoc));
    firstStore.play[PAGE_TAG]!["view-count"] = 1;
    Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(firstDoc));

    expect(secondChannel.getData()).toBe(1);

    secondChannel.setData((value) => value + 1);

    expect(secondChannel.getData()).toBe(2);
  });

  it("onUpdate fires on local changes", async () => {
    const channel = playhtml.createPageData("test-onupdate", { count: 0 });
    const updates: any[] = [];
    channel.onUpdate((data) => updates.push(data));

    channel.setData({ count: 1 });
    await new Promise((r) => queueMicrotask(r));

    expect(updates.length).toBe(1);
    expect(updates[0]).toEqual({ count: 1 });
  });

  it("onUpdate unsubscribe stops callbacks", async () => {
    const channel = playhtml.createPageData("test-unsub", { count: 0 });
    const updates: any[] = [];
    const unsub = channel.onUpdate((data) => updates.push(data));

    channel.setData({ count: 1 });
    await new Promise((r) => queueMicrotask(r));
    expect(updates.length).toBe(1);

    unsub();
    channel.setData({ count: 2 });
    await new Promise((r) => queueMicrotask(r));
    expect(updates.length).toBe(1);
  });

  it("destroy prevents further operations", () => {
    const channel = playhtml.createPageData("test-destroy", { count: 0 });
    channel.destroy();
    expect(() => channel.getData()).toThrow(/destroyed/);
    expect(() => channel.setData({ count: 1 })).toThrow(/destroyed/);
  });

  it("multiple handles share data but have independent listeners", async () => {
    const ch1 = playhtml.createPageData("test-multi", { count: 0 });
    const ch2 = playhtml.createPageData("test-multi", { count: 0 });

    const updates1: any[] = [];
    const updates2: any[] = [];
    ch1.onUpdate((d) => updates1.push(d));
    ch2.onUpdate((d) => updates2.push(d));

    ch1.setData({ count: 5 });
    await new Promise((r) => queueMicrotask(r));

    // Both see the update
    expect(updates1.length).toBe(1);
    expect(updates2.length).toBe(1);

    // Both read same data
    expect(ch2.getData()).toEqual({ count: 5 });

    // Destroying one doesn't affect the other
    ch1.destroy();
    ch2.setData({ count: 10 });
    await new Promise((r) => queueMicrotask(r));

    expect(updates1.length).toBe(1); // ch1's listener removed
    expect(updates2.length).toBe(2); // ch2 still works
    expect(ch2.getData()).toEqual({ count: 10 });

    ch2.destroy();
  });

  it("reserved __page__ tag throws in maybeSetupTag path", async () => {
    const el = document.createElement("div");
    el.id = "bad-tag-test";
    el.setAttribute("__page__", "");
    document.body.appendChild(el);

    await expect(
      playhtml.setupPlayElementForTag(el, "__page__")
    ).rejects.toThrow(/reserved/);

    document.body.removeChild(el);
  });
});
