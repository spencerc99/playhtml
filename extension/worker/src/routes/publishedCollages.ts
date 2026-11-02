// ABOUTME: Stores, serves and deletes collages shared as public view-only links, in the SHARED_COLLAGES R2 bucket.
// ABOUTME: Uploads are validated strictly and rate limited; each share carries its own delete token.

import {
  PUBLISHED_COLLAGE_LIMITS,
  PublishedCollageError,
  isPublishedCollageId,
  parsePublishedCollage,
  publishedCollageViewerUrl,
  publishedImageIndex,
  publishedImageIndexes,
  sniffPublishedImageType,
  type PublishedCollage,
  type PublishedCollageCreated,
} from "../../../shared/publishedCollage";
import type { Env } from "../lib/supabase";

/*
 * Upload format: one multipart/form-data body. The `collage` part is the
 * published-collage JSON, and each picture is its own file part named `img/<n>`.
 * Multipart keeps the pictures as raw bytes (base64 in a JSON envelope would
 * add a third to every upload and force one huge JSON parse), lets the Worker
 * check each part's size on its own, and is what a browser's FormData sends
 * without any encoding code on the extension side. An optional `cover` part is
 * a picture of the whole collage, shown when the link is pasted somewhere.
 */

const RATE_LIMIT_RETRY_SECONDS = 60;
/** Room for the multipart boundaries and headers around the parts. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const MAX_BODY_BYTES =
  PUBLISHED_COLLAGE_LIMITS.maxTotalImageBytes +
  PUBLISHED_COLLAGE_LIMITS.maxImageBytes +
  PUBLISHED_COLLAGE_LIMITS.maxCollageJsonBytes +
  MULTIPART_OVERHEAD_BYTES;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
};

const COLLAGE_PATH = /^\/collages\/([^/]+)$/;
const IMAGE_PATH = /^\/collages\/([^/]+)\/(img\/[^/]+)$/;
const COVER_PATH = /^\/collages\/([^/]+)\/cover$/;
/** The picture types a link preview can show. */
const COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function collagePrefix(id: string): string {
  return `collages/${id}/`;
}

function collageKey(id: string): string {
  return `${collagePrefix(id)}collage.json`;
}

function imageKey(id: string, ref: string): string {
  return `${collagePrefix(id)}${ref}`;
}

function coverKey(id: string): string {
  return `${collagePrefix(id)}cover`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 128 random bits: unguessable, so a link is only found by being given it. */
export function createPublishedCollageId(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

/** 256 random bits, handed to the sharer once and stored only as a hash. */
export function createDeleteToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashDeleteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Compares two hashes without returning early on the first difference. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let at = 0; at < a.length; at += 1) {
    difference |= a.charCodeAt(at) ^ b.charCodeAt(at);
  }
  return difference === 0;
}

/** What a request asks of the published-collage routes, or null when it is not theirs. */
export type PublishedCollageRoute =
  | { kind: "create" }
  | { kind: "collage"; id: string }
  | { kind: "image"; id: string; ref: string }
  | { kind: "cover"; id: string };

export function matchPublishedCollageRoute(
  path: string,
): PublishedCollageRoute | null {
  if (path === "/collages") return { kind: "create" };
  const image = IMAGE_PATH.exec(path);
  if (image) return { kind: "image", id: image[1], ref: image[2] };
  const cover = COVER_PATH.exec(path);
  if (cover) return { kind: "cover", id: cover[1] };
  const collage = COLLAGE_PATH.exec(path);
  if (collage) return { kind: "collage", id: collage[1] };
  return null;
}

export async function handlePublishedCollages(
  request: Request,
  env: Env,
  route: PublishedCollageRoute,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  if (route.kind === "create") {
    if (request.method !== "POST")
      return jsonResponse(405, { error: "Method not allowed" });
    return handleCreate(request, env);
  }
  if (!isPublishedCollageId(route.id))
    return jsonResponse(404, { error: "Not found" });
  if (route.kind === "image") {
    if (request.method !== "GET")
      return jsonResponse(405, { error: "Method not allowed" });
    return handleImage(request, env, route.id, route.ref, ctx);
  }
  if (route.kind === "cover") {
    if (request.method !== "GET")
      return jsonResponse(405, { error: "Method not allowed" });
    return servePicture(request, env, coverKey(route.id), ctx);
  }
  if (request.method === "GET") return handleRead(env, route.id);
  if (request.method === "DELETE") return handleDelete(request, env, route.id);
  return jsonResponse(405, { error: "Method not allowed" });
}

interface ParsedUpload {
  collage: PublishedCollage;
  images: { ref: string; bytes: Uint8Array; type: string }[];
  cover: { bytes: Uint8Array; type: string } | null;
}

