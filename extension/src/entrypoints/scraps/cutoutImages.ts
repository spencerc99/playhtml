// ABOUTME: Recomputes a piece's cutout mask over its cropped pixels from stored parameters.
// ABOUTME: Serves the mask to the studio as a CSS mask and to the bake as a cut canvas.

import type { CropFraction } from "./collageGeometry";
import {
  applyMaskAlpha,
  cropPixelRegion,
  edgeColorMask,
  featherMask,
  regionPlacement,
  scaleMask,
  workingSize,
  type PieceCutout,
  type PixelRegion,
} from "./backgroundCutout";
import { resolveScrapImageSrc } from "@movement/utils/scrapImageSource";

/** Names the image whose backdrop could not be read, so a notice can say so. */
export class CutoutError extends Error {
  constructor(source: string, cause: string) {
    super(`The background of ${source} could not be read: ${cause}`);
    this.name = "CutoutError";
  }
}

/**
 * A backdrop mask computed over the pixels a crop keeps. Coverage is at the
 * working resolution of that region: 0 where the backdrop was removed, 255
 * where the subject stays.
 */
interface CutoutMask {
  image: HTMLImageElement;
  region: PixelRegion;
  /** The region as fractions of the whole source, snapped to its pixels. */
  placement: CropFraction;
  coverage: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A cut image covering only the cropped region, and where it sits. */
export interface CutoutImage {
  canvas: HTMLCanvasElement;
  placement: CropFraction;
}

/** The mask as an image a CSS `mask-image` can use, and where it sits. */
export interface CutoutMaskImage {
  url: string;
  placement: CropFraction;
}

function cacheKey(src: string, cutout: PieceCutout, crop: CropFraction): string {
  const edges = [crop.x, crop.y, crop.width, crop.height]
    .map((value) => value.toFixed(6))
    .join(",");
  return `${cutout.method}:${cutout.tolerance.toFixed(4)}:${edges}:${src}`;
}

const masks = new Map<string, Promise<CutoutMask>>();
const canvases = new Map<string, Promise<CutoutImage>>();
const maskImages = new Map<string, Promise<CutoutMaskImage>>();

/** Keeps a pending result for the session, forgetting it again if it fails. */
function remember<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  compute: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = compute();
  cache.set(key, pending);
  // A failed cut must not be remembered as the answer for that image.
  pending.catch(() => cache.delete(key));
  return pending;
}

/**
 * Loads a scrap image through `fetch` so its bytes arrive same-origin, the
 * same way the bake does, keeping the canvas readable. An animated image
 * decodes to its first frame when drawn.
 */
async function loadPixels(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "sync";
  if (src.startsWith("data:")) {
    image.src = src;
  } else {
    const response = await fetch(await resolveScrapImageSrc(src));
    if (!response.ok) throw new Error(`fetch returned ${response.status}`);
    image.src = URL.createObjectURL(await response.blob());
  }
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image failed to decode"));
    });
  } finally {
    if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src);
  }
  return image;
}

function blankCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context for the cutout");
  return { canvas, context };
}

/** Draws only the region's pixels, stretched to fill a canvas of the given size. */
function regionCanvas(
  image: HTMLImageElement,
  region: PixelRegion,
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const drawn = blankCanvas(width, height);
  drawn.context.drawImage(
    image,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    width,
    height,
  );
  return drawn;
}

/**
 * The backdrop mask for the part of the image a crop keeps. The flood is seeded
 * from the border of the cropped pixels, so a crop that trims a busy picture
 * down to a subject on a small plain backdrop cuts that backdrop away.
 */
function cutoutMask(
  src: string,
  cutout: PieceCutout,
  crop: CropFraction,
): Promise<CutoutMask> {
  return remember(masks, cacheKey(src, cutout, crop), async () => {
    let image: HTMLImageElement;
    try {
      image = await loadPixels(src);
    } catch (error) {
      throw new CutoutError(
        src,
        error instanceof Error ? error.message : String(error),
      );
    }

    const fullWidth = image.naturalWidth || image.width;
    const fullHeight = image.naturalHeight || image.height;
    const region = cropPixelRegion(crop, fullWidth, fullHeight);
    const working = workingSize(region.width, region.height);

    const probe = regionCanvas(image, region, working.width, working.height);
    const sample = probe.context.getImageData(
      0,
      0,
      working.width,
      working.height,
    );
    const coverage = featherMask(
      edgeColorMask(
        { width: working.width, height: working.height, data: sample.data },
        cutout.tolerance,
      ),
      working.width,
      working.height,
    );
    return {
      image,
      region,
      placement: regionPlacement(region, fullWidth, fullHeight),
      coverage,
      width: working.width,
      height: working.height,
    };
  });
}

/**
 * The cropped part of the scrap image with its backdrop removed, at the
 * image's own resolution, for the bake to draw at `placement` within the
 * piece's source box. The cut is never stored, only the parameters that
 * produce it.
 */
export function cutoutCanvas(
  src: string,
  cutout: PieceCutout,
  crop: CropFraction,
): Promise<CutoutImage> {
  return remember(canvases, cacheKey(src, cutout, crop), async () => {
    const mask = await cutoutMask(src, cutout, crop);
    const { region } = mask;
    const full = regionCanvas(mask.image, region, region.width, region.height);
    const pixels = full.context.getImageData(0, 0, region.width, region.height);
    applyMaskAlpha(
      { width: region.width, height: region.height, data: pixels.data },
      scaleMask(
        mask.coverage,
        mask.width,
        mask.height,
        region.width,
        region.height,
      ),
    );
    full.context.putImageData(pixels, 0, 0);
    return { canvas: full.canvas, placement: mask.placement };
  });
}

/**
 * The mask alone, as a blob URL whose alpha is the coverage. The studio lays
 * it over the original `<img>` with CSS, so an animated image keeps moving
 * under a mask taken from its first frame. The URL lives for the session,
 * shared by every piece that shows the same cut.
 */
export function cutoutMaskImage(
  src: string,
  cutout: PieceCutout,
  crop: CropFraction,
): Promise<CutoutMaskImage> {
  return remember(maskImages, cacheKey(src, cutout, crop), async () => {
    const mask = await cutoutMask(src, cutout, crop);
    const drawn = blankCanvas(mask.width, mask.height);
    const pixels = drawn.context.createImageData(mask.width, mask.height);
    for (let index = 0; index < mask.coverage.length; index += 1) {
      pixels.data[index * 4 + 3] = mask.coverage[index];
    }
    drawn.context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      drawn.canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new CutoutError(src, "the cut mask produced no bytes");
    return { url: URL.createObjectURL(blob), placement: mask.placement };
  });
}
