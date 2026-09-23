// ABOUTME: Recomputes a piece's cut-out image from its stored parameters.
// ABOUTME: Caches per source and parameters for the session; nothing is persisted.

import {
  applyMaskAlpha,
  edgeColorMask,
  featherMask,
  scaleMask,
  workingSize,
  type PieceCutout,
} from "./backgroundCutout";
import { resolveScrapImageSrc } from "@movement/utils/scrapImageSource";

/** Names the image whose backdrop could not be read, so a notice can say so. */
export class CutoutError extends Error {
  constructor(source: string, cause: string) {
    super(`The background of ${source} could not be read: ${cause}`);
    this.name = "CutoutError";
  }
}

function cacheKey(src: string, cutout: PieceCutout): string {
  return `${cutout.method}:${cutout.tolerance.toFixed(4)}:${src}`;
}

const cutouts = new Map<string, Promise<HTMLCanvasElement>>();

/**
 * Loads a scrap image through `fetch` so its bytes arrive same-origin, the
 * same way the bake does, keeping the canvas readable.
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

function drawToCanvas(
  image: HTMLImageElement,
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context for the cutout");
  context.drawImage(image, 0, 0, width, height);
  return { canvas, context };
}

/**
 * The scrap image with its backdrop removed, as a canvas both the studio and
 * the bake can draw. Results are cached per source and parameters for the
 * session; the cut is never stored, only the parameters that produce it.
 */
export function cutoutCanvas(
  src: string,
  cutout: PieceCutout,
): Promise<HTMLCanvasElement> {
  const key = cacheKey(src, cutout);
  const cached = cutouts.get(key);
  if (cached) return cached;

  const pending = (async () => {
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
    const working = workingSize(fullWidth, fullHeight);

    const probe = drawToCanvas(image, working.width, working.height);
    const sample = probe.context.getImageData(
      0,
      0,
      working.width,
      working.height,
    );
    const mask = featherMask(
      edgeColorMask(
        {
          width: working.width,
          height: working.height,
          data: sample.data,
        },
        cutout.tolerance,
      ),
      working.width,
      working.height,
    );

    const full = drawToCanvas(image, fullWidth, fullHeight);
    const pixels = full.context.getImageData(0, 0, fullWidth, fullHeight);
    applyMaskAlpha(
      { width: fullWidth, height: fullHeight, data: pixels.data },
      scaleMask(
        mask,
        working.width,
        working.height,
        fullWidth,
        fullHeight,
      ),
    );
    full.context.putImageData(pixels, 0, 0);
    return full.canvas;
  })();

  cutouts.set(key, pending);
  // A failed cut must not be remembered as the answer for that image.
  pending.catch(() => cutouts.delete(key));
  return pending;
}

/** The cut-out image as a blob URL the studio can show in an `<img>`. */
export async function cutoutObjectUrl(
  src: string,
  cutout: PieceCutout,
): Promise<string> {
  const canvas = await cutoutCanvas(src, cutout);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new CutoutError(src, "the cut image produced no bytes");
  return URL.createObjectURL(blob);
}
