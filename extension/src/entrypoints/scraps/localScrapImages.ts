// ABOUTME: Serves the scraps page its local image copies and keeps collage pieces' copies pinned.
// ABOUTME: Pinning only protects a copy from being let go; it never fetches a larger one.

import {
  forgetScrapImageSrc,
  provideLocalScrapImages,
} from "@movement/utils/scrapImageSource";
import type { CollageRecord } from "./collageRecord";
import {
  hasImageCopy,
  pinCollageSources,
  readImageCopies,
  readImagePreviewInputs,
  storeImagePreview,
  storeImageCopy,
  trimImageCopies,
  unpinCollage,
} from "../../storage/ScrapImageCopies";
import { makeImageCopy } from "../../storage/imageCopyMaking";
import PreviewWorker from "./scrapPreview.worker?worker";
import { SCRAP_PREVIEW_MAX_EDGE } from "../../storage/scrapImagePreview";

/** Blob URLs live as long as the page, so every surface on it shares one per image. */
const objectUrls = new Map<string, string>();
const previewUrls = new Map<string, string>();
const previewJobs = new Map<string, Promise<Blob | undefined>>();
const previewQueue: Array<{ batch: number; hash: string; run: () => void }> =
  [];
const previewSourceHashes = new Map<string, string>();
let visiblePreviewSources = new Set<string>();
let previewBatch = 0;
let activePreviewBatch: number | null = null;
let previewRunning = 0;
/** Leave two reported cores for browsing; uncertain capacity keeps the conservative limit. */
const PREVIEW_WORKER_LIMIT =
  Number.isFinite(navigator.hardwareConcurrency) &&
  navigator.hardwareConcurrency > 0
    ? Math.min(8, Math.max(1, Math.floor(navigator.hardwareConcurrency) - 2))
    : 4;
const idlePreviewWorkers: Worker[] = [];
let previewTrimTimeout: number | undefined;

function schedulePreviewTrim(): void {
  window.clearTimeout(previewTrimTimeout);
  previewTrimTimeout = window.setTimeout(() => {
    void trimImageCopies().catch((error: unknown) =>
      console.warn("[scrap images] preview budget check failed:", error),
    );
  }, 500);
}

/** A view's requests keep their order, while later views move ahead of queued older work. */
function currentPreviewBatch(): number {
  if (activePreviewBatch === null) {
    activePreviewBatch = ++previewBatch;
    queueMicrotask(() => {
      activePreviewBatch = null;
    });
  }
  return activePreviewBatch;
}

/** Bounds worker decoders; each source settles without waiting for the whole gallery. */
function generatePreview(
  blob: Blob,
  batch: number,
  hash: string,
): Promise<Blob | undefined> {
  return new Promise((resolve, reject) => {
    const run = () => {
      previewRunning += 1;
      let worker: Worker;
      try {
        worker = idlePreviewWorkers.pop() ?? new PreviewWorker();
      } catch (error) {
        previewRunning -= 1;
        reject(error);
        drainPreviews();
        return;
      }
      const finish = (failed = false) => {
        window.clearTimeout(timeout);
        worker.onmessage = null;
        worker.onerror = null;
        if (failed) worker.terminate();
        else idlePreviewWorkers.push(worker);
        previewRunning -= 1;
        drainPreviews();
      };
      const timeout = window.setTimeout(() => {
        finish(true);
        reject(new Error("Scrap preview timed out"));
      }, 20_000);
      worker.onmessage = (
        event: MessageEvent<{ preview?: Blob; error?: string }>,
      ) => {
        finish();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.preview);
      };
      worker.onerror = () => {
        finish(true);
        reject(new Error("Scrap preview worker failed"));
      };
      try {
        worker.postMessage({ id: 0, blob });
      } catch (error) {
        finish(true);
        reject(error);
      }
    };
    previewQueue.push({ batch, hash, run });
    prioritizePreviewQueue();
    drainPreviews();
  });
}

/** Prioritizes the visible gallery, including sources whose shared job was queued in an older view. */
function prioritizePreviewQueue(): void {
  const visibleHashes = new Set(
    [...visiblePreviewSources].flatMap((src) => {
      const hash = previewSourceHashes.get(src);
      return hash ? [hash] : [];
    }),
  );
  previewQueue.sort(
    (first, second) =>
      Number(visibleHashes.has(second.hash)) -
        Number(visibleHashes.has(first.hash)) || second.batch - first.batch,
  );
}

