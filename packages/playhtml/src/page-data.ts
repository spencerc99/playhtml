// ABOUTME: Implements PageDataChannel — named persistent data channels
// ABOUTME: not tied to DOM elements, backed by existing SyncedStore/Yjs.

import type { PageDataChannel, PageDataSetter } from "@playhtml/common";
import { clonePlain, deepReplaceIntoProxy } from "@playhtml/common";
import { getYjsValue } from "@syncedstore/core";
import type * as Y from "yjs";

const PAGE_TAG = "__page__";

export { PAGE_TAG };

interface PageDataDeps {
  ensureProxy: <T>(tag: string, id: string, defaultData: T) => T;
  getProxy: (tag: string, id: string) => unknown;
  // doc + store are read through getters so a channel handle held across a room
  // change (which recreates both) sees the CURRENT doc/store, not a stale one
  // captured at channel-creation time.
  getDoc: () => Y.Doc;
  getStorePlay: () => Partial<Record<string, Record<string, unknown>>>;
  proxyByTagAndId: Map<string, Map<string, any>>;
  yObserverByKey: Map<string, (...args: unknown[]) => void>;
  // Per-init-cycle tracking, scoped to avoid leaking across init() calls
  channelRefCounts: Map<string, number>;
  channelListeners: Map<string, Set<(data: any) => void>>;
}

function pageDataObserverKey(name: string): string {
  return `${PAGE_TAG}:${name}`;
}

type PageDataObserver = ((...args: unknown[]) => void) & {
  target?: any;
  mode?: "deep" | "shallow";
};

function applyPageDataUpdate<T>(data: PageDataSetter<T>, value: T): T {
  if (typeof data !== "function") return data as T;
  if (value !== null && typeof value === "object") {
    (data as (draft: T) => void)(value);
    return value;
  }
  return (data as (value: T) => T)(value);
}

function notifyPageDataListeners<T>(
  name: string,
  deps: PageDataDeps,
  listeners: Set<(data: T) => void>,
): void {
  const currentProxy = deps.getStorePlay()[PAGE_TAG]?.[name];
  if (currentProxy === undefined) return;
  const plain = clonePlain(currentProxy) as T;
  for (const cb of listeners) {
    cb(plain);
  }
}

function detachPageDataObserver(name: string, deps: PageDataDeps): void {
  const observerKey = pageDataObserverKey(name);
  const observer = yObserverByKeyGet(deps, observerKey);
  if (!observer) return;
  if (observer.mode === "deep") observer.target?.unobserveDeep(observer);
  if (observer.mode === "shallow") observer.target?.unobserve(observer);
  deps.yObserverByKey.delete(observerKey);
}

function yObserverByKeyGet(
  deps: PageDataDeps,
  observerKey: string,
): PageDataObserver | undefined {
  return deps.yObserverByKey.get(observerKey) as PageDataObserver | undefined;
}

function attachPageDataObserver<T>(
  name: string,
  deps: PageDataDeps,
  listeners: Set<(data: T) => void>
): void {
  const { getStorePlay, yObserverByKey } = deps;
  const observerKey = pageDataObserverKey(name);
  if (yObserverByKey.has(observerKey)) return;
  const currentValue = getStorePlay()[PAGE_TAG]?.[name];
  const yVal = getYjsValue(currentValue);
  let scheduled = false;
  const notify = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      notifyPageDataListeners(name, deps, listeners);
    });
  };
  if (yVal && typeof (yVal as any).observeDeep === "function") {
    const observer = notify as PageDataObserver;
    observer.target = yVal;
    observer.mode = "deep";
    (yVal as any).observeDeep(observer);
    yObserverByKey.set(observerKey, observer);
    return;
  }

  const pageData = getYjsValue(getStorePlay()[PAGE_TAG]);
  if (!pageData || typeof (pageData as any).observe !== "function") return;
  const observer = ((event: { keysChanged?: Set<string> }) => {
    if (event.keysChanged?.has(name)) notify();
  }) as PageDataObserver;
  observer.target = pageData;
  observer.mode = "shallow";
  (pageData as any).observe(observer);
  yObserverByKey.set(observerKey, observer);
}

export function refreshPageDataChannels(deps: PageDataDeps): void {
  const { channelListeners, getStorePlay } = deps;

  for (const [name, listeners] of channelListeners) {
    const currentProxy = getStorePlay()[PAGE_TAG]?.[name];
    if (currentProxy === undefined) continue;

    attachPageDataObserver(name, deps, listeners);
    notifyPageDataListeners(name, deps, listeners);
  }
}

