// ABOUTME: Makes small still-image copies for gallery tiles without changing their full-size copies.
// ABOUTME: Preserves animations and SVGs, and never enlarges a source image.

import { isAnimatedImage } from "./imageCopyPolicy";

export const SCRAP_PREVIEW_MAX_EDGE = 640;

export async function previewFromBitmap(
  bitmap: ImageBitmap,
): Promise<Blob | undefined> {
  const edge = Math.max(bitmap.width, bitmap.height);
  if (edge <= SCRAP_PREVIEW_MAX_EDGE) return undefined;
  const scale = SCRAP_PREVIEW_MAX_EDGE / edge;
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No context for scrap preview");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparent = false;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] < 255) {
      transparent = true;
      break;
    }
  }
  return canvas.convertToBlob({
    type: transparent ? "image/png" : "image/jpeg",
    quality: 0.85,
  });
}

export async function makeScrapImagePreview(
  blob: Blob,
): Promise<Blob | undefined> {
  if (blob.type === "image/svg+xml") return undefined;
  if (isAnimatedImage(new Uint8Array(await blob.arrayBuffer())))
    return undefined;
  const bitmap = await createImageBitmap(blob);
  try {
    return await previewFromBitmap(bitmap);
  } finally {
    bitmap.close();
  }
}
