// ABOUTME: Decides whether a stored scrap URL may be turned into a link.
// ABOUTME: Extension pages are privileged, so only web schemes become hrefs.

const LINKABLE_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * The href for a page a scrap came from, or null when it is not a plain web
 * address. Scrap URLs are stored data, so a `javascript:` or `data:` value
 * must never become a link on an extension page.
 */
export function webPageHref(pageUrl: string): string | null {
  if (typeof pageUrl !== "string" || pageUrl.trim().length === 0) return null;
  try {
    return LINKABLE_PROTOCOLS.has(new URL(pageUrl).protocol) ? pageUrl : null;
  } catch {
    return null;
  }
}
