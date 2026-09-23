// ABOUTME: Downloads a scrap image and turns it into the one local copy the policy asks for.
// ABOUTME: Works in the service worker and in extension pages; nothing leaves the device.

import {
  COPY_DOWNLOAD_MAX_BYTES,
  IMAGE_COPY_TARGET_BYTES,
  STILL_COPY_MAX_EDGE,
  copyForm,
  encodeAttempts,
  isAnimatedImage,
} from "./imageCopyPolicy";
import type { NewImageCopy } from "./ScrapImageCopies";

const DOWNLOAD_TIMEOUT_MS = 20_000;

/** Why an image could not be copied; logged, never fatal. */
export class ImageCopyError extends Error {
  constructor(src: string, reason: string) {
    super(`No local copy of ${src}: ${reason}`);
    this.name = "ImageCopyError";
  }
}

/** Image types recognised from their first bytes, for servers that mislabel them. */
function sniffImageType(bytes: Uint8Array): string | undefined {
  const ascii = (start: number, text: string) =>
    [...text].every(
      (char, index) => bytes[start + index] === char.charCodeAt(0),
    );
  if (ascii(0, "GIF8")) return "image/gif";
  if (bytes[0] === 0x89 && ascii(1, "PNG")) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return undefined;
}

export interface DownloadedBytes {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: string;
}

/** Downloads an http(s) image without cookies, refusing anything over `maxBytes`. */
export async function downloadImage(
  src: string,
  maxBytes: number,
): Promise<DownloadedBytes> {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    throw new ImageCopyError(src, "not a URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new ImageCopyError(src, "only plain http(s) images are copied");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new ImageCopyError(src, `fetch returned ${response.status}`);
    }
    const declared = Number(response.headers.get("content-length"));
    if (declared > maxBytes) {
      throw new ImageCopyError(src, `${declared} bytes is over the limit`);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          throw new ImageCopyError(src, "the download ran over the limit");
        }
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    if (size === 0) throw new ImageCopyError(src, "the download was empty");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const declaredType = response.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    const mimeType = declaredType?.startsWith("image/")
      ? declaredType
      : sniffImageType(bytes);
    if (!mimeType) {
      throw new ImageCopyError(
        src,
        `${declaredType ?? "untyped"} is not an image`,
      );
    }
    return { bytes, mimeType };
  } catch (error) {
    if (error instanceof ImageCopyError) throw error;
    throw new ImageCopyError(
      src,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** The SHA-256 of the downloaded bytes, the same fingerprint scraps carry. */
export async function contentHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Redraws a decoded frame as WebP, stepping quality and then size down until
 * it fits the per-image target. The smallest attempt is kept even if still over.
 */
async function drawToFit(
  src: string,
  bitmap: ImageBitmap,
): Promise<{ blob: Blob; width: number; height: number }> {
  let canvas: OffscreenCanvas | null = null;
  let last: { blob: Blob; width: number; height: number } | null = null;
  for (const attempt of encodeAttempts(bitmap.width, bitmap.height)) {
    if (
      !canvas ||
      canvas.width !== attempt.width ||
      canvas.height !== attempt.height
    ) {
      canvas = new OffscreenCanvas(attempt.width, attempt.height);
      const context = canvas.getContext("2d");
      if (!context) throw new ImageCopyError(src, "no 2d context to draw on");
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, attempt.width, attempt.height);
    }
    const blob = await canvas.convertToBlob({
      type: "image/webp",
      quality: attempt.quality,
    });
    last = { blob, width: attempt.width, height: attempt.height };
    if (blob.size <= IMAGE_COPY_TARGET_BYTES) break;
  }
  if (!last) throw new ImageCopyError(src, "nothing was drawn");
  return last;
}

async function decode(src: string, original: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(original);
  } catch (error) {
    throw new ImageCopyError(
      src,
      `could not decode: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * The one local copy kept for an image: a still redrawn to fit the target
 * unless already small, an animation whole unless too large to keep, and SVG
 * as markup.
 */
export async function makeImageCopy(src: string): Promise<NewImageCopy> {
  const { bytes, mimeType } = await downloadImage(
    src,
    COPY_DOWNLOAD_MAX_BYTES,
  );
  const hash = await contentHash(bytes);
  const original = new Blob([bytes], { type: mimeType });

  if (mimeType === "image/svg+xml") {
    return { src, hash, blob: original, form: "original", mimeType };
  }

  const bitmap = await decode(src, original);
  try {
    const { width, height } = bitmap;
    const form = copyForm({
      byteLength: bytes.byteLength,
      mimeType,
      animated: isAnimatedImage(bytes),
      width,
      height,
    });
    if (form === "original") {
      return { src, hash, blob: original, form, mimeType, width, height };
    }
    const drawn = await drawToFit(src, bitmap);
    // A browser without a WebP encoder hands back PNG, which can come out
    // larger than the download; an image already within the cap stays as is.
    if (
      form === "reduced" &&
      drawn.blob.size >= original.size &&
      Math.max(width, height) <= STILL_COPY_MAX_EDGE
    ) {
      return {
        src,
        hash,
        blob: original,
        form: "original",
        mimeType,
        width,
        height,
      };
    }
    return {
      src,
      hash,
      blob: drawn.blob,
      form,
      mimeType: drawn.blob.type,
      width: drawn.width,
      height: drawn.height,
    };
  } finally {
    bitmap.close();
  }
}
