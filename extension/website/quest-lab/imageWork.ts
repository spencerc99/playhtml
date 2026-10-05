// ABOUTME: Browser-side image work for the quest lab: loading scraps, downscaling for Clef, cutouts, silhouettes.
// ABOUTME: Cutouts reuse the collage editor's edge-color backdrop removal so results match the real editor.

import {
  applyMaskAlpha,
  edgeColorMask,
  featherMask,
  workingSize,
} from "@extension/entrypoints/scraps/backgroundCutout";
import type { ImageScrap } from "./questions";

function proxied(src: string): string {
  return `/api/quest-lab/image?src=${encodeURIComponent(src)}`;
}

export function imageUrl(scrap: ImageScrap): string {
  return proxied(scrap.src);
}


const loadedImages = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(scrap: ImageScrap): Promise<HTMLImageElement> {
  let pending = loadedImages.get(scrap.src);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load ${scrap.src}`));
      image.src = imageUrl(scrap);
    });
    loadedImages.set(scrap.src, pending);
  }
  return pending;
}

function drawn(image: HTMLImageElement, cap: number) {
  const size = workingSize(image.naturalWidth, image.naturalHeight, cap);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No 2d canvas context");
  context.drawImage(image, 0, 0, size.width, size.height);
  return { canvas, context, ...size };
}

/** A JPEG data URL small enough for Clef's per-image limit. */
export async function clefImage(scrap: ImageScrap): Promise<string> {
  const { canvas, context, width, height } = drawn(await loadImage(scrap), 768);
  // Transparent pixels would turn black in a JPEG; put them on white like a page.
  context.globalCompositeOperation = "destination-over";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export interface Cutout {
  /** Object URL of the image with its backdrop made transparent, cut exactly as the editor cuts it. */
  url: string;
  /** Silhouette coverage at a small working size: 255 subject, 0 backdrop. */
  mask: Uint8ClampedArray;
  width: number;
  height: number;
  /** Share of pixels kept as subject; 1 means nothing was removed. */
  keptShare: number;
  tolerance: number;
}

/** Longest side of the mask used for silhouettes and shape layouts. */
const MASK_SIDE = 256;

/**
 * Longest side the cut is computed at. The editor works at 1024; the lab cuts
 * hundreds of scraps at once, so it runs the same steps at half that.
 */
const CUT_SIDE = 512;

const cutouts = new Map<string, Promise<Cutout>>();

/**
 * The scrap cut by the collage editor's own steps (edge flood, then feather)
 * at this edge tolerance, so what the lab shows matches what an exported
 * collage will show, give or take resolution.
 */
export function cutoutOf(scrap: ImageScrap, tolerance: number): Promise<Cutout> {
  const key = `${tolerance.toFixed(2)}:${scrap.src}`;
  let pending = cutouts.get(key);
  if (!pending) {
    pending = loadImage(scrap).then(
      async (image) => {
        const { canvas: cut, context: cutContext, width: cw, height: ch } = drawn(image, CUT_SIDE);
        const pixels = cutContext.getImageData(0, 0, cw, ch);
        applyMaskAlpha(pixels, featherMask(edgeColorMask(pixels, tolerance), cw, ch));
        cutContext.putImageData(pixels, 0, 0);
        const size = workingSize(cut.width, cut.height, MASK_SIDE);
        const small = document.createElement("canvas");
        small.width = size.width;
        small.height = size.height;
        const context = small.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("No 2d canvas context");
        context.drawImage(cut, 0, 0, size.width, size.height);
        const alpha = context.getImageData(0, 0, size.width, size.height).data;
        const mask = new Uint8ClampedArray(size.width * size.height);
        let kept = 0;
        for (let index = 0; index < mask.length; index += 1) {
          if (alpha[index * 4 + 3] > 127) {
            mask[index] = 255;
            kept += 1;
          }
        }
        const blob = await new Promise<Blob | null>((resolve) => cut.toBlob(resolve, "image/png"));
        if (!blob) throw new Error(`The cut of ${scrap.src} produced no bytes`);
        return {
          url: URL.createObjectURL(blob),
          mask,
          width: size.width,
          height: size.height,
          keptShare: kept / mask.length,
          tolerance,
        };
      },
    );
    pending.catch(() => cutouts.delete(key));
    cutouts.set(key, pending);
  }
  return pending;
}

const silhouettes = new WeakMap<Uint8ClampedArray, Map<string, string>>();

/** The silhouette filled solid, as a data URL, for judging the shape by eye. Drawn once per mask and color. */
export function silhouetteUrl(
  cutout: Pick<Cutout, "mask" | "width" | "height">,
  color: string,
): string {
  let byColor = silhouettes.get(cutout.mask);
  if (!byColor) silhouettes.set(cutout.mask, (byColor = new Map()));
  const known = byColor.get(color);
  if (known) return known;
  const url = drawSilhouette(cutout, color);
  byColor.set(color, url);
  return url;
}

function drawSilhouette(cutout: Pick<Cutout, "mask" | "width" | "height">, color: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = cutout.width;
  canvas.height = cutout.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2d canvas context");
  const pixels = context.createImageData(cutout.width, cutout.height);
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
  cutout.mask.forEach((value, index) => {
    pixels.data[index * 4] = r;
    pixels.data[index * 4 + 1] = g;
    pixels.data[index * 4 + 2] = b;
    pixels.data[index * 4 + 3] = value;
  });
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}
