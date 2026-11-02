// ABOUTME: Finds the picture an image or cursor piece publishes: an image's own bytes, or a baked raster.
// ABOUTME: Reads local image copies first, and bakes cutouts and cursors the way the PNG export draws them.

import {
  PUBLISHED_COLLAGE_LIMITS,
  sniffPublishedImageType,
} from "../../../shared/publishedCollage";
import { resolveScrapImageSrc } from "@movement/utils/scrapImageSource";
import {
  bakeCollageCover,
  canvasPng,
  loadImage,
  prepareCollagePieces,
} from "./bakeCollage";
import type { CollagePiece, CollageRecord } from "./collageRecord";
import type { PublishedPieceMaterial } from "./publishCollage";

/** The longest side a baked or shrunk picture is given. */
const MAX_RASTER_SIDE = 2048;
/**
 * Pictures are published at twice their size on the collage, for sharpness on
 * dense screens and a viewer that shows the collage larger than it was made.
 */
const RASTER_DENSITY = 2;
/** Sizes are rounded up to this step, so one picture used twice at nearly the same size is sent once. */
const SIZE_STEP = 128;
/** Below this, a picture is sent as it is: re-encoding would save little. */
const SMALL_ENOUGH_BYTES = 150 * 1024;
/** WebP quality for shrunk photos; high enough that the viewer cannot tell. */
const PHOTO_QUALITY = 0.85;

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
  quality = 0.9,
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
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
  quality = 0.9,
): Promise<Blob> {
  const limit = PUBLISHED_COLLAGE_LIMITS.maxImageBytes;
  let size = { width, height };
  for (;;) {
    const canvas = rasterize(image, size.width, size.height);
    const blob =
      first === "image/png"
        ? await canvasPng(canvas, "the piece could not be drawn")
        : await canvasBlob(canvas, first, quality);
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
 * The longest side a picture needs to look sharp in its piece: the whole
 * picture's size on the collage (a cropped piece shows only part of it), at
 * the publish density, rounded up to a step.
 */
export function neededLongestSide(
  piece: Pick<CollagePiece, "width" | "height" | "crop">,
): number {
  const shownWidth = piece.width / Math.max(piece.crop.width, 0.01);
  const shownHeight = piece.height / Math.max(piece.crop.height, 0.01);
  const needed = Math.max(shownWidth, shownHeight) * RASTER_DENSITY;
  const stepped = Math.ceil(needed / SIZE_STEP) * SIZE_STEP;
  return Math.min(MAX_RASTER_SIDE, Math.max(SIZE_STEP, stepped));
}

/** How far into a PNG to look for its animation chunk, which must come before the first frame. */
const PNG_SCAN_BYTES = 1024 * 1024;

/** Whether a PNG is an APNG: it carries an `acTL` chunk before its first `IDAT`. */
async function isAnimatedPng(blob: Blob): Promise<boolean> {
  const scanned = new DataView(
    await blob.slice(0, Math.min(blob.size, PNG_SCAN_BYTES)).arrayBuffer(),
  );
  // Chunks follow the 8-byte signature: a 4-byte length, a 4-byte type, the
  // data, then a 4-byte CRC.
  for (let at = 8; at + 8 <= scanned.byteLength; ) {
    const length = scanned.getUint32(at);
    const type = String.fromCharCode(
      scanned.getUint8(at + 4),
      scanned.getUint8(at + 5),
      scanned.getUint8(at + 6),
      scanned.getUint8(at + 7),
    );
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    at += 12 + length;
  }
  // Not ruled out within the scan: keep the original rather than risk a still.
  return blob.size > PNG_SCAN_BYTES;
}

/** Whether redrawing the picture would keep only one frame of an animation. */
async function isAnimated(
  type: string | null,
  head: Uint8Array,
  blob: Blob,
): Promise<boolean> {
  if (type === "image/gif") return true;
  if (type === "image/png") return isAnimatedPng(blob);
  if (type !== "image/webp") return false;
  const chunk = String.fromCharCode(...head.slice(12, 16));
  return chunk === "VP8X" && (head[20] & 0x02) !== 0;
}

/**
 * The bytes an image scrap publishes. A picture larger than its piece needs is
 * shrunk to that size and written as WebP; an animated GIF, PNG or WebP, or
 * one already small, is sent as it is. A kind the share cannot carry (an SVG, say) is
 * always re-encoded.
 */
async function imageBytes(src: string, longest: number): Promise<Blob> {
  const display = await resolveScrapImageSrc(src);
  const response = await fetch(display);
  if (!response.ok) throw new Error(`the picture answered ${response.status}`);
  const blob = await response.blob();
  const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const type = sniffPublishedImageType(head);
  const asIs =
    type && blob.size <= PUBLISHED_COLLAGE_LIMITS.maxImageBytes
      ? blob.type === type
        ? blob
        : new Blob([blob], { type })
      : null;
  if (
    asIs &&
    (asIs.size <= SMALL_ENOUGH_BYTES || (await isAnimated(type, head, blob)))
  ) {
    return asIs;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const natural = {
      width: image.naturalWidth || 1,
      height: image.naturalHeight || 1,
    };
    const size = fitWithin(natural.width, natural.height, longest);
    const shrunk = await encodeWithin(
      image,
      size.width,
      size.height,
      "image/webp",
      PHOTO_QUALITY,
    );
    return asIs && asIs.size <= shrunk.size ? asIs : shrunk;
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
    const longest = neededLongestSide(piece);
    return {
      key: `src:${scrap.src}@${longest}`,
      blob: await imageBytes(scrap.src, longest),
    };
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
  // A cut-out keeps its transparency in WebP at a fraction of a PNG's size.
  const size = fitWithin(
    natural.width,
    natural.height,
    piece.cutout ? neededLongestSide(piece) : MAX_RASTER_SIDE,
  );
  const blob = piece.cutout
    ? await encodeWithin(
        image,
        size.width,
        size.height,
        "image/webp",
        PHOTO_QUALITY,
      )
    : await encodeWithin(image, size.width, size.height, "image/png");
  return {
    key: `piece:${piece.id}`,
    blob,
    ...(still.placement ? { placement: still.placement } : {}),
    ...(piece.cutout ? { cutout: true } : {}),
  };
}

/** The whole collage, paper and all, as the picture its shared link previews with. */
export async function publishCollageCover(
  record: Pick<CollageRecord, "frame" | "paper" | "pieces">,
): Promise<Blob> {
  const options = {
    frame: record.frame,
    pieces: record.pieces,
    paper: record.paper.color,
    grain: record.paper.grain,
  };
  const cover = await bakeCollageCover(options);
  if (cover.size <= PUBLISHED_COLLAGE_LIMITS.maxImageBytes) return cover;
  return bakeCollageCover({ ...options, longest: 800 });
}
