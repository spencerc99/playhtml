// ABOUTME: Verifies PageDataChannel reads, writes, listeners, lifecycle cleanup,
// ABOUTME: and permission-gated routing for named shared data channels.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { syncedStore } from "@syncedstore/core";
import * as Y from "yjs";
import { playhtml } from "../index";
import { createPageDataChannel, PAGE_TAG } from "../page-data";
import { bindHandshake, unbindHandshake } from "../auth/handshake";
import {
  __resetPermissionsForTests,
  PERMISSION_DENIED_EVENT,
  setIdentity,
  setServerPermissionsStatus,
  setVerified,
} from "../auth/permissions";
import { clonePlain } from "@playhtml/common";

const ADMIN_PK = "pk_" + "aa".repeat(65);
const OTHER_PK = "pk_" + "bb".repeat(65);

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

function createPageDataTestDeps() {
  const doc = new Y.Doc();
  const store = syncedStore<{ play: Record<string, Record<string, unknown>> }>(
    { play: {} },
    doc,
  );
  const proxyByTagAndId = new Map<string, Map<string, any>>();
  const yObserverByKey = new Map<string, (...args: unknown[]) => void>();
  const channelRefCounts = new Map<string, number>();
  const channelListeners = new Map<string, Set<(data: any) => void>>();

  return {
    ensureProxy<T>(tag: string, id: string, defaultData: T): T {
      if (!proxyByTagAndId.has(tag)) proxyByTagAndId.set(tag, new Map());
      const tagMap = proxyByTagAndId.get(tag)!;
      if (!tagMap.has(id)) {
        store.play[tag] ??= {};
        const tagRecord = store.play[tag]!;
        if (tagRecord[id] === undefined) {
          tagRecord[id] = clonePlain(defaultData);
        }
        tagMap.set(id, tagRecord[id]);
      }
      return tagMap.get(id)! as T;
    },
    getProxy: (tag: string, id: string) => proxyByTagAndId.get(tag)?.get(id),
    getDoc: () => doc,
    getStorePlay: () => store.play,
    proxyByTagAndId,
    yObserverByKey,
    channelRefCounts,
    channelListeners,
  };
}

describe("page-data permissions", () => {
  beforeEach(() => {
    __resetPermissionsForTests();
    unbindHandshake();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    unbindHandshake();
    vi.restoreAllMocks();
  });

  it("routes server-gated channel writes through gated_write ops", () => {
    const sent: string[] = [];
    bindHandshake({
      send: (message) => sent.push(message),
      getPid: () => ADMIN_PK,
      roomId: "example.com-%2Fwall",
    });
    setIdentity({
      publicKey: ADMIN_PK,
      playerStyle: { colorPalette: ["red"] },
      source: "local",
    });
    setVerified(true);
    setServerPermissionsStatus({
      type: "permissions_status",
      enforced: true,
      roles: { admin: [ADMIN_PK] },
      rules: [{ match: "my-channel", write: "admin" }],
      roomPath: "/wall",
    });

    const channel = createPageDataChannel(
      "my-channel",
      { count: 0 },
      createPageDataTestDeps(),
    );

    channel.setData({ count: 1 });

    expect(channel.getData()).toEqual({ count: 0 });
    const message = JSON.parse(sent.at(-1)!);
    expect(message).toMatchObject({
      type: "gated_write",
      tag: PAGE_TAG,
      elementId: "my-channel",
      ops: [{ op: "replace", key: "", value: { count: 1 } }],
    });
  });

  it("dispatches permissiondenied for locally denied channel writes", () => {
    const sent: string[] = [];
    bindHandshake({
      send: (message) => sent.push(message),
      getPid: () => OTHER_PK,
      roomId: "example.com-%2Fwall",
    });
    setIdentity({
      publicKey: OTHER_PK,
      playerStyle: { colorPalette: ["blue"] },
      source: "local",
    });
    setVerified(true);
    setServerPermissionsStatus({
      type: "permissions_status",
      enforced: true,
      roles: { admin: [ADMIN_PK] },
      rules: [{ match: "my-channel", write: "admin" }],
      roomPath: "/wall",
    });
    const denied = vi.fn();
    document.addEventListener(PERMISSION_DENIED_EVENT, denied);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const channel = createPageDataChannel(
      "my-channel",
      { count: 0 },
      createPageDataTestDeps(),
    );

    channel.setData({ count: 1 });

    expect(sent).toHaveLength(0);
    expect(channel.getData()).toEqual({ count: 0 });
    expect(denied).toHaveBeenCalledTimes(1);
    expect(denied.mock.calls[0][0].detail).toMatchObject({
      action: "write",
      elementId: "my-channel",
    });
    document.removeEventListener(PERMISSION_DENIED_EVENT, denied);
  });
});
