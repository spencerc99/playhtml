// ABOUTME: Background queue that keeps a local copy of each collected scrap image, one at a time.
// ABOUTME: Runs off the collection path, logs failures, and walks older scraps once in a throttled backfill.

import type { CollectionEvent, ImageScrapData } from "../collectors/types";
import type { LocalEventStore } from "./LocalEventStore";
import { makeImageCopy } from "./imageCopyMaking";
import {
  hasImageCopy,
  readImageCopyMeta,
  storeImageCopy,
  trimImageCopies,
  writeImageCopyMeta,
} from "./ScrapImageCopies";

/** Collected images waiting beyond this are dropped; the next visit queues them again. */
const MAX_QUEUED = 500;
/** Pause between backfill copies, so the pass never competes with browsing. */
const BACKFILL_PAUSE_MS = 1_500;
/** Copies stored between budget checks while a long run is going. */
const TRIM_EVERY = 25;

const BACKFILL_DONE_KEY = "backfill-done";
/** Timestamp of the oldest scrap the backfill has reached, so a restart resumes. */
const BACKFILL_REACHED_KEY = "backfill-reached-ts";

function imageSrcOf(event: CollectionEvent): string | undefined {
  const data = event.data as Partial<ImageScrapData> | null;
  if (event.type !== "element" || data?.kind !== "image") return undefined;
  return typeof data.src === "string" && /^https?:/i.test(data.src)
    ? data.src
    : undefined;
}

export class ImageCopier {
  private queue: string[] = [];
  private queued = new Set<string>();
  private running = false;
  private storedSinceTrim = 0;
  private backfilling = false;

  constructor(private store: LocalEventStore) {}

  /** Queues copies for newly collected image scraps. Never waits on the network. */
  noteCollected(events: readonly CollectionEvent[]): void {
    for (const event of events) {
      const src = imageSrcOf(event);
      if (!src || this.queued.has(src)) continue;
      if (this.queue.length >= MAX_QUEUED) break;
      this.queue.push(src);
      this.queued.add(src);
    }
    this.drain();
  }

  private drain(): void {
    if (this.running) return;
    this.running = true;
    void (async () => {
      try {
        // The trim yields, and an image collected meanwhile is queued while
        // this loop still counts as running, so the queue is checked again
        // after it rather than left for a later collection to restart.
        do {
          while (this.queue.length > 0) {
            const src = this.queue.shift()!;
            try {
              await this.copy(src);
            } finally {
              this.queued.delete(src);
            }
          }
          await this.trim();
        } while (this.queue.length > 0);
      } finally {
        this.running = false;
      }
    })();
  }

  /** Copies one image unless it is already held. Returns whether bytes were stored. */
  private async copy(src: string): Promise<boolean> {
    try {
      if (await hasImageCopy(src)) return false;
      const stored = await storeImageCopy(await makeImageCopy(src));
      if (stored && ++this.storedSinceTrim >= TRIM_EVERY) await this.trim();
      return stored;
    } catch (error) {
      console.warn(
        "[ImageCopier]",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  private async trim(): Promise<void> {
    if (this.storedSinceTrim === 0) return;
    this.storedSinceTrim = 0;
    try {
      const { evicted } = await trimImageCopies();
      if (evicted > 0) {
        console.log(`[ImageCopier] let go of ${evicted} older image copies`);
      }
    } catch (error) {
      console.warn("[ImageCopier] budget check failed:", error);
    }
  }

  /**
   * Walks scraps collected before copies existed, newest first, copying the
   * ones whose images still load. Runs once; a restart resumes where it left
   * off. Waits whenever freshly collected images are queued.
   */
  async backfill(): Promise<void> {
    if (this.backfilling) return;
    this.backfilling = true;
    try {
      if ((await readImageCopyMeta(BACKFILL_DONE_KEY)) === true) return;
      const reached = await readImageCopyMeta(BACKFILL_REACHED_KEY);
      const endTs = typeof reached === "number" ? reached : undefined;
      const events = await this.store.queryByType("element", {
        ...(endTs !== undefined ? { endTs } : {}),
      });
      events.sort((a, b) => b.ts - a.ts);
      const seen = new Set<string>();
      for (const event of events) {
        const src = imageSrcOf(event);
        if (!src || seen.has(src)) continue;
        seen.add(src);
        while (this.running || this.queue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, BACKFILL_PAUSE_MS));
        }
        if (await this.copy(src)) {
          await new Promise((resolve) => setTimeout(resolve, BACKFILL_PAUSE_MS));
        }
        await writeImageCopyMeta(BACKFILL_REACHED_KEY, event.ts);
      }
      await this.trim();
      await writeImageCopyMeta(BACKFILL_DONE_KEY, true);
      console.log(`[ImageCopier] backfill finished over ${seen.size} images`);
    } catch (error) {
      console.warn("[ImageCopier] backfill stopped:", error);
    } finally {
      this.backfilling = false;
    }
  }
}