function prioritizeVisiblePreviews(srcs: readonly string[]): void {
  visiblePreviewSources = new Set(srcs);
  prioritizePreviewQueue();
}

function drainPreviews(): void {
  while (previewRunning < PREVIEW_WORKER_LIMIT && previewQueue.length > 0)
    previewQueue.shift()!.run();
}

async function localPreviews(
  srcs: readonly string[],
): Promise<Map<string, string>> {
  const batch = currentPreviewBatch();
  const inputs = await readImagePreviewInputs(srcs);
  for (const [src, input] of inputs) previewSourceHashes.set(src, input.hash);
  prioritizePreviewQueue();
  const urls = new Map<string, string>();
  await Promise.all(
    [...inputs].map(async ([src, input]) => {
      let url = previewUrls.get(input.hash);
      if (!url) {
        let preview = input.preview;
        if (!preview) {
          if (
            input.blob.type === "image/svg+xml" ||
            (input.width !== undefined &&
              input.height !== undefined &&
              Math.max(input.width, input.height) <= SCRAP_PREVIEW_MAX_EDGE)
          )
            return;
          let job = previewJobs.get(input.hash);
          if (!job) {
            job = generatePreview(input.blob, batch, input.hash)
              .then((blob) => {
                // A disposable cache write must not hold up the ready image.
                if (blob) {
                  void storeImagePreview(input.hash, blob)
                    .then((stored) => {
                      if (stored) schedulePreviewTrim();
                    })
                    .catch((error: unknown) => {
                      console.warn(
                        "[scrap images] preview cache write failed:",
                        error,
                      );
                    });
                }
                return blob;
              })
              .catch((error: unknown) => {
                console.warn("[scrap images] preview unavailable:", error);
                return undefined;
              });
            previewJobs.set(input.hash, job);
          }
          preview = await job;
        }
        if (!preview) return;
        url = previewUrls.get(input.hash) ?? URL.createObjectURL(preview);
        previewUrls.set(input.hash, url);
      }
      urls.set(src, url);
    }),
  );
  return urls;
}

/** Makes every scrap image on this page display from its local copy when one is held. */
export function serveLocalScrapImages(): void {
  provideLocalScrapImages(
    async (srcs) => {
      const blobs = await readImageCopies(srcs);
      const urls = new Map<string, string>();
      for (const [src, blob] of blobs) {
        let url = objectUrls.get(src);
        if (!url) {
          url = URL.createObjectURL(blob);
          objectUrls.set(src, url);
        }
        urls.set(src, url);
      }
      return urls;
    },
    localPreviews,
    prioritizeVisiblePreviews,
  );
}

function imageSources(record: CollageRecord): string[] {
  return record.pieces.flatMap((piece) =>
    piece.scrap.kind === "image" && piece.scrap.src ? [piece.scrap.src] : [],
  );
}

/** Sources already tried this session, so an autosave never refetches a dead URL. */
const attempted = new Set<string>();

/**
 * Pins the images a collage holds so their copies are never let go while it
 * exists, replacing what it held before. An image with no copy yet, such as a
 * piece placed before copies existed, gets its one copy made now if its URL
 * still loads.
 */
export async function keepCollageImages(record: CollageRecord): Promise<void> {
  const srcs = imageSources(record);
  await pinCollageSources(record.id, srcs);
  let stored = false;
  for (const src of new Set(srcs)) {
    if (attempted.has(src)) continue;
    attempted.add(src);
    if (!/^https?:/i.test(src) || (await hasImageCopy(src))) continue;
    try {
      stored = (await storeImageCopy(await makeImageCopy(src))) || stored;
      forgetScrapImageSrc(src);
    } catch (error) {
      console.warn(
        "[scrap images]",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  if (stored) await trimImageCopies();
}

/** Lets a deleted collage's images go back to being ordinary, evictable copies. */
export async function releaseCollageImages(collageId: string): Promise<void> {
  await unpinCollage(collageId);
}

/** Runs a pin change without holding up the studio; a failure is logged. */
export function inBackground(work: Promise<void>): void {
  work.catch((error: unknown) =>
    console.warn("[scrap images] pin update failed:", error),
  );
}