/** Reads and checks an upload, or says exactly what is wrong with it. */
export async function readPublishedCollageUpload(
  request: Request,
): Promise<ParsedUpload> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new PublishedCollageError("the upload must be multipart/form-data");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new PublishedCollageError(
      "the upload is not readable multipart form data",
    );
  }

  const collagePart = form.get("collage");
  if (collagePart === null)
    throw new PublishedCollageError("the upload has no collage part");
  const collageText =
    typeof collagePart === "string"
      ? collagePart
      : await (collagePart as File).text();
  if (
    new TextEncoder().encode(collageText).length >
    PUBLISHED_COLLAGE_LIMITS.maxCollageJsonBytes
  ) {
    throw new PublishedCollageError("the collage description is too large");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(collageText);
  } catch {
    throw new PublishedCollageError("the collage part is not JSON");
  }
  const collage = parsePublishedCollage(raw);
  const indexes = publishedImageIndexes(collage);
  if (indexes.length > PUBLISHED_COLLAGE_LIMITS.maxImages) {
    throw new PublishedCollageError(
      `the collage has more than ${PUBLISHED_COLLAGE_LIMITS.maxImages} pictures`,
    );
  }

  // Every part besides the collage must be a picture the collage draws.
  const expected = new Set(indexes.map((index) => `img/${index}`));
  for (const name of new Set(form.keys())) {
    if (name === "collage" || name === "cover") {
      if (form.getAll(name).length !== 1)
        throw new PublishedCollageError(`the upload repeats ${name}`);
      continue;
    }
    if (!expected.has(name))
      throw new PublishedCollageError(
        `the upload has an unexpected part: ${name}`,
      );
    if (form.getAll(name).length !== 1)
      throw new PublishedCollageError(`the upload repeats ${name}`);
  }

  let total = 0;
  const images: ParsedUpload["images"] = [];
  for (const ref of expected) {
    const part = form.get(ref);
    if (part === null || typeof part === "string") {
      throw new PublishedCollageError(
        `the upload is missing the picture ${ref}`,
      );
    }
    const file = part as File;
    if (file.size === 0)
      throw new PublishedCollageError(`the picture ${ref} is empty`);
    if (file.size > PUBLISHED_COLLAGE_LIMITS.maxImageBytes) {
      throw new PublishedCollageError(`the picture ${ref} is larger than 5 MB`);
    }
    total += file.size;
    if (total > PUBLISHED_COLLAGE_LIMITS.maxTotalImageBytes) {
      throw new PublishedCollageError("the pictures add up to more than 40 MB");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffPublishedImageType(bytes);
    if (type === null) {
      throw new PublishedCollageError(
        `the picture ${ref} is not a PNG, JPEG, GIF, WebP or AVIF image`,
      );
    }
    images.push({ ref, bytes, type });
  }
  return { collage, images, cover: await readCover(form.get("cover")) };
}

async function readCover(
  part: FormDataEntryValue | null,
): Promise<ParsedUpload["cover"]> {
  if (part === null) return null;
  if (typeof part === "string")
    throw new PublishedCollageError("the cover is not a picture");
  const file = part as File;
  if (file.size === 0) throw new PublishedCollageError("the cover is empty");
  if (file.size > PUBLISHED_COLLAGE_LIMITS.maxImageBytes)
    throw new PublishedCollageError("the cover is larger than 5 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffPublishedImageType(bytes);
  if (type === null || !COVER_TYPES.has(type))
    throw new PublishedCollageError(
      "the cover is not a PNG, JPEG or WebP image",
    );
  return { bytes, type };
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  let allowed: boolean;
  try {
    const outcome = await env.COLLAGE_SHARE_RATE_LIMITER.limit({
      key: request.headers.get("CF-Connecting-IP") ?? "unidentified-client",
    });
    allowed = outcome.success;
  } catch (error) {
    console.error("[published collages] rate limiter unavailable:", error);
    return jsonResponse(503, { error: "Sharing is temporarily unavailable" });
  }
  if (!allowed) {
    return jsonResponse(
      429,
      { error: "Too many collages shared at once; try again in a minute" },
      { "Retry-After": String(RATE_LIMIT_RETRY_SECONDS) },
    );
  }

  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "The collage is too large to share" });
  }

  let upload: ParsedUpload;
  try {
    upload = await readPublishedCollageUpload(request);
  } catch (error) {
    if (error instanceof PublishedCollageError) {
      return jsonResponse(400, {
        error: `Cannot share this collage: ${error.message}`,
      });
    }
    throw error;
  }

  const id = createPublishedCollageId();
  const deleteToken = createDeleteToken();
  const sharedAt = Date.now();
  const stored: PublishedCollage = { ...upload.collage, sharedAt };
  try {
    // The pictures land first, so a collage that can be read can always be drawn.
    await Promise.all(
      upload.images.map((image) =>
        env.SHARED_COLLAGES.put(imageKey(id, image.ref), image.bytes, {
          httpMetadata: { contentType: image.type },
        }),
      ),
    );
    if (upload.cover) {
      await env.SHARED_COLLAGES.put(coverKey(id), upload.cover.bytes, {
        httpMetadata: { contentType: upload.cover.type },
      });
    }
    await env.SHARED_COLLAGES.put(collageKey(id), JSON.stringify(stored), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        deleteTokenHash: await hashDeleteToken(deleteToken),
        ...(upload.cover ? { cover: "1" } : {}),
      },
    });
  } catch (error) {
    console.error("[published collages] store failed:", error);
    await removeCollage(env, id).catch(() => {});
    return jsonResponse(503, { error: "The collage could not be stored" });
  }

  const created: PublishedCollageCreated = {
    id,
    deleteToken,
    url: publishedCollageViewerUrl(id, env.COLLAGE_VIEWER_ORIGIN),
  };
  return jsonResponse(201, created);
}

