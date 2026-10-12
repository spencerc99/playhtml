// ABOUTME: Turns a studio collage into the public published-collage format and uploads or takes it down.
// ABOUTME: Words and icons travel as their captured markup; pictures come from a supplied resolver.

import {
  PUBLISHED_COLLAGE_FORMAT,
  PUBLISHED_COLLAGE_LIMITS,
  PUBLISHED_COLLAGE_VERSION,
  isPublishedCollageId,
  parsePublishedCollage,
  isSafeStyleValue,
  publishableStyles,
  publishedImageRef,
  webUrl,
  type PublishedCollage,
  type PublishedCollagePiece,
  type PublishedPieceContent,
  type PublishedPieceSource,
} from "../../../shared/publishedCollage";
import type { CropFraction } from "./collageGeometry";
import type {
  CollagePiece,
  CollageRecord,
  CollagePublication,
  ScrapSnapshot,
} from "./collageRecord";

/** A collage that could not be shared, with words fit to show the sharer. */
export class CollagePublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollagePublishError";
  }
}

/** The picture an image or cursor piece draws in a published collage. */
export interface PublishedPieceMaterial {
  /**
   * Pieces with the same key draw the same picture, so it is uploaded once.
   * An uncut image is keyed by its source; anything baked by its piece.
   */
  key: string;
  blob: Blob;
  /** Where the picture sits inside the piece's source box, when not all of it. */
  placement?: CropFraction;
  /** Whether the picture is a cutout baked before upload. */
  cutout?: boolean;
}

/** Finds the picture for a piece that is not published as content. */
export type PieceMaterialResolver = (
  piece: CollagePiece,
) => Promise<PublishedPieceMaterial>;

export interface BuiltPublication {
  collage: PublishedCollage;
  /** The pictures in `img/<n>` order. */
  images: Blob[];
  /** The whole collage as one picture, for link previews, when it could be drawn. */
  cover?: Blob;
}

/** Draws the whole collage as one picture for a shared link's preview. */
export type CollageCoverBaker = (
  record: Pick<CollageRecord, "frame" | "paper" | "pieces">,
) => Promise<Blob>;

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** What a shared piece says about where it came from. */
export function publishedSource(scrap: ScrapSnapshot): PublishedPieceSource {
  const limits = PUBLISHED_COLLAGE_LIMITS;
  const source: PublishedPieceSource = {
    kind: scrap.kind,
    // Only a web address becomes a link on the public page.
    pageUrl: webUrl(scrap.pageUrl) ?? "",
    pageTitle: clip(scrap.pageTitle ?? "", limits.maxPageTitleLength),
    domain: clip(scrap.domain ?? "", limits.maxDomainLength),
    ts: Number.isFinite(scrap.ts) && scrap.ts >= 0 ? scrap.ts : 0,
  };
  const favicon = scrap.faviconUrl ? webUrl(scrap.faviconUrl) : null;
  if (favicon) source.faviconUrl = favicon;
  const words =
    scrap.kind === "image"
      ? scrap.alt
      : scrap.kind === "button" || scrap.kind === "heading"
        ? scrap.text
        : undefined;
  const alt = words?.trim();
  if (alt) source.alt = clip(alt, limits.maxAltLength);
  if (
    scrap.kind === "image" &&
    scrap.naturalWidth > 0 &&
    scrap.naturalHeight > 0
  ) {
    source.naturalWidth = scrap.naturalWidth;
    source.naturalHeight = scrap.naturalHeight;
  }
  return source;
}

/**
 * The words and markup a button, heading or icon is published as, or null for
 * an image or cursor, which is published as a picture. Styles are cut down to
 * what the collector captures; the viewer sanitizes the markup again.
 */
export function publishedContent(
  scrap: ScrapSnapshot,
): PublishedPieceContent | null {
  switch (scrap.kind) {
    case "button": {
      const content: PublishedPieceContent = {
        kind: "button",
        text: scrap.text,
        styles: publishableStyles(scrap.styles),
      };
      if (scrap.innerSvg) content.innerSvg = scrap.innerSvg;
      if (scrap.backdropColor && isSafeStyleValue(scrap.backdropColor)) {
        content.backdropColor = scrap.backdropColor;
      }
      return content;
    }
    case "heading":
      return {
        kind: "heading",
        text: scrap.text,
        level: scrap.level,
        styles: publishableStyles(scrap.styles),
      };
    case "svg-icon":
      return {
        kind: "svg-icon",
        markup: scrap.markup,
        width: scrap.width,
        height: scrap.height,
      };
    default:
      return null;
  }
}

function sizeInMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The shared form of a collage and the pictures it draws, bottom of the stack
 * first. Throws `CollagePublishError` when it is empty or over the limits.
 */
