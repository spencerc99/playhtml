// ABOUTME: Decides how a scrap image's local copy is kept and which copies make way when space runs out.
// ABOUTME: Pure rules with no storage or network, shared by the collector's copier and the studio's pins.

import { COLLAGE_FORMATS } from "../entrypoints/scraps/collageFormats";

/** Total space the local image copies may use before the oldest unpinned ones are let go. */
export const IMAGE_COPY_BUDGET_BYTES = 1024 * 1024 * 1024;

/** Size each still copy is encoded down to fit within. */
export const IMAGE_COPY_TARGET_BYTES = 200 * 1024;

/**
 * Longest side a still copy is drawn at: the longest side of the largest
 * collage format. A collage is exported at its frame size, so a larger copy
 * would never be seen.
 */
export const STILL_COPY_MAX_EDGE = Math.max(
  ...Object.values(COLLAGE_FORMATS).map((format) =>
    Math.max(format.width, format.height),
  ),
);

/** WebP qualities tried in turn at full size until the copy fits the target. */
export const STILL_COPY_QUALITIES = [0.85, 0.75, 0.65, 0.55] as const;

/** Lowest WebP quality used; past it the copy is drawn smaller instead. */
export const STILL_COPY_QUALITY_FLOOR = 0.55;

/** How much each smaller attempt shrinks the sides once quality is at its floor. */
export const STILL_COPY_SHRINK = 0.8;

/** Shortest longest-side a copy is shrunk to while trying to fit the target. */
export const STILL_COPY_MIN_EDGE = 240;

/**
 * An animated image up to this size is kept whole, since redrawing it would
 * keep only one frame. Above it, only its first frame is kept, as a still.
 */
export const ANIMATED_ORIGINAL_MAX_BYTES = 2 * 1024 * 1024;

/** Largest download the copier will take on. */
export const COPY_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

/**
 * How a copy relates to the downloaded image:
 * - `original`: the downloaded bytes, unchanged
 * - `reduced`: a still redrawn smaller as WebP
 * - `still-frame`: the first frame of an animation too large to keep whole
 */
export type CopyForm = "original" | "reduced" | "still-frame";

function startsWith(bytes: Uint8Array, ascii: string, offset = 0): boolean {
  if (bytes.length < offset + ascii.length) return false;
  for (let index = 0; index < ascii.length; index++) {
    if (bytes[offset + index] !== ascii.charCodeAt(index)) return false;
  }
  return true;
}

/** Counts GIF image descriptors, stopping once a second frame is found. */
function gifHasSeveralFrames(bytes: Uint8Array): boolean {
  if (bytes.length < 13) return false;
  let offset = 13;
  const packed = bytes[10];
  if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1);
  let frames = 0;
  while (offset < bytes.length) {
    const block = bytes[offset];
    if (block === 0x3b) break;
    if (block === 0x21) {
      offset += 2;
      offset = skipSubBlocks(bytes, offset);
      continue;
    }
    if (block !== 0x2c) break;
    frames++;
    if (frames > 1) return true;
    if (offset + 10 > bytes.length) break;
    const imagePacked = bytes[offset + 9];
    offset += 10;
    if (imagePacked & 0x80) offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
    offset += 1;
    offset = skipSubBlocks(bytes, offset);
  }
  return false;
}

function skipSubBlocks(bytes: Uint8Array, start: number): number {
  let offset = start;
  while (offset < bytes.length) {
    const size = bytes[offset];
    offset += 1;
    if (size === 0) break;
    offset += size;
  }
  return offset;
}

/** An APNG declares its animation in an `acTL` chunk ahead of its image data. */
function pngIsAnimated(bytes: Uint8Array): boolean {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length =
      ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
      0;
    if (startsWith(bytes, "acTL", offset + 4)) return true;
    if (startsWith(bytes, "IDAT", offset + 4)) return false;
    offset += 12 + length;
  }
  return false;
}

/** An animated WebP sets the animation flag in its extended `VP8X` header. */
function webpIsAnimated(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, "VP8X", 12) || bytes.length < 21) return false;
  return (bytes[20] & 0x02) !== 0;
}