async function handleRead(env: Env, id: string): Promise<Response> {
  const object = await env.SHARED_COLLAGES.get(collageKey(id));
  if (!object)
    return jsonResponse(404, {
      error: "This collage is not shared (any more)",
    });
  return new Response(object.body, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      // Asked for afresh every time, so a link that was taken down stops
      // showing at once rather than lingering in a browser cache.
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      // Read by the viewer page's link-preview tags, which point at the cover.
      ...(object.customMetadata?.cover === "1"
        ? { "X-Collage-Cover": "1" }
        : {}),
    },
  });
}

async function handleImage(
  request: Request,
  env: Env,
  id: string,
  ref: string,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  if (publishedImageIndex(ref) === null)
    return jsonResponse(404, { error: "Not found" });
  return servePicture(request, env, imageKey(id, ref), ctx);
}

/**
 * How long the edge keeps a picture. Browsers keep it for good, but a share
 * that is taken down should stop being served from the edge within a day.
 */
const EDGE_CACHE_SECONDS = 24 * 60 * 60;

/** The edge cache, which only does anything on a custom domain (not workers.dev). */
function edgeCache(): Cache | null {
  if (typeof caches === "undefined") return null;
  // Workers' CacheStorage has a `default` cache the DOM typings do not know.
  return (caches as unknown as { default?: Cache }).default ?? null;
}

async function servePicture(
  request: Request,
  env: Env,
  key: string,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  const cache = typeof ctx?.waitUntil === "function" ? edgeCache() : null;
  const cacheKey = new Request(new URL(request.url).toString(), {
    method: "GET",
  });
  const cached = await cache?.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(cached.body, { status: cached.status, headers });
  }
  const object = await env.SHARED_COLLAGES.get(key);
  if (!object) return jsonResponse(404, { error: "Not found" });
  const headers = {
    ...CORS_HEADERS,
    "Content-Type":
      object.httpMetadata?.contentType ?? "application/octet-stream",
    // A picture under a share never changes; a new share gets a new id.
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (!cache) return new Response(object.body, { headers });
  const [served, kept] = object.body.tee();
  const stored = new Response(kept, {
    headers: {
      ...headers,
      "Cache-Control": `public, max-age=${EDGE_CACHE_SECONDS}`,
    },
  });
  ctx?.waitUntil(
    cache.put(cacheKey, stored).catch((error: unknown) => {
      console.warn("[collages] could not keep a picture at the edge:", error);
    }),
  );
  return new Response(served, { headers });
}

async function handleDelete(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token) return jsonResponse(401, { error: "A delete token is required" });

  const head = await env.SHARED_COLLAGES.head(collageKey(id));
  if (!head)
    return jsonResponse(404, {
      error: "This collage is not shared (any more)",
    });
  const expected = head.customMetadata?.deleteTokenHash ?? "";
  if (!expected || !sameHash(await hashDeleteToken(token), expected)) {
    return jsonResponse(403, {
      error: "That delete token does not match this collage",
    });
  }
  await removeCollage(env, id);
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Removes the collage first, so the link goes dark before its pictures go. */
async function removeCollage(env: Env, id: string): Promise<void> {
  await env.SHARED_COLLAGES.delete(collageKey(id));
  let cursor: string | undefined;
  do {
    const listing = await env.SHARED_COLLAGES.list({
      prefix: collagePrefix(id),
      cursor,
    });
    const keys = listing.objects.map((object) => object.key);
    if (keys.length > 0) await env.SHARED_COLLAGES.delete(keys);
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}
