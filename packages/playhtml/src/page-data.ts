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
  doc: Y.Doc;
  storePlay: Partial<Record<string, Record<string, unknown>>>;
  proxyByTagAndId: Map<string, Map<string, any>>;
  yObserverByKey: Map<string, (...args: unknown[]) => void>;
  // Per-init-cycle tracking, scoped to avoid leaking across init() calls
  channelRefCounts: Map<string, number>;
  channelListeners: Map<string, Set<(data: any) => void>>;
}

export function createPageDataChannel<T>(
  name: string,
  defaultValue: T,
  deps: PageDataDeps,
): PageDataChannel<T> {
  const {
    ensureProxy, getProxy, doc, storePlay, proxyByTagAndId,
    yObserverByKey, channelRefCounts, channelListeners,
  } = deps;

  // Ensure the store entry and proxy exist
  storePlay[PAGE_TAG] ??= {};
  ensureProxy<T>(PAGE_TAG, name, defaultValue);

  // Set up shared listener set for this channel if it doesn't exist
  if (!channelListeners.has(name)) {
    channelListeners.set(name, new Set());
  }
  const listeners = channelListeners.get(name)!;

  // Track this handle's own listeners for cleanup
  const handleListeners = new Set<(data: T) => void>();

  // Attach observer if this is the first handle for this channel
  const refCount = (channelRefCounts.get(name) ?? 0) + 1;
  channelRefCounts.set(name, refCount);

  if (refCount === 1) {
    const yVal = getYjsValue(storePlay[PAGE_TAG]?.[name]);
    if (yVal && typeof (yVal as any).observeDeep === "function") {
      let scheduled = false;
      const observer = () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          const currentProxy = storePlay[PAGE_TAG]?.[name];
          if (!currentProxy) return;
          const plain = clonePlain(currentProxy) as T;
          for (const cb of listeners) {
            cb(plain);
          }
        });
      };
      (yVal as any).observeDeep(observer);
      yObserverByKey.set(`${PAGE_TAG}:${name}`, observer);
    }
  }

  let destroyed = false;

  return {
    getData(): T {
      if (destroyed) throw new Error(`PageDataChannel "${name}" has been destroyed`);
      return clonePlain(storePlay[PAGE_TAG]?.[name] ?? defaultValue) as T;
    },

    setData(data: T | ((draft: T) => void)): void {
      if (destroyed) throw new Error(`PageDataChannel "${name}" has been destroyed`);
      const currentProxy = getProxy(PAGE_TAG, name) as T | undefined;
      if (!currentProxy) {
        throw new Error(`PageDataChannel "${name}" proxy not found — data may have been cleaned up`);
      }
      if (typeof data === "function") {
        doc.transact(() => {
          (data as (draft: T) => void)(currentProxy);
        });
      } else {
        doc.transact(() => {
          deepReplaceIntoProxy(currentProxy, data);
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

        const key = `${PAGE_TAG}:${name}`;
        const obs = yObserverByKey.get(key);
        if (obs) {
          const yVal = getYjsValue(storePlay[PAGE_TAG]?.[name]);
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
