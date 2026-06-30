// ABOUTME: Implements PageDataChannel — named persistent data channels
// ABOUTME: not tied to DOM elements, backed by existing SyncedStore/Yjs.

import type { PageDataChannel } from "@playhtml/common";
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

function attachPageDataObserver<T>(
  name: string,
  deps: PageDataDeps,
  listeners: Set<(data: T) => void>
): void {
  const { getStorePlay, yObserverByKey } = deps;
  const observerKey = pageDataObserverKey(name);
  if (yObserverByKey.has(observerKey)) return;
  const yVal = getYjsValue(getStorePlay()[PAGE_TAG]?.[name]);
  if (!yVal || typeof (yVal as any).observeDeep !== "function") return;
  let scheduled = false;
  const observer = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const currentProxy = getStorePlay()[PAGE_TAG]?.[name];
      if (!currentProxy) return;
      const plain = clonePlain(currentProxy) as T;
      for (const cb of listeners) {
        cb(plain);
      }
    });
  };
  (yVal as any).observeDeep(observer);
  yObserverByKey.set(observerKey, observer);
}

export function refreshPageDataChannels(deps: PageDataDeps): void {
  const { channelListeners, getStorePlay } = deps;

  for (const [name, listeners] of channelListeners) {
    const currentProxy = getStorePlay()[PAGE_TAG]?.[name];
    if (!currentProxy) continue;

    attachPageDataObserver(name, deps, listeners);
    const plain = clonePlain(currentProxy);
    for (const cb of listeners) {
      cb(plain);
    }
  }
}

export function createPageDataChannel<T>(
  name: string,
  defaultValue: T,
  deps: PageDataDeps,
): PageDataChannel<T> {
  const {
    ensureProxy, getProxy, getDoc, getStorePlay, proxyByTagAndId,
    yObserverByKey, channelRefCounts, channelListeners,
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
      return clonePlain(storePlay()[PAGE_TAG]?.[name] ?? defaultValue) as T;
    },

    setData(data: T | ((draft: T) => void)): void {
      if (destroyed) throw new Error(`PageDataChannel "${name}" has been destroyed`);
      // Re-acquire the proxy if it's gone (e.g. a room change cleared page-data
      // out from under this still-alive handle). ensureProxy re-seeds the
      // default into a fresh value and attachObserver re-attaches the deep
      // observer, wired to this channel's preserved listener set — so the
      // handle keeps both writing AND notifying after the reset.
      let currentProxy = getProxy(PAGE_TAG, name) as T | null | undefined;
      if (currentProxy == null) {
        currentProxy = ensureProxy<T>(PAGE_TAG, name, defaultValue) as T;
        attachObserver();
      }
      const proxy = currentProxy;
      if (typeof data === "function") {
        doc().transact(() => {
          (data as (draft: T) => void)(proxy);
        });
      } else {
        doc().transact(() => {
          deepReplaceIntoProxy(proxy, data);
        });
      }
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

        const key = pageDataObserverKey(name);
        const obs = yObserverByKey.get(key);
        if (obs) {
          const yVal = getYjsValue(storePlay()[PAGE_TAG]?.[name]);
          if (yVal && typeof (yVal as any).unobserveDeep === "function") {
            (yVal as any).unobserveDeep(obs);
          }
          yObserverByKey.delete(key);
        }

        const tagMap = proxyByTagAndId.get(PAGE_TAG);
        if (tagMap) {
          tagMap.delete(name);
        }
      }
    },
  };
}