export async function buildPublishedCollage(
  record: Pick<
    CollageRecord,
    "title" | "createdAt" | "frame" | "paper" | "pieces" | "backShows"
  >,
  materialFor: PieceMaterialResolver,
  coverFor?: CollageCoverBaker,
): Promise<BuiltPublication> {
  const limits = PUBLISHED_COLLAGE_LIMITS;
  if (record.pieces.length === 0) {
    throw new CollagePublishError("there is nothing on the collage to share");
  }
  if (record.pieces.length > limits.maxPieces) {
    throw new CollagePublishError(
      `a shared collage holds at most ${limits.maxPieces} pieces`,
    );
  }
  const ordered = [...record.pieces].sort((a, b) => a.z - b.z);
  const materials = await Promise.all(
    ordered.map((piece) => {
      const content = publishedContent(piece.scrap);
      if (content) return { content };
      return materialFor(piece).catch((error: unknown) => {
        throw new CollagePublishError(
          `a piece from ${piece.scrap.domain || "an unknown site"} could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }),
  );

  const indexByKey = new Map<string, number>();
  const images: Blob[] = [];
  let total = 0;
  const pieces: PublishedCollagePiece[] = ordered.map((piece, at) => {
    const material = materials[at];
    const geometry = {
      x: piece.x,
      y: piece.y,
      width: piece.width,
      height: piece.height,
      rotation: piece.rotation,
      z: at,
      crop: { ...piece.crop },
      flipX: piece.flipX,
      flipY: piece.flipY,
    };
    if ("content" in material) {
      const bytes = new TextEncoder().encode(
        JSON.stringify(material.content),
      ).byteLength;
      if (bytes > limits.maxContentBytes) {
        throw new CollagePublishError(
          `a ${piece.scrap.kind} from ${piece.scrap.domain || "an unknown site"} is too large to publish`,
        );
      }
      return {
        ...geometry,
        content: material.content,
        source: publishedSource(piece.scrap),
      };
    }
    let index = indexByKey.get(material.key);
    if (index === undefined) {
      if (material.blob.size > limits.maxImageBytes) {
        throw new CollagePublishError(
          `a picture from ${piece.scrap.domain} is ${sizeInMb(material.blob.size)}, over the 5 MB a shared picture may be`,
        );
      }
      total += material.blob.size;
      if (total > limits.maxTotalImageBytes) {
        throw new CollagePublishError(
          "the pictures add up to more than the 40 MB a shared collage may hold",
        );
      }
      index = images.length;
      images.push(material.blob);
      indexByKey.set(material.key, index);
    }
    return {
      ...geometry,
      image: publishedImageRef(index),
      ...(material.placement ? { placement: { ...material.placement } } : {}),
      ...(material.cutout ? { cutout: true as const } : {}),
      source: publishedSource(piece.scrap),
    };
  });

  const collage: PublishedCollage = {
    format: PUBLISHED_COLLAGE_FORMAT,
    version: PUBLISHED_COLLAGE_VERSION,
    title: clip(record.title.trim(), limits.maxTitleLength),
    frame: { width: record.frame.width, height: record.frame.height },
    paper: { color: record.paper.color, grain: record.paper.grain },
    pieces,
    ...(Number.isFinite(record.createdAt) && record.createdAt >= 0
      ? { createdAt: record.createdAt }
      : {}),
    ...(record.backShows ? { backShows: record.backShows } : {}),
  };
  // The Worker checks the same rules; failing here says so before uploading.
  try {
    parsePublishedCollage(collage);
  } catch (error) {
    throw new CollagePublishError(
      error instanceof Error ? error.message : String(error),
    );
  }
  return { collage, images, ...(await bakeCover(record, coverFor)) };
}

/** A cover is a nicety: a collage whose cover cannot be drawn still shares. */
async function bakeCover(
  record: Pick<CollageRecord, "frame" | "paper" | "pieces">,
  coverFor: CollageCoverBaker | undefined,
): Promise<{ cover?: Blob }> {
  if (!coverFor) return {};
  try {
    const cover = await coverFor(record);
    return cover.size > 0 &&
      cover.size <= PUBLISHED_COLLAGE_LIMITS.maxImageBytes
      ? { cover }
      : {};
  } catch (error) {
    console.warn("[collage publish] no cover for the link preview:", error);
    return {};
  }
}

/** The multipart body the Worker's `POST /collages` reads. */
export function publishFormData(built: BuiltPublication): FormData {
  const form = new FormData();
  form.set("collage", JSON.stringify(built.collage));
  built.images.forEach((blob, index) => {
    const ref = publishedImageRef(index);
    form.set(ref, blob, ref);
  });
  if (built.cover) form.set("cover", built.cover, "cover");
  return form;
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON; the status speaks for it.
  }
  return `the server answered ${response.status}`;
}

/** Uploads a built share and answers with what the collage record keeps. */
export async function uploadPublishedCollage(
  workerUrl: string,
  built: BuiltPublication,
  now: () => number = Date.now,
  fetcher: typeof fetch = fetch,
): Promise<CollagePublication> {
  let response: Response;
  try {
    response = await fetcher(`${workerUrl}/collages`, {
      method: "POST",
      body: publishFormData(built),
    });
  } catch {
    throw new CollagePublishError("the share server could not be reached");
  }
  if (!response.ok) throw new CollagePublishError(await errorText(response));
  const body = (await response.json()) as Record<string, unknown>;
  if (
    !isPublishedCollageId(body.id) ||
    typeof body.deleteToken !== "string" ||
    typeof body.url !== "string"
  ) {
    throw new CollagePublishError(
      "the share server answered something unexpected",
    );
  }
  return {
    id: body.id,
    deleteToken: body.deleteToken,
    url: body.url,
    sharedAt: now(),
  };
}

/**
 * Takes a shared link down. A link already gone counts as taken down, so a
 * collage whose link was removed elsewhere can still be marked unshared.
 */
export async function deletePublishedCollage(
  workerUrl: string,
  share: Pick<CollagePublication, "id" | "deleteToken">,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(
      `${workerUrl}/collages/${encodeURIComponent(share.id)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${share.deleteToken}` },
      },
    );
  } catch {
    throw new CollagePublishError("the share server could not be reached");
  }
  if (response.ok || response.status === 404) return;
  throw new CollagePublishError(await errorText(response));
}
