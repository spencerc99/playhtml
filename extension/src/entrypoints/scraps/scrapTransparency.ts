// ABOUTME: Tells whether a scrap actually has see-through pixels worth backing.
// ABOUTME: Sampled once per picture from a tiny canvas, then remembered.

import type { ScrapItem } from "@movement/components/ScrapCollage";

/** Formats that can carry an alpha channel at all; the rest never do. */
const MAYBE_TRANSPARENT = /\.(png|gif|webp|svg)(\?|#|$)/i;

/**
 * What the drawer puts behind a thumbnail: a chequer for material with holes
 * in it, the paper for everything else, or nothing at all when the scrap
 * already carries its page's own backdrop.
 */
export type ThumbBacking = "checker" | "paper" | "own";

/**
 * Answers already worked out, so a picture is sampled once however many times
 * it scrolls back into view. Keyed by source, because that is what decides it.
 */
const known = new Map<string, boolean>();

/** How wide the sample is drawn; a few thousand pixels is plenty to tell. */
const SAMPLE_SIDE = 32;

/**
 * Whether an image's source could hold alpha at all. A JPEG cannot, so it is
 * never sampled and never gets a backing it does not need.
 */
export function couldBeTransparent(src: string): boolean {
  if (typeof src !== "string" || src.length === 0) return false;
  if (src.startsWith("data:")) {
    return /^data:image\/(png|gif|webp|svg\+xml)/i.test(src);
  }
  return MAYBE_TRANSPARENT.test(src);
}

/**
 * The color a see-through scrap was read against on its own page, when one
 * was recorded. `ScrapContent` paints it as a snug patch behind the scrap, so
 * a scrap that carries one needs no backing from the drawer.
 *
 * Only a button carries one, and only when it was collected since the backdrop
 * began being recorded, so the absent case is answered rather than assumed.
 */
export function scrapBackdropColor(item: ScrapItem): string | null {
  const color = item.kind === "button" ? item.backdropColor : undefined;
  return typeof color === "string" && color.length > 0 ? color : null;
}

/**
 * The kinds that are always backed, whatever their pixels: an icon and a
 * cursor are cut-outs by nature, and a button or heading is drawn from a
 * reconstruction rather than from an image at all.
 *
 * A scrap that brought its page's own backdrop with it is already sitting on
 * something, so the drawer adds nothing behind it.
 */
export function backingForKind(item: ScrapItem): ThumbBacking | null {
  if (scrapBackdropColor(item)) return "own";
  switch (item.kind) {
    case "svg-icon":
    case "cursor":
      return "checker";
    case "button":
    case "heading":
      return "paper";
    case "image":
      return null;
  }
}

/** A remembered answer, or undefined when this picture has not been read. */
export function rememberedTransparency(src: string): boolean | undefined {
  return known.get(src);
}

/** Reads a decoded picture's pixels and says whether any are see-through. */
function hasAlpha(source: CanvasImageSource): boolean {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIDE;
  canvas.height = SAMPLE_SIDE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Could not get a context to read a thumbnail's alpha");
  }
  context.drawImage(source, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
  const { data } = context.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true;
  }
  return false;
}

/**
 * Whether a picture has see-through pixels, read once and then remembered.
 *
 * A picture drawn straight from a remote `<img>` taints the canvas and cannot
 * be read, so the bytes are fetched first — the extension holds host
 * permissions, which is the same route the bake takes.
 */
export async function readTransparency(src: string): Promise<boolean> {
  const remembered = known.get(src);
  if (remembered !== undefined) return remembered;

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`could not read a thumbnail: fetch returned ${response.status}`);
  }
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const transparent = hasAlpha(bitmap);
    known.set(src, transparent);
    return transparent;
  } finally {
    bitmap.close();
  }
}

/** Forgets every sampled answer. Only a test has a reason to do this. */
export function forgetTransparency(): void {
  known.clear();
}
