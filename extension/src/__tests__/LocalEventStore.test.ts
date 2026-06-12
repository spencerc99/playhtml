// ABOUTME: Verifies local event storage stats read from persisted aggregates.
// ABOUTME: Covers storage summary behavior without scanning every stored event.

import { describe, expect, it } from "vitest";
import { LocalEventStore } from "../storage/LocalEventStore";

function createStoreWithGlobalStats(globalStats: unknown) {
  const store = new LocalEventStore() as any;
  store.isInitialized = true;
  store.db = {
    transaction(storeNames: string[]) {
      expect(storeNames).toEqual(["domain_stats"]);
      return {
        objectStore(name: string) {
          expect(name).toBe("domain_stats");
          return {
            get(key: string) {
              expect(key).toBe("__global__");
              const request: any = {};
              queueMicrotask(() => {
                request.result = globalStats;
                request.onsuccess?.();
              });
              return request;
            },
          };
        },
      };
    },
  };
  return store as LocalEventStore;
}

describe("LocalEventStore storage stats", () => {
  it("reads storage stats from the global aggregate", async () => {
    const store = createStoreWithGlobalStats({
      key: "__global__",
      domain: "",
      totalTimeMs: 0,
      hourBuckets: new Array(24).fill(0),
      sessionCount: 0,
      pendingFocusTs: null,
      pendingFocusUrl: "",
      eventsByType: { cursor: 2, keyboard: 1 },
      firstVisit: 100,
      lastVisit: 300,
      uniqueUrls: [],
      processedNavIds: [],
      storageSizeBytes: 4096,
    });

    await expect(store.getStorageStats()).resolves.toEqual({
      totalEvents: 3,
      estimatedSizeBytes: 4096,
      oldestEvent: 100,
      newestEvent: 300,
      countsByType: { cursor: 2, keyboard: 1 },
    });
  });
});