export function createPageDataChannel<T>(
  name: string,
  defaultValue: T,
  deps: PageDataDeps,
): PageDataChannel<T> {
  const {
    ensureProxy, getProxy, getDoc, getStorePlay, proxyByTagAndId,
    channelRefCounts, channelListeners,
  } = deps;
  // Read live each use so we follow a room-change store/doc swap.
  const storePlay = () => getStorePlay();
  const doc = () => getDoc();

  // Ensure the store entry and proxy exist
  storePlay()[PAGE_TAG] ??= {};
  ensureProxy<T>(PAGE_TAG, name, defaultValue);

  // Set up shared listener set for this channel if it doesn't exist
  if (!channelListeners.has(name)) {
    channelListeners.set(name, new Set());
  }
  const listeners = channelListeners.get(name)!;

  // Track this handle's own listeners for cleanup
  const handleListeners = new Set<(data: T) => void>();

  // Attach a deep observer to the current Yjs value for this channel, wired to
  // notify `listeners`. No-op if one is already attached. Called when the first
  // handle opens the channel, and again if setData re-seeds the proxy after a
  // room change (otherwise the re-seeded value has no observer and onUpdate
  // goes silently dead for handles that survived the reset).
  function attachObserver(): void {
    attachPageDataObserver(name, deps, listeners);
  }

  const refCount = (channelRefCounts.get(name) ?? 0) + 1;
  channelRefCounts.set(name, refCount);

  // Ensure an observer is attached for this channel. attachObserver is
  // idempotent, so this is safe whether this is the first handle or a handle
  // re-opening a channel whose observer was detached by a room-change reset
  // (where refCount may already be > 1 from a sibling handle that survived).
  attachObserver();

  let destroyed = false;

  return {
    getData(): T {
      if (destroyed) throw new Error(`PageDataChannel "${name}" has been destroyed`);
      const value = storePlay()[PAGE_TAG]?.[name];
      return clonePlain(value === undefined ? defaultValue : value) as T;
    },

    setData(data: PageDataSetter<T>): void {
      if (destroyed) throw new Error(`PageDataChannel "${name}" has been destroyed`);
      // Re-acquire the proxy if it's gone (e.g. a room change cleared page-data
      // out from under this still-alive handle). ensureProxy re-seeds the
      // default into a fresh value and attachObserver re-attaches the deep
      // observer, wired to this channel's preserved listener set — so the
      // handle keeps both writing AND notifying after the reset.
      let currentProxy = getProxy(PAGE_TAG, name) as T | undefined;
      if (currentProxy === undefined) {
        currentProxy = ensureProxy<T>(PAGE_TAG, name, defaultValue) as T;
        attachObserver();
      }
      const proxy = currentProxy;
      const isObjectRoot = proxy !== null && typeof proxy === "object";
      if (typeof data === "function" && isObjectRoot) {
        doc().transact(() => {
          applyPageDataUpdate(data as PageDataSetter<T>, proxy);
        });
        return;
      }

      const nextValue = applyPageDataUpdate(data, proxy);

      if (isObjectRoot) {
        doc().transact(() => {
          deepReplaceIntoProxy(proxy, nextValue);
        });
        return;
      }

      detachPageDataObserver(name, deps);
      doc().transact(() => {
        storePlay()[PAGE_TAG] ??= {};
        storePlay()[PAGE_TAG]![name] = clonePlain(nextValue);
        proxyByTagAndId.get(PAGE_TAG)?.set(name, storePlay()[PAGE_TAG]![name]);
      });
      attachObserver();
      notifyPageDataListeners(name, deps, listeners);
    },

    onUpdate(callback: (data: T) => void): () => void {
      if (destroyed) throw new Error(`PageDataChannel "${name}" has been destroyed`);
      listeners.add(callback);
      handleListeners.add(callback);
      return () => {
        listeners.delete(callback);
        handleListeners.delete(callback);
      };
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const cb of handleListeners) {
        listeners.delete(cb);
      }
      handleListeners.clear();

      const remaining = (channelRefCounts.get(name) ?? 1) - 1;
      channelRefCounts.set(name, remaining);

      if (remaining <= 0) {
        channelRefCounts.delete(name);
        channelListeners.delete(name);

        detachPageDataObserver(name, deps);

        const tagMap = proxyByTagAndId.get(PAGE_TAG);
        if (tagMap) {
          tagMap.delete(name);
        }
      }
    },
  };
}
