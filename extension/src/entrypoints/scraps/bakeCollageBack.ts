// ABOUTME: Bakes the back of a collage to a PNG by rasterizing the markup the studio shows.
// ABOUTME: Also inlines what that markup needs: the fonts, the maker's mark, favicons, the front.

import loraSemibold from "@fontsource/lora/files/lora-latin-600-normal.woff2?url";
import martianRegular from "@fontsource/martian-mono/files/martian-mono-latin-400-normal.woff2?url";
import sourceSerifLightItalic from "@fontsource/source-serif-4/files/source-serif-4-latin-200-italic.woff2?url";
import type { CollageFrame, CollageProvenance } from "./collageRecord";
import type { CollagePaper } from "./collageFormats";
import {
  BACK_FONTS,
  collageBackDocument,
  collageBackMarkup,
  type BackFavicon,
  type CollageBackContent,
} from "./collageBack";
import { webPageHref } from "./scrapLinks";
import { canvasPng, loadImage } from "./bakeCollage";
import { cutoutCanvas } from "./cutoutImages";

/** How long a favicon may take before the back is written without it. */
const FAVICON_TIMEOUT_MS = 5000;
/**
 * The size the front is carried at to show through the back, relative to the
 * frame. It is blurred and faint, so half size loses nothing visible and keeps
 * the back's document small.
 */
const BLEED_SCALE = 0.5;
/** The engraved extension icon, bundled at the extension's root. */
const MARK_ICON_PATH = "/icon/128.png";
/**
 * How far from the icon's cream paper a pixel may be and still be cut away.
 * The engraving's paper is a near-flat cream, well apart from its ink.
 */
const MARK_PAPER_TOLERANCE = 0.12;

/**
 * The engraving with its own cream paper cut away, through the same edge-color
 * flood a scrap's cutout uses, so only its lines press into the collage paper.
 */
async function markIconDataUrl(): Promise<string> {
  const cut = await cutoutCanvas(MARK_ICON_PATH, {
    method: "edge-color",
    tolerance: MARK_PAPER_TOLERANCE,
  });
  return cut.toDataURL("image/png");
}

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("could not read the bytes back"));
    reader.readAsDataURL(blob);
  });
}

async function fetchDataUrl(url: string, what: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${what} would not load (${response.status})`);
  }
  return asDataUrl(await response.blob());
}

/** What every back needs inlined, whatever collage it belongs to. */
export interface BackAssets {
  /** `@font-face` rules for the back's own faces, bytes inlined. */
  fontFaces: string;
  /** The maker's mark engraving, its paper cut away, as a data URL. */
  markIcon: string;
}

let assets: Promise<BackAssets> | null = null;

/** Reads the back's fonts and maker's mark once per page and keeps them. */
export function backAssets(): Promise<BackAssets> {
  if (!assets) {
    const face = async (
      family: string,
      weight: number,
      fontStyle: "normal" | "italic",
      url: string,
    ) =>
      `@font-face{font-family:'${family}';font-style:${fontStyle};font-weight:${weight};src:url(${await fetchDataUrl(
        url,
        `the ${family} face`,
      )}) format('woff2');}`;
    assets = Promise.all([
      face(BACK_FONTS.serif, 600, "normal", loraSemibold),
      face(BACK_FONTS.mono, 400, "normal", martianRegular),
      face(BACK_FONTS.wordmark, 200, "italic", sourceSerifLightItalic),
      markIconDataUrl(),
    ]).then(([serif, mono, wordmark, markIcon]) => ({
      fontFaces: serif + mono + wordmark,
      markIcon,
    }));
    // A failed load is not kept, so the next look at the back asks again.
    assets.catch(() => {
      assets = null;
    });
  }
  return assets;
}

const faviconCache = new Map<string, Promise<BackFavicon>>();

async function fetchFavicon(href: string): Promise<BackFavicon> {
  try {
    const response = await fetch(href, {
      signal: AbortSignal.timeout(FAVICON_TIMEOUT_MS),
    });
    if (!response.ok) return "missing";
    const blob = await response.blob();
    if (blob.size === 0) return "missing";
    return { data: await asDataUrl(blob) };
  } catch {
    // An unreachable favicon is drawn as the empty ring, which says so.
    return "missing";
  }
}

/**
 * Each source page's favicon as a data URL, so the studio and the bake show
 * the same bytes; an SVG drawn as an image cannot load a remote one at all.
 * Only a plain web address is ever fetched.
 */
export async function resolveBackFavicons(
  sources: readonly CollageProvenance[],
): Promise<Map<string, BackFavicon>> {
  const entries = await Promise.all(
    sources.map(async (source) => {
      const href = source.faviconUrl ? webPageHref(source.faviconUrl) : null;
      if (!href) return [source.pageUrl, "missing"] as const;
      let pending = faviconCache.get(href);
      if (!pending) {
        pending = fetchFavicon(href);
        faviconCache.set(href, pending);
      }
      return [source.pageUrl, await pending] as const;
    }),
  );
  return new Map<string, BackFavicon>(entries);
}

/** The baked front, shrunk to the size it is shown through the back at. */
export async function bleedDataUrl(
  front: Blob,
  frame: CollageFrame,
): Promise<string> {
  const url = URL.createObjectURL(front);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(frame.width * BLEED_SCALE);
    canvas.height = Math.round(frame.height * BLEED_SCALE);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not get a 2d drawing context for the show-through");
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // The front is drawn on opaque paper, so nothing is lost to a JPEG.
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface BackBakeOptions {
  frame: CollageFrame;
  paper: CollagePaper;
  content: CollageBackContent;
  /** The baked front, shown mirrored and faint as if through the paper. */
  front: Blob | null;
  favicons: ReadonlyMap<string, BackFavicon>;
  /** Pixel density relative to the frame's logical size, matching the front. */
  scale?: number;
}

/**
 * Draws the back: the studio's own markup, wrapped in an SVG foreignObject
 * with the fonts inlined, rasterized at the front's pixel size.
 */
export async function bakeCollageBack(options: BackBakeOptions): Promise<Blob> {
  const { frame } = options;
  const scale = options.scale ?? 2;
  const { fontFaces, markIcon } = await backAssets();
  const bleed = options.front ? await bleedDataUrl(options.front, frame) : null;
  const image = await loadImage(
    collageBackDocument({
      frame,
      markup: collageBackMarkup({
        frame,
        paper: options.paper,
        content: options.content,
        favicons: options.favicons,
        bleed,
        markIcon,
      }),
      fontFaces,
      pixelScale: scale,
    }),
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(frame.width * scale);
  canvas.height = Math.round(frame.height * scale);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get a 2d drawing context for the collage back");
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasPng(canvas, "The collage back canvas produced no image");
}
