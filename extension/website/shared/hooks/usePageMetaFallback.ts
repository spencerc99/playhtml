// ABOUTME: Resolves page title + favicon from the worker /page-meta endpoint.
// ABOUTME: Module-scoped cache dedupes concurrent lookups across all callers.

import { useEffect, useState } from "react";
import { PAGE_META_URL } from "../config";

export interface PageMeta {
  title?: string;
  favicon?: string;
}

// Process-wide cache. Survives across hook instances so a viewport that fades
// out and a new one for the same URL doesn't re-fetch. Pending fetches share
// the same promise to dedupe concurrent callers.
const resolved = new Map<string, PageMeta>();
const inFlight = new Map<string, Promise<PageMeta | null>>();

async function fetchOne(url: string): Promise<PageMeta | null> {
  const existing = inFlight.get(url);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const resp = await fetch(`${PAGE_META_URL}?url=${encodeURIComponent(url)}`);
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        title?: string;
        favicon?: string;
        source?: string;
      };
      if (!data || (!data.title && !data.favicon)) return null;
      const meta: PageMeta = { title: data.title, favicon: data.favicon };
      resolved.set(url, meta);
      return meta;
    } catch {
      return null;
    } finally {
      inFlight.delete(url);
    }
  })();
  inFlight.set(url, promise);
  return promise;
}

/**
 * For each URL in `urls` that has no entry in `existingMetadata` and isn't
 * already resolved/in-flight, kick off a /page-meta lookup. Returns a Map
 * that's a *superset* of `existingMetadata` — original entries always win,
 * fetched entries fill gaps. Re-renders the consumer whenever a new URL
 * resolves.
 *
 * The hook deliberately doesn't manage a per-instance map — the
 * module-scoped cache is shared, and the returned Map is constructed fresh
 * each render from (existing + cache) so React notices new entries.
 */
export function usePageMetaFallback(
  urls: string[],
  existingMetadata?: Map<string, { title?: string; favicon?: string }>,
): Map<string, PageMeta> {
  // Track only a tick counter so we can force re-renders when a fetch lands.
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const toFetch = new Set<string>();
    for (const url of urls) {
      if (!url) continue;
      const existing = existingMetadata?.get(url);
      if (existing?.title) continue; // already have something usable
      if (resolved.has(url)) continue;
      if (inFlight.has(url)) continue;
      toFetch.add(url);
    }
    if (toFetch.size === 0) return;
    Promise.all(
      [...toFetch].map((u) =>
        fetchOne(u).then((meta) => {
          if (cancelled || !meta) return;
          setTick((t) => t + 1);
        }),
      ),
    );
    return () => {
      cancelled = true;
    };
    // We intentionally depend on a stable string of the URL set, not the
    // array identity — callers often pass a fresh array each render.
  }, [urls.join("\n"), existingMetadata]);

  // Merge existing + cache fresh each render so changes propagate.
  const out = new Map<string, PageMeta>();
  if (existingMetadata) {
    for (const [k, v] of existingMetadata) {
      if (v.title || v.favicon) out.set(k, { title: v.title, favicon: v.favicon });
    }
  }
  for (const url of urls) {
    if (!url) continue;
    if (out.get(url)?.title) continue;
    const cached = resolved.get(url);
    if (cached) {
      const prev = out.get(url);
      out.set(url, {
        title: prev?.title || cached.title,
        favicon: prev?.favicon || cached.favicon,
      });
    }
  }
  return out;
}
