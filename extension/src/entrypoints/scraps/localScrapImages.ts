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
  storeImageCopy,
  trimImageCopies,
  unpinCollage,
} from "../../storage/ScrapImageCopies";
import { makeImageCopy } from "../../storage/imageCopyMaking";

/** Blob URLs live as long as the page, so every surface on it shares one per image. */
const objectUrls = new Map<string, string>();

/** Makes every scrap image on this page display from its local copy when one is held. */
export function serveLocalScrapImages(): void {
  provideLocalScrapImages(async (srcs) => {
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
  });
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
