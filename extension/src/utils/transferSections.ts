// ABOUTME: Reads collages, saved pictures and identity out of local storage for an export,
// ABOUTME: and writes them back on import without replacing anything newer already here.

import {
  base64ToBytes,
  bytesToBase64,
  encodeCollageFile,
  readCollageFile,
} from "../entrypoints/scraps/collageFile";
import type { CollageRecord } from "../entrypoints/scraps/collageRecord";
import {
  listCollages,
  loadCollage,
  saveCollage,
} from "../entrypoints/scraps/collageStore";
import {
  listCollagePins,
  listImageSources,
  pinCollageSources,
  readImageCopy,
  storeImageCopy,
} from "../storage/ScrapImageCopies";
import type { CopyForm } from "../storage/imageCopyPolicy";
import {
  saveStoredPlayerIdentity,
  type StoredPlayerIdentity,
} from "../storage/playerIdentity";
import type { ExportedImage } from "./dataTransfer";

/** What a person can choose to bring along. */
export type TransferSection = "history" | "scraps" | "collages" | "you";

/** Scraps are element events; every other event is browsing history. */
export function eventSection(type: string): "history" | "scraps" {
  return type === "element" ? "scraps" : "history";
}

/** The image URLs a collage holds pieces of. */
export function collageImageSources(record: CollageRecord): string[] {
  return record.pieces.flatMap((piece) =>
    piece.scrap.kind === "image" && piece.scrap.src ? [piece.scrap.src] : [],
  );
}

/** Ids of every collage that can be read, newest first. */
export async function readableCollageIds(): Promise<string[]> {
  return (await listCollages())
    .filter((entry) => !("unreadable" in entry) && entry.id !== "")
    .map((entry) => entry.id);
}

/**
 * Picture hashes to export, each with the URLs that point at it. Scraps bring
 * every saved picture; collages alone bring only the pictures they hold.
 */
export async function picturesToExport(
  withScraps: boolean,
  withCollages: boolean,
): Promise<Map<string, string[]>> {
  const byHash = new Map<string, string[]>();
  if (!withScraps && !withCollages) return byHash;
  const pinned = withScraps
    ? null
    : new Set((await listCollagePins()).flatMap((pin) => pin.srcs));
  for (const { src, hash } of await listImageSources()) {
    if (pinned && !pinned.has(src)) continue;
    const srcs = byHash.get(hash);
    if (srcs) srcs.push(src);
    else byHash.set(hash, [src]);
  }
  return byHash;
}

export async function* exportedImages(
  byHash: Map<string, string[]>,
): AsyncGenerator<ExportedImage> {
  for (const [hash, srcs] of byHash) {
    const held = await readImageCopy(hash);
    // Trimmed away after the list was read.
    if (!held) continue;
    yield {
      hash,
      srcs,
      form: held.copy.form,
      mimeType: held.copy.mimeType,
      ...(held.copy.width !== undefined ? { width: held.copy.width } : {}),
      ...(held.copy.height !== undefined ? { height: held.copy.height } : {}),
      base64: bytesToBase64(new Uint8Array(await held.blob.arrayBuffer())),
    };
  }
}

export async function* exportedCollages(
  ids: string[],
): AsyncGenerator<unknown> {
  for (const id of ids) {
    const record = await loadCollage(id).catch(() => null);
    if (!record) continue;
    yield JSON.parse(await encodeCollageFile(record));
  }
}

function isExportedImage(value: unknown): value is ExportedImage {
  const image = value as ExportedImage;
  return (
    typeof image === "object" &&
    image !== null &&
    typeof image.hash === "string" &&
    Array.isArray(image.srcs) &&
    typeof image.mimeType === "string" &&
    typeof image.base64 === "string"
  );
}

/** Saves one picture under each URL it came from. Returns whether it was new here. */
export async function importImage(value: unknown): Promise<boolean> {
  if (!isExportedImage(value)) return false;
  const blob = new Blob([base64ToBytes(value.base64)], {
    type: value.mimeType,
  });
  let added = false;
  for (const src of value.srcs) {
    if (typeof src !== "string") continue;
    const wrote = await storeImageCopy({
      src,
      hash: value.hash,
      blob,
      form: value.form as CopyForm,
      mimeType: value.mimeType,
      ...(value.width !== undefined ? { width: value.width } : {}),
      ...(value.height !== undefined ? { height: value.height } : {}),
    });
    added ||= wrote;
  }
  return added;
}

/**
 * Saves a collage under its own id, so bringing the same file in twice never
 * doubles it. A copy here that was changed more recently is kept instead.
 */
export async function importCollage(value: unknown): Promise<"added" | "kept"> {
  const record = readCollageFile(JSON.stringify(value));
  const here = await loadCollage(record.id).catch(() => null);
  if (here && here.updatedAt >= record.updatedAt) return "kept";
  await saveCollage(record);
  // Keeps the pictures it holds from being let go, as the studio does on save.
  await pinCollageSources(record.id, collageImageSources(record));
  return "added";
}

function isStoredIdentity(value: unknown): value is StoredPlayerIdentity {
  const identity = value as StoredPlayerIdentity;
  return (
    typeof identity === "object" &&
    identity !== null &&
    typeof identity.public?.publicKey === "string" &&
    Array.isArray(identity.public?.playerStyle?.colorPalette) &&
    typeof identity.privateKey === "object" &&
    identity.privateKey !== null
  );
}

/** Becomes the person the file remembers. Returns false if the file's identity is unusable. */
export async function importIdentity(value: unknown): Promise<boolean> {
  if (!isStoredIdentity(value)) return false;
  await saveStoredPlayerIdentity({
    public: value.public,
    privateKey: value.privateKey,
  });
  return true;
}

/** A short name for the browser a file is packed up in, for the import screen. */
export function browserName(userAgent: string): string | undefined {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Chrome\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return undefined;
}
