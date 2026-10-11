// ABOUTME: Helpers for the published-collage viewer: fetching, picture URLs, studio pieces, labels and fit.
// ABOUTME: Kept apart from the React page so the mapping from the published format can be unit tested.

import type { ScrapItem } from "@movement/components/ScrapCollage";
import type { CollagePiece } from "@extension/entrypoints/scraps/collageRecord";
import {
  isPublishedCollageId,
  parsePublishedCollage,
  webUrl,
  type PublishedCollage,
  type PublishedCollagePiece,
  type PublishedPieceContent,
} from "../../shared/publishedCollage";
import {
  sanitizeColor,
  sanitizeStyles,
  sanitizeSvgMarkup,
} from "./sanitizeMarkup";

/** What fetching a shared collage came to. */
export type PublishedCollageLoad =
  | { kind: "ok"; collage: PublishedCollage }
  /** No such link, or the sharer took it down. */
  | { kind: "missing" }
  | { kind: "error"; message: string };

/** How much the sources toggle shows beside each piece. */
export type SourcesMode = "off" | "site" | "title";

export const SOURCES_MODES: readonly SourcesMode[] = ["off", "site", "title"];

/** The share id a viewer URL names, or null when it names none. */
export function publishedCollageIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get("id");
  return id && isPublishedCollageId(id) ? id : null;
}

export function publishedCollageUrl(workerUrl: string, id: string): string {
  return `${workerUrl}/collages/${encodeURIComponent(id)}`;
}

/** Where a piece's picture is served, from its `img/<n>` name. */
export function publishedImageUrl(
  workerUrl: string,
  id: string,
  ref: string,
): string {
  return `${publishedCollageUrl(workerUrl, id)}/${ref}`;
}

