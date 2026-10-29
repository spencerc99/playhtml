// ABOUTME: Runs device sync from the background on iPhone builds that have the shared folder.
// ABOUTME: Wires the event store, collage store and image pins into one sync pass at a time.

import browser from "webextension-polyfill";
import type { LocalEventStore } from "../storage/LocalEventStore";
import {
  deleteCollage,
  listCollages,
  loadCollage,
  saveCollage,
} from "../entrypoints/scraps/collageStore";
import {
  encodeCollageFile,
  readCollageFile,
} from "../entrypoints/scraps/collageFile";
import type { CollageRecord } from "../entrypoints/scraps/collageRecord";
import { pinCollageSources, unpinCollage } from "../storage/ScrapImageCopies";
import {
  connectSharedContainer,
  type SharedContainer,
} from "./sharedContainer";
import {
  runDeviceSync,
  type SyncCollages,
  type SyncResult,
} from "./deviceSync";

function imageSources(record: CollageRecord): string[] {
  return record.pieces.flatMap((piece) =>
    piece.scrap.kind === "image" && piece.scrap.src ? [piece.scrap.src] : [],
  );
}

const collageAdapter: SyncCollages = {
  async list() {
    // An unreadable row has nothing worth sending the other side.
    return (await listCollages()).filter(
      (entry) => !("unreadable" in entry) && entry.id !== "",
    );
  },
  load: loadCollage,
  async save(record) {
    await saveCollage(record);
    // Keeps the pictures it holds from being let go, as the studio does on save.
    await pinCollageSources(record.id, imageSources(record));
  },
  async remove(id) {
    await deleteCollage(id);
    await unpinCollage(id);
  },
  encode: (record) => encodeCollageFile(record),
  decode: readCollageFile,
};

const LAST_RUN_KEY = "wwoSyncLastRunAt";

let container: Promise<SharedContainer | null> | null = null;
let running: Promise<SyncResult | null> | null = null;

/** Whether this build has a shared folder to sync through, asked once per wake. */
export function sharedContainer(): Promise<SharedContainer | null> {
  container ??= connectSharedContainer();
  return container;
}

/**
 * One sync pass, or null where there is no shared folder. Overlapping calls
 * share the pass already running, since both sides' files are read and
 * written whole.
 */
export function syncDevices(
  store: LocalEventStore,
  options: { skipIfRanWithinMs?: number } = {},
): Promise<SyncResult | null> {
  running ??= (async () => {
    try {
      const shared = await sharedContainer();
      if (!shared) return null;
      // Safari wakes the background often on iPhone; a wake right after a
      // pass has nothing new to carry.
      const stored = await browser.storage.local.get(LAST_RUN_KEY);
      const lastRun = Number(stored[LAST_RUN_KEY]) || 0;
      if (
        options.skipIfRanWithinMs !== undefined &&
        Date.now() - lastRun < options.skipIfRanWithinMs
      ) {
        return null;
      }
      await browser.storage.local.set({ [LAST_RUN_KEY]: Date.now() });
      return await runDeviceSync({
        container: shared,
        store: {
          async eventSummary() {
            const stats = await store.getStorageStats();
            return { count: stats.totalEvents, newest: stats.newestEvent };
          },
          getAllEvents: () => store.getAllEvents(),
          addSyncedEvents: (events) => store.addSyncedEvents(events),
          deleteScrapEvents: (ids) => store.deleteScrapEvents(ids),
        },
        collages: collageAdapter,
        storage: {
          get: (keys) => browser.storage.local.get(keys),
          set: (items) => browser.storage.local.set(items),
          remove: (keys) => browser.storage.local.remove(keys),
        },
        now: () => Date.now(),
      });
    } finally {
      running = null;
    }
  })();
  return running;
}
