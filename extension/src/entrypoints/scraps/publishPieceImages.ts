// ABOUTME: Finds the picture an image or cursor piece publishes: an image's own bytes, or a baked raster.
// ABOUTME: Reads local image copies first, and bakes cutouts and cursors the way the PNG export draws them.

import {
  PUBLISHED_COLLAGE_LIMITS,
  sniffPublishedImageType,
} from "../../../shared/publishedCollage";
import { resolveScrapImageSrc } from "@movement/utils/scrapImageSource";
import { canvasPng, loadImage, prepareCollagePieces } from "./bakeCollage";
import type { CollagePiece } from "./collageRecord";
import type { PublishedPieceMaterial } from "./publishCollage";

/** The longest side a baked or shrunk picture is given. */
const MAX_RASTER_SIDE = 2048;
/** Cursors are baked at twice their size on the collage, for sharpness. */
const RASTER_DENSITY = 2;

function fitWithin(width: number, height: number, longest: number) {
  const scale = Math.min(1, longest / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function rasterize(
  image: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("could not get a canvas to draw the picture on");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

async function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, 0.9),
  );
  // A browser that cannot write the asked-for type writes a PNG instead.
  return blob ?? canvasPng(canvas, "the picture could not be written");
}

/**
 * Draws a picture at the given size and writes it in the first type that fits
 * the share's per-picture limit, stepping the size down until one does. A
 * large transparent cut-out can be several megabytes as a PNG.
 */
async function encodeWithin(
  image: CanvasImageSource,
  width: number,
  height: number,
  first: "image/png" | "image/webp",
): Promise<Blob> {
  const limit = PUBLISHED_COLLAGE_LIMITS.maxImageBytes;
  let size = { width, height };
  for (;;) {
    const canvas = rasterize(image, size.width, size.height);
    const blob =
      first === "image/png"
        ? await canvasPng(canvas, "the piece could not be drawn")
        : await canvasBlob(canvas, first);
    if (blob.size <= limit) return blob;
    if (first === "image/png") {
      const webp = await canvasBlob(canvas, "image/webp");
      if (webp.size <= limit) return webp;
    }
    if (Math.max(size.width, size.height) <= 256) return blob;
    size = {
      width: Math.max(1, Math.round(size.width * 0.75)),
      height: Math.max(1, Math.round(size.height * 0.75)),
    };
  }
}

/**
 * The bytes of an image scrap as they are, so an animated GIF stays animated,
 * or a re-encoded copy when they are a kind the share cannot carry (an SVG,
 * say) or too large to.
 */
async function imageBytes(src: string): Promise<Blob> {
  const display = await resolveScrapImageSrc(src);
  const response = await fetch(display);
  if (!response.ok) throw new Error(`the picture answered ${response.status}`);
  const blob = await response.blob();
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const type = sniffPublishedImageType(head);
  if (type && blob.size <= PUBLISHED_COLLAGE_LIMITS.maxImageBytes) {
    return blob.type === type ? blob : new Blob([blob], { type });
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const size = fitWithin(
      image.naturalWidth || 1,
      image.naturalHeight || 1,
      MAX_RASTER_SIDE,
    );
    return await encodeWithin(image, size.width, size.height, "image/webp");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The picture a piece publishes. Uncut images send their own bytes; cut images
 * and cursors are baked by the same drawing the PNG export uses. Buttons,
 * headings and icons never come here: they publish their markup instead.
 */
export async function publishPieceMaterial(
  piece: CollagePiece,
): Promise<PublishedPieceMaterial> {
  const { scrap } = piece;
  if (scrap.kind === "image" && !piece.cutout) {
    return { key: `src:${scrap.src}`, blob: await imageBytes(scrap.src) };
  }
  const [prepared] = await prepareCollagePieces([piece]);
  const { still, source } = prepared;
  const covered = still.placement ?? { x: 0, y: 0, width: 1, height: 1 };
  const image = still.image;
  // A cut canvas is already at the image's own resolution; the rest are drawn
  // at their size on the collage.
  const natural =
    image instanceof HTMLCanvasElement
      ? { width: image.width, height: image.height }
      : {
          width: source.width * covered.width * RASTER_DENSITY,
          height: source.height * covered.height * RASTER_DENSITY,
        };
  const size = fitWithin(natural.width, natural.height, MAX_RASTER_SIDE);
  const blob = await encodeWithin(image, size.width, size.height, "image/png");
  return {
    key: `piece:${piece.id}`,
    blob,
    ...(still.placement ? { placement: still.placement } : {}),
    ...(piece.cutout ? { cutout: true } : {}),
  };
}
