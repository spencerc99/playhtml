// ABOUTME: Turns a studio collage into the public shared-collage format and uploads or takes it down.
// ABOUTME: Each piece's picture comes from a supplied resolver, so the format logic stays testable.

import {
  SHARED_COLLAGE_FORMAT,
  SHARED_COLLAGE_LIMITS,
  SHARED_COLLAGE_VERSION,
  isSharedCollageId,
  parseSharedCollage,
  sharedImageRef,
  webUrl,
  type SharedCollage,
  type SharedCollagePiece,
  type SharedPieceSource,
} from "../../../shared/sharedCollage";
import type { CropFraction } from "./collageGeometry";
import type {
  CollagePiece,
  CollageRecord,
  CollageShare,
  ScrapSnapshot,
} from "./collageRecord";

/** A collage that could not be shared, with words fit to show the sharer. */
export class CollageShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollageShareError";
  }
}

/** The picture a piece draws in a shared collage. */
export interface SharedPieceMaterial {
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

export type PieceMaterialResolver = (
  piece: CollagePiece,
) => Promise<SharedPieceMaterial>;

export interface BuiltShare {
  collage: SharedCollage;
  /** The pictures in `img/<n>` order. */
  images: Blob[];
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** What a shared piece says about where it came from. */
export function sharedSource(scrap: ScrapSnapshot): SharedPieceSource {
  const limits = SHARED_COLLAGE_LIMITS;
  const source: SharedPieceSource = {
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

function sizeInMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The shared form of a collage and the pictures it draws, bottom of the stack
 * first. Throws `CollageShareError` when it is empty or over the limits.
 */
export async function buildSharedCollage(
  record: Pick<CollageRecord, "title" | "frame" | "paper" | "pieces">,
  materialFor: PieceMaterialResolver,
): Promise<BuiltShare> {
  const limits = SHARED_COLLAGE_LIMITS;
  if (record.pieces.length === 0) {
    throw new CollageShareError("there is nothing on the collage to share");
  }
  if (record.pieces.length > limits.maxPieces) {
    throw new CollageShareError(
      `a shared collage holds at most ${limits.maxPieces} pieces`,
    );
  }
  const ordered = [...record.pieces].sort((a, b) => a.z - b.z);
  const materials = await Promise.all(
    ordered.map((piece) =>
      materialFor(piece).catch((error: unknown) => {
        throw new CollageShareError(
          `a piece from ${piece.scrap.domain || "an unknown site"} could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }),
    ),
  );

  const indexByKey = new Map<string, number>();
  const images: Blob[] = [];
  let total = 0;
  const pieces: SharedCollagePiece[] = ordered.map((piece, at) => {
    const material = materials[at];
    let index = indexByKey.get(material.key);
    if (index === undefined) {
      if (material.blob.size > limits.maxImageBytes) {
        throw new CollageShareError(
          `a picture from ${piece.scrap.domain} is ${sizeInMb(material.blob.size)}, over the 5 MB a shared picture may be`,
        );
      }
      total += material.blob.size;
      if (total > limits.maxTotalImageBytes) {
        throw new CollageShareError(
          "the pictures add up to more than the 40 MB a shared collage may hold",
        );
      }
      index = images.length;
      images.push(material.blob);
      indexByKey.set(material.key, index);
    }
    return {
      x: piece.x,
      y: piece.y,
      width: piece.width,
      height: piece.height,
      rotation: piece.rotation,
      z: at,
      crop: { ...piece.crop },
      flipX: piece.flipX,
      flipY: piece.flipY,
      image: sharedImageRef(index),
      ...(material.placement ? { placement: { ...material.placement } } : {}),
      ...(material.cutout ? { cutout: true as const } : {}),
      source: sharedSource(piece.scrap),
    };
  });

  const collage: SharedCollage = {
    format: SHARED_COLLAGE_FORMAT,
    version: SHARED_COLLAGE_VERSION,
    title: clip(record.title.trim(), limits.maxTitleLength),
    frame: { width: record.frame.width, height: record.frame.height },
    paper: { color: record.paper.color, grain: record.paper.grain },
    pieces,
  };
  // The Worker checks the same rules; failing here says so before uploading.
  try {
    parseSharedCollage(collage);
  } catch (error) {
    throw new CollageShareError(
      error instanceof Error ? error.message : String(error),
    );
  }
  return { collage, images };
}

/** The multipart body the Worker's `POST /collages` reads. */
export function shareFormData(built: BuiltShare): FormData {
  const form = new FormData();
  form.set("collage", JSON.stringify(built.collage));
  built.images.forEach((blob, index) => {
    const ref = sharedImageRef(index);
    form.set(ref, blob, ref);
  });
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
export async function uploadSharedCollage(
  workerUrl: string,
  built: BuiltShare,
  now: () => number = Date.now,
  fetcher: typeof fetch = fetch,
): Promise<CollageShare> {
  let response: Response;
  try {
    response = await fetcher(`${workerUrl}/collages`, {
      method: "POST",
      body: shareFormData(built),
    });
  } catch {
    throw new CollageShareError("the share server could not be reached");
  }
  if (!response.ok) throw new CollageShareError(await errorText(response));
  const body = (await response.json()) as Record<string, unknown>;
  if (
    !isSharedCollageId(body.id) ||
    typeof body.deleteToken !== "string" ||
    typeof body.url !== "string"
  ) {
    throw new CollageShareError(
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
export async function deleteSharedCollage(
  workerUrl: string,
  share: Pick<CollageShare, "id" | "deleteToken">,
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
    throw new CollageShareError("the share server could not be reached");
  }
  if (response.ok || response.status === 404) return;
  throw new CollageShareError(await errorText(response));
}