/** Whether the bytes are an image with more than one frame. */
export function isAnimatedImage(bytes: Uint8Array): boolean {
  if (startsWith(bytes, "GIF87a") || startsWith(bytes, "GIF89a")) {
    return gifHasSeveralFrames(bytes);
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && startsWith(bytes, "PNG", 1)) {
    return pngIsAnimated(bytes);
  }
  if (startsWith(bytes, "RIFF") && startsWith(bytes, "WEBP", 8)) {
    return webpIsAnimated(bytes);
  }
  return false;
}

export interface DownloadedImage {
  byteLength: number;
  mimeType: string;
  animated: boolean;
  /** Decoded size; absent for formats that are kept without decoding. */
  width?: number;
  height?: number;
}

/**
 * Which form an image is kept in. A small still within the size cap is kept as
 * downloaded; any other still is redrawn to fit. An animation is kept whole
 * while it is small enough, and otherwise shrinks to its first frame. SVG is
 * kept as markup.
 */
export function copyForm(image: DownloadedImage): CopyForm {
  if (image.mimeType === "image/svg+xml") return "original";
  if (image.animated) {
    return image.byteLength <= ANIMATED_ORIGINAL_MAX_BYTES
      ? "original"
      : "still-frame";
  }
  if (image.width === undefined || image.height === undefined) {
    throw new Error("A still image must be decoded before choosing its copy");
  }
  const edge = Math.max(image.width, image.height);
  if (
    edge <= STILL_COPY_MAX_EDGE &&
    image.byteLength <= IMAGE_COPY_TARGET_BYTES
  ) {
    return "original";
  }
  return "reduced";
}

export interface EncodeAttempt {
  width: number;
  height: number;
  quality: number;
}

function scaledTo(
  width: number,
  height: number,
  edge: number,
): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The encodes to try, in order, until one fits the target: the capped size at
 * falling quality, then smaller sizes at the quality floor. Never enlarges.
 * The last attempt is kept even if it is still over the target.
 */
export function encodeAttempts(width: number, height: number): EncodeAttempt[] {
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`An image of ${width}×${height} cannot be redrawn`);
  }
  const full = scaledTo(width, height, STILL_COPY_MAX_EDGE);
  const attempts: EncodeAttempt[] = STILL_COPY_QUALITIES.map((quality) => ({
    ...full,
    quality,
  }));
  let edge = Math.max(full.width, full.height);
  const smallest = Math.min(edge, STILL_COPY_MIN_EDGE);
  while (edge > smallest) {
    edge = Math.max(smallest, Math.round(edge * STILL_COPY_SHRINK));
    attempts.push({
      ...scaledTo(width, height, edge),
      quality: STILL_COPY_QUALITY_FLOOR,
    });
  }
  return attempts;
}

export interface CollagePin {
  collageId: string;
  srcs: readonly string[];
}

/** Every image source some saved collage still holds a piece of. */
export function pinnedSources(pins: readonly CollagePin[]): Set<string> {
  const pinned = new Set<string>();
  for (const pin of pins) for (const src of pin.srcs) pinned.add(src);
  return pinned;
}

export interface StoredCopySummary {
  hash: string;
  byteLength: number;
  storedAt: number;
}

/**
 * Copies to let go, oldest first, until the total fits the budget. A pinned
 * copy is never chosen, so a collage's pieces outlast everything else even
 * when they alone go over.
 */
export function copiesToEvict(
  copies: readonly StoredCopySummary[],
  pinnedHashes: ReadonlySet<string>,
  budgetBytes: number = IMAGE_COPY_BUDGET_BYTES,
): string[] {
  let total = copies.reduce((sum, copy) => sum + copy.byteLength, 0);
  if (total <= budgetBytes) return [];
  const evictable = copies
    .filter((copy) => !pinnedHashes.has(copy.hash))
    .sort((a, b) => a.storedAt - b.storedAt);
  const evicted: string[] = [];
  for (const copy of evictable) {
    if (total <= budgetBytes) break;
    evicted.push(copy.hash);
    total -= copy.byteLength;
  }
  return evicted;
}
