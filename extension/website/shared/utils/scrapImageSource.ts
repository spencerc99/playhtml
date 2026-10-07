// ABOUTME: Resolves the source a scrap image is displayed from: a local copy when one is held, else its URL.
// ABOUTME: Surfaces without local copies register nothing and show the URL unchanged.

import { useEffect, useState } from "react";

/**
 * Looks up local copies for a batch of image URLs, answering with a display
 * URL (such as a blob URL) for each one that has a copy.
 */
export type LocalImageLookup = (
  srcs: readonly string[],
) => Promise<Map<string, string>>;

let lookup: LocalImageLookup | null = null;
const resolved = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let batch: { srcs: Set<string>; run: Promise<Map<string, string>> } | null =
  null;

/** Lets a surface that holds local copies serve them in place of image URLs. */
export function provideLocalScrapImages(next: LocalImageLookup): void {
  lookup = next;
  resolved.clear();
  pending.clear();
}

/** Drops a remembered answer, so the next lookup sees a copy stored since. */
export function forgetScrapImageSrc(src: string): void {
  resolved.delete(src);
  pending.delete(src);
}

/** Gathers lookups made in the same tick into one read. */
function lookUp(src: string, from: LocalImageLookup): Promise<Map<string, string>> {
  if (!batch) {
    const srcs = new Set<string>();
    const run = Promise.resolve().then(() => {
      batch = null;
      return from([...srcs]);
    });
    batch = { srcs, run };
  }
  batch.srcs.add(src);
  return batch.run;
}

/**
 * The source to display a scrap image from. A lookup that fails falls back to
 * the URL, since the copy is only ever a stand-in for it; the failure is logged.
 */
export function resolveScrapImageSrc(src: string): Promise<string> {
  const from = lookup;
  if (!from || !src) return Promise.resolve(src);
  const known = resolved.get(src);
  if (known !== undefined) return Promise.resolve(known);
  const inFlight = pending.get(src);
  if (inFlight) return inFlight;
  const answer = lookUp(src, from)
    .then((found) => found.get(src) ?? src)
    .catch((error: unknown) => {
      console.warn("[scrap images] local copy lookup failed:", error);
      return src;
    })
    .then((display) => {
      if (pending.get(src) === answer) {
        pending.delete(src);
        resolved.set(src, display);
      }
      return display;
    });
  pending.set(src, answer);
  return answer;
}

/**
 * The display source for a scrap image, or `null` while a surface with local
 * copies is still looking one up, so a dead URL is never shown first.
 */
export function useScrapImageSrc(src: string | undefined): string | null {
  const immediate = (): string | null => {
    if (src === undefined) return null;
    if (!lookup || !src) return src;
    return resolved.get(src) ?? null;
  };
  const [state, setState] = useState<{ for: string | undefined; display: string | null }>(
    () => ({ for: src, display: immediate() }),
  );
  const display = state.for === src ? state.display : immediate();

  useEffect(() => {
    if (src === undefined || display !== null) return;
    let cancelled = false;
    void resolveScrapImageSrc(src).then((next) => {
      if (!cancelled) setState({ for: src, display: next });
    });
    return () => {
      cancelled = true;
    };
  }, [src, display]);

  return display;
}
