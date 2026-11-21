// ABOUTME: Implements named page data channels on the version 2 operation store.
// ABOUTME: Keeps the Yjs channel contract: seeded defaults, setters, and batched update listeners.

import type {
  JsonValue,
  MutationCallback,
  PageDataChannel,
  PageDataSetter,
} from "@playhtml/common";
import { clonePlain } from "@playhtml/common";
import { PAGE_TAG } from "../page-data";
import type { V2Store } from "./store";

export type V2PageDataChannel<T> = PageDataChannel<T> & {
  /** Re-attaches to the current store after a room change replaced it. */
  rebind(): void;
};

export function createV2PageDataChannel<T>(
  name: string,
  defaultValue: T,
  getStore: () => V2Store,
  onDestroy: () => void,
): V2PageDataChannel<T> {
  const listeners = new Set<(data: T) => void>();
  let boundStore: V2Store | null = null;
  let unsubscribe: (() => void) | null = null;
  let scheduled = false;
  let destroyed = false;

  const read = (store: V2Store): T | undefined =>
    store.getSnapshot().state[PAGE_TAG]?.[name] as T | undefined;

  const notify = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (destroyed || !boundStore) return;
      const value = read(boundStore);
      if (value === undefined) return;
      const plain = clonePlain(value) as T;
      for (const listener of listeners) listener(plain);
    });
  };

  const bind = (): V2Store => {
    const store = getStore();
    if (store === boundStore) return store;
    unsubscribe?.();
    boundStore = store;
    if (read(store) === undefined) {
      store.mutate(PAGE_TAG, name, clonePlain(defaultValue) as JsonValue);
    }
    unsubscribe = store.subscribe(PAGE_TAG, name, notify);
    return store;
  };

  const assertAlive = (): void => {
    if (destroyed) {
      throw new Error(`PageDataChannel "${name}" has been destroyed`);
    }
  };

  bind();

  return {
    getData(): T {
      assertAlive();
      const value = read(bind());
      return clonePlain(value === undefined ? defaultValue : value) as T;
    },

    setData(data: PageDataSetter<T>): void {
      assertAlive();
      const store = bind();
      const current = read(store) ?? defaultValue;
      if (
        typeof data === "function" &&
        current !== null &&
        typeof current === "object"
      ) {
        store.mutate(
          PAGE_TAG,
          name,
          data as unknown as MutationCallback<JsonValue>,
        );
        return;
      }
      const next =
        typeof data === "function" ? (data as (value: T) => T)(current) : data;
      store.mutate(PAGE_TAG, name, clonePlain(next) as JsonValue);
    },

    onUpdate(callback: (data: T) => void): () => void {
      assertAlive();
      bind();
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },

    rebind(): void {
      if (destroyed) return;
      bind();
      notify();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      unsubscribe?.();
      unsubscribe = null;
      boundStore = null;
      onDestroy();
    },
  };
}
