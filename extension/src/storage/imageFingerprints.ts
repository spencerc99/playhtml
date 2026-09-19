// ABOUTME: Computes exact image fingerprints with bounded downloads and concurrency.
// ABOUTME: Adds local metadata to accepted scraps without storing image files or deleting encounters.

import type { CollectionEvent, ImageScrapData } from "../collectors/types";
import { isImageContentHash } from "@movement/utils/scrapIdentity";
import type { LocalEventStore } from "./LocalEventStore";

export const MAX_FINGERPRINT_BYTES = 5 * 1024 * 1024;
const MAX_PENDING_IMAGES = 32;
const DOWNLOAD_TIMEOUT_MS = 10_000;

export async function fetchImageFingerprint(
  src: string,
): Promise<string | undefined> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const timer = setTimeout(() => {
    controller.abort();
    // Aborting the fetch may not settle a pending body read after collection.
    void reader?.cancel().catch(() => {});
  }, DOWNLOAD_TIMEOUT_MS);
  try {
    const url = new URL(src);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    const response = await fetch(url, {
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      redirect: "error",
      signal: controller.signal,
    });
    if (
      !response.ok ||
      !response.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("image/") ||
      !response.body
    )
      return;
    const declaredSize = Number(response.headers.get("content-length"));
    if (declaredSize > MAX_FINGERPRINT_BYTES) return;
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FINGERPRINT_BYTES) return;
      chunks.push(value);
    }
    if (controller.signal.aborted || size === 0) return;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    // Unavailable, redirected, or oversized images keep their URL-based identity.
    return undefined;
  } finally {
    clearTimeout(timer);
    void reader?.cancel().catch(() => {});
    controller.abort();
  }
}

export class ImageFingerprints {
  private active = 0;
  private waiting: Array<() => void> = [];
  private pending = new Map<string, Promise<string | undefined>>();

  constructor(private store: LocalEventStore) {}

  private fingerprint(src: string): Promise<string | undefined> {
    const pending = this.pending.get(src);
    if (pending) return pending;
    if (this.pending.size >= MAX_PENDING_IMAGES)
      return Promise.resolve(undefined);
    const result = new Promise<string | undefined>((resolve) => {
      const run = () => {
        this.active++;
        void fetchImageFingerprint(src).then((hash) => {
          this.pending.delete(src);
          this.active--;
          this.waiting.shift()?.();
          resolve(hash);
        });
      };
      if (this.active < 2) run();
      else this.waiting.push(run);
    });
    this.pending.set(src, result);
    return result;
  }

  async process(
    events: CollectionEvent[],
  ): Promise<{ checked: number; skipped: number }> {
    let checked = 0;
    let skipped = 0;
    await Promise.all(
      events.map(async (event) => {
        const data = event.data as Partial<ImageScrapData> | null;
        if (
          event.type !== "element" ||
          data?.kind !== "image" ||
          typeof data.src !== "string" ||
          isImageContentHash(data.contentHash)
        )
          return;
        const hash = await this.fingerprint(data.src);
        if (
          hash &&
          (await this.store.setImageContentHash(event.id, data.src, hash))
        )
          checked++;
        else skipped++;
      }),
    );
    return { checked, skipped };
  }
}
