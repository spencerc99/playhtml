// ABOUTME: Fetches + caches Wikipedia article summaries for chat hovercards.
// ABOUTME: Wraps the same REST endpoint Wikipedia's own Page Previews use.

export interface WikiSummary {
  title: string;
  description?: string;
  extract: string;
  thumbnail?: { source: string; width: number; height: number };
  url: string;
}

const SUMMARY_BASE = "https://en.wikipedia.org/api/rest_v1/page/summary/";

// Cache per title for the lifetime of the page. Stores resolved summaries and
// in-flight promises so concurrent hovers dedupe to a single request, and
// `null` for titles known to have no usable summary (404, etc.).
const cache = new Map<string, WikiSummary | null>();
const inflight = new Map<string, Promise<WikiSummary | null>>();

export function titleToPath(title: string): string {
  return encodeURIComponent(title.replace(/ /g, "_"));
}

export function wikipediaUrlForTitle(title: string): string {
  return `https://en.wikipedia.org/wiki/${titleToPath(title)}`;
}

export function getCachedSummary(title: string): WikiSummary | null | undefined {
  return cache.get(title);
}

export async function fetchWikiSummary(title: string): Promise<WikiSummary | null> {
  if (cache.has(title)) return cache.get(title) ?? null;
  const existing = inflight.get(title);
  if (existing) return existing;

  const promise = (async (): Promise<WikiSummary | null> => {
    try {
      const res = await fetch(`${SUMMARY_BASE}${titleToPath(title)}`);
      if (!res.ok) {
        cache.set(title, null);
        return null;
      }
      const data = (await res.json()) as Record<string, any>;
      if (typeof data.extract !== "string" || data.extract.length === 0) {
        cache.set(title, null);
        return null;
      }
      const summary: WikiSummary = {
        title: typeof data.title === "string" ? data.title : title,
        description: typeof data.description === "string" ? data.description : undefined,
        extract: data.extract,
        thumbnail:
          data.thumbnail && typeof data.thumbnail.source === "string"
            ? {
                source: data.thumbnail.source,
                width: Number(data.thumbnail.width) || 0,
                height: Number(data.thumbnail.height) || 0,
              }
            : undefined,
        url:
          data.content_urls?.desktop?.page ??
          wikipediaUrlForTitle(title),
      };
      cache.set(title, summary);
      return summary;
    } catch {
      cache.set(title, null);
      return null;
    } finally {
      inflight.delete(title);
    }
  })();

  inflight.set(title, promise);
  return promise;
}

// Test seam — reset module cache between tests.
export function _clearSummaryCacheForTest(): void {
  cache.clear();
  inflight.clear();
}
