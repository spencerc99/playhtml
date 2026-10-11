// ABOUTME: Pure helpers for the shared-collage viewer: fetching, picture URLs, lightbox items, labels and fit.
// ABOUTME: Kept apart from the React page so the mapping from the shared format can be unit tested.

import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  isSharedCollageId,
  parseSharedCollage,
  webUrl,
  type SharedCollage,
  type SharedCollagePiece,
} from "../../shared/sharedCollage";

/** What fetching a shared collage came to. */
export type SharedCollageLoad =
  | { kind: "ok"; collage: SharedCollage }
  /** No such link, or the sharer took it down. */
  | { kind: "missing" }
  | { kind: "error"; message: string };

/** How much the sources toggle shows beside each piece. */
export type SourcesMode = "off" | "site" | "title";

export const SOURCES_MODES: readonly SourcesMode[] = ["off", "site", "title"];

/** The share id a viewer URL names, or null when it names none. */
export function sharedCollageIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get("id");
  return id && isSharedCollageId(id) ? id : null;
}

export function sharedCollageUrl(workerUrl: string, id: string): string {
  return `${workerUrl}/collages/${encodeURIComponent(id)}`;
}

/** Where a piece's picture is served, from its `img/<n>` name. */
export function sharedImageUrl(
  workerUrl: string,
  id: string,
  ref: string,
): string {
  return `${sharedCollageUrl(workerUrl, id)}/${ref}`;
}

export async function loadSharedCollage(
  workerUrl: string,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<SharedCollageLoad> {
  let response: Response;
  try {
    response = await fetcher(sharedCollageUrl(workerUrl, id));
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
    return { kind: "ok", collage: parseSharedCollage(await response.json()) };
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
  pieces: readonly SharedCollagePiece[],
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

/** A piece as the scraps lightbox examines it: always a picture, served by the Worker. */
export function pieceScrapItem(
  piece: SharedCollagePiece,
  index: number,
  imageUrl: string,
): ScrapItem {
  const { source } = piece;
  // Without a recorded size the source box stands in, which keeps the shape.
  const naturalWidth =
    source.naturalWidth ?? Math.round(piece.width / piece.crop.width);
  const naturalHeight =
    source.naturalHeight ?? Math.round(piece.height / piece.crop.height);
  const favicon = source.faviconUrl ? webUrl(source.faviconUrl) : null;
  return {
    id: `piece-${index}`,
    key: `piece-${index}`,
    kind: "image",
    src: imageUrl,
    naturalWidth,
    naturalHeight,
    ...(source.alt ? { alt: source.alt } : {}),
    pageTitle: source.pageTitle,
    domain: source.domain,
    // Only a plain web address becomes the lightbox's "visit page" link.
    pageUrl: webUrl(source.pageUrl) ?? "",
    ts: source.ts,
    ...(favicon ? { faviconUrl: favicon } : {}),
  };
}

/** What a source tag says in a given mode. */
export function sourceLabel(
  piece: SharedCollagePiece,
  mode: Exclude<SourcesMode, "off">,
): string {
  const domain = piece.source.domain || "an unknown site";
  if (mode === "site") return domain;
  return piece.source.pageTitle.trim() || domain;
}

/** A page's favicon, or the public favicon service when the scrap kept none. */
export function faviconFor(piece: SharedCollagePiece): string | null {
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

/** How a picture lies inside its piece's source box, as CSS percentages. */
export function placementStyle(piece: SharedCollagePiece): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  const place = piece.placement ?? { x: 0, y: 0, width: 1, height: 1 };
  return {
    left: `${place.x * 100}%`,
    top: `${place.y * 100}%`,
    width: `${place.width * 100}%`,
    height: `${place.height * 100}%`,
  };
}
