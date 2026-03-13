// ABOUTME: Implements PageDataChannel — named persistent data channels
// ABOUTME: not tied to DOM elements, backed by existing SyncedStore/Yjs.

import type { PageDataChannel } from "@playhtml/common";
import { clonePlain, deepReplaceIntoProxy } from "@playhtml/common";
import { getYjsValue } from "@syncedstore/core";
import type * as Y from "yjs";

const PAGE_TAG = "__page__";

// Per-channel ref count and observer tracking
const channelRefCounts = new Map<string, number>();
const channelObservers = new Map<string, () => void>();
const channelListeners = new Map<string, Set<(data: any) => void>>();

export { PAGE_TAG };

interface PageDataDeps {
  ensureProxy: <T>(tag: string, id: string, defaultData: T) => T;
  getProxy: (tag: string, id: string) => unknown;
  doc: Y.Doc;
  storePlay: Record<string, Record<string, unknown>>;
  proxyByTagAndId: Map<string, Map<string, any>>;
  yObserverByKey: Map<string, (events: any[]) => void>;
}

export function createPageDataChannel<T>(
  name: string,
  defaultValue: T,
  deps: PageDataDeps,
): PageDataChannel<T> {
  const { ensureProxy, getProxy, doc, storePlay, proxyByTagAndId, yObserverByKey } = deps;

  // Ensure the store entry and proxy exist
  storePlay[PAGE_TAG] ??= {};
  const proxy = ensureProxy<T>(PAGE_TAG, name, defaultValue);

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
    // Attach deep observer on the Yjs value
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
          // Notify all listeners across all handles
          for (const cb of listeners) {
            cb(plain);
          }
        });
      };
      (yVal as any).observeDeep(observer);
      const key = `${PAGE_TAG}:${name}`;
      yObserverByKey.set(key, observer);
      channelObservers.set(name, observer);
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
      const currentProxy = getProxy(PAGE_TAG, name) as T;
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
      // Remove this handle's listeners
      for (const cb of handleListeners) {
        listeners.delete(cb);
      }
      handleListeners.clear();

      // Decrement ref count
      const remaining = (channelRefCounts.get(name) ?? 1) - 1;
      channelRefCounts.set(name, remaining);

      if (remaining <= 0) {
        // Last handle — clean up observer and proxy
        channelRefCounts.delete(name);
        channelListeners.delete(name);

        const key = `${PAGE_TAG}:${name}`;
        const obs = channelObservers.get(name);
        if (obs) {
          const yVal = getYjsValue(storePlay[PAGE_TAG]?.[name]);
          if (yVal && typeof (yVal as any).unobserveDeep === "function") {
            (yVal as any).unobserveDeep(obs);
          }
          yObserverByKey.delete(key);
          channelObservers.delete(name);
        }

        // Clean up proxy
        const tagMap = proxyByTagAndId.get(PAGE_TAG);
        if (tagMap) {
          tagMap.delete(name);
        }
      }
    },
  };
}