export async function loadPublishedCollage(
  workerUrl: string,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<PublishedCollageLoad> {
  let response: Response;
  try {
    response = await fetcher(publishedCollageUrl(workerUrl, id));
  } catch {
    return { kind: "error", message: "the collage could not be reached" };
  }
  if (response.status === 404) return { kind: "missing" };
  if (!response.ok) {
    return {
      kind: "error",
      message: `the collage server answered ${response.status}`,
    };
  }
  try {
    return {
      kind: "ok",
      collage: parsePublishedCollage(await response.json()),
    };
  } catch (error) {
    return {
      kind: "error",
      message: `the collage could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * The pieces in the order arrow keys walk them: across in rows, top to bottom,
 * the way a page is read, rather than in the stack order nobody can see.
 */
export function readingOrder(
  pieces: readonly PublishedCollagePiece[],
  frameHeight: number,
): number[] {
  const band = Math.max(1, frameHeight / 6);
  return pieces
    .map((piece, index) => ({
      index,
      row: Math.floor((piece.y + piece.height / 2) / band),
      x: piece.x + piece.width / 2,
    }))
    .sort((a, b) => a.row - b.row || a.x - b.x || a.index - b.index)
    .map((entry) => entry.index);
}

/**
 * A published piece ready to show: as a studio piece, which the studio's own
 * material and bake draw, and as the scrap the lightbox examines.
 */
export interface ViewerPiece {
  piece: CollagePiece;
  item: ScrapItem;
}

/** The fields every scrap carries, from where the piece came from. */
function scrapBase(piece: PublishedCollagePiece, index: number) {
  const { source } = piece;
  const favicon = source.faviconUrl ? webUrl(source.faviconUrl) : null;
  return {
    id: `piece-${index}`,
    key: `piece-${index}`,
    pageTitle: source.pageTitle,
    domain: source.domain,
    // Only a plain web address becomes the lightbox's "visit page" link.
    pageUrl: webUrl(source.pageUrl) ?? "",
    ts: source.ts,
    ...(favicon ? { faviconUrl: favicon } : {}),
  };
}

/**
 * The scrap a content piece is set from, its markup sanitized again here, at
 * render time, whatever the stored copy says.
 */
function contentScrap(
  content: PublishedPieceContent,
  base: ReturnType<typeof scrapBase>,
): ScrapItem {
  switch (content.kind) {
    case "button": {
      const innerSvg = content.innerSvg
        ? sanitizeSvgMarkup(content.innerSvg)
        : "";
      const backdropColor = sanitizeColor(content.backdropColor);
      return {
        ...base,
        kind: "button",
        text: content.text,
        styles: sanitizeStyles(content.styles),
        ...(innerSvg ? { innerSvg } : {}),
        ...(backdropColor ? { backdropColor } : {}),
      };
    }
    case "heading":
      return {
        ...base,
        kind: "heading",
        text: content.text,
        level: content.level,
        styles: sanitizeStyles(content.styles),
      };
    case "svg-icon":
      return {
        ...base,
        kind: "svg-icon",
        markup: sanitizeSvgMarkup(content.markup),
        width: content.width,
        height: content.height,
      };
  }
}

/**
 * The crop of a picture that covers only part of its piece's source box, as
 * a baked cutout does, re-expressed against the picture itself, so the picture
 * becomes the whole source and the visible box stays exactly where it was.
 */
export function cropWithinPicture(
  piece: PublishedCollagePiece,
): PublishedCollagePiece["crop"] {
  const place = piece.placement;
  if (!place) return { ...piece.crop };
  return {
    x: (piece.crop.x - place.x) / place.width,
    y: (piece.crop.y - place.y) / place.height,
    width: piece.crop.width / place.width,
    height: piece.crop.height / place.height,
  };
}

/**
 * Every published piece as the viewer shows it, in stack order. A picture is
 * drawn as an image filling its source box; the lightbox still names it by
 * the kind of scrap it was, so a cursor reads as a cursor.
 */
export function viewerPieces(
  collage: PublishedCollage,
  imageUrlFor: (ref: string) => string,
): ViewerPiece[] {
  return collage.pieces.map((published, index) => {
    const base = scrapBase(published, index);
    const geometry = {
      id: base.id,
      scrapId: base.id,
      x: published.x,
      y: published.y,
      width: published.width,
      height: published.height,
      rotation: published.rotation,
      z: published.z,
      flipX: published.flipX,
      flipY: published.flipY,
    };
    if (published.content) {
      const scrap = contentScrap(published.content, base);
      return {
        piece: { ...geometry, crop: { ...published.crop }, scrap },
        item: scrap,
      };
    }
    const src = imageUrlFor(published.image ?? "");
    const crop = cropWithinPicture(published);
    const { source } = published;
    // Without a recorded size, the picture's box on the collage stands in.
    const naturalWidth =
      source.naturalWidth ?? Math.round(published.width / crop.width);
    const naturalHeight =
      source.naturalHeight ?? Math.round(published.height / crop.height);
    const image: ScrapItem = {
      ...base,
      kind: "image",
      src,
      naturalWidth,
      naturalHeight,
      ...(source.alt ? { alt: source.alt } : {}),
    };
    const item: ScrapItem =
      source.kind === "cursor" ? { ...base, kind: "cursor", url: src } : image;
    return { piece: { ...geometry, crop, scrap: image }, item };
  });
}

/** What a source tag says in a given mode. */
export function sourceLabel(
  piece: PublishedCollagePiece,
  mode: Exclude<SourcesMode, "off">,
): string {
  const domain = piece.source.domain || "an unknown site";
  if (mode === "site") return domain;
  return piece.source.pageTitle.trim() || domain;
}

/** A page's favicon, or the public favicon service when the scrap kept none. */
export function faviconFor(piece: PublishedCollagePiece): string | null {
  const own = piece.source.faviconUrl ? webUrl(piece.source.faviconUrl) : null;
  if (own) return own;
  if (!piece.source.domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(piece.source.domain)}&sz=64`;
}

/** A steady colour for a site, for a favicon that cannot load. */
export function placeholderColor(domain: string): string {
  let hash = 0;
  for (const char of domain) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 32% 72%)`;
}

/** The scale that fits the whole frame inside the space left for it, never above 1. */
export function fitScale(
  frame: { width: number; height: number },
  space: { width: number; height: number },
): number {
  const scale = Math.min(
    space.width / frame.width,
    space.height / frame.height,
    1,
  );
  return Math.max(0.05, scale);
}
