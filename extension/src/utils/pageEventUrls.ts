// ABOUTME: The stored URL forms of one page, and the md5 hashes of them that a page lookup sends.
// ABOUTME: Shared by the extension (hashes the forms) and the Worker (validates the hashes for the page index).

/** Longest page URL the Worker accepts for a page lookup. */
export const MAX_PAGE_EVENT_URL_LENGTH = 2048;

/** Most stored URL forms one page lookup reads; the SQL function caps its input at this. */
export const MAX_PAGE_EVENT_URLS = 4;

/** md5 of a stored URL's UTF-8 bytes, as Postgres md5(url) returns it. */
const URL_HASH_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Parses the `urlHash` query parameter of GET /events/recent: 1 to
 * MAX_PAGE_EVENT_URLS comma-separated md5 hex digests. Returns null for
 * anything else.
 */
export function parseUrlHashes(value: string): string[] | null {
  const hashes = value.split(",");
  if (hashes.length < 1 || hashes.length > MAX_PAGE_EVENT_URLS) return null;
  if (!hashes.every((hash) => URL_HASH_PATTERN.test(hash))) return null;
  return [...new Set(hashes)];
}

/** The `urlHash` query parameter value for a page's hashes. */
export function formatUrlHashes(hashes: string[]): string {
  return hashes.join(",");
}

/**
 * Uploaded events store `meta.url` as `new URL(location.href).toString()` with
 * the fragment removed. A page lookup matches the md5 of stored URLs, so this
 * lists the forms one page commonly appears under: the URL as given, without
 * its query string, and each of those with the trailing slash toggled.
 *
 * Forms it cannot list and so never matches: other query strings for the same
 * path (`/wiki/Cat?oldid=123` when viewing `/wiki/Cat`), different path
 * casing or protocol, and events uploaded before fragments were stripped
 * (`/wiki/Cat#History`). Throws for anything but an http(s) URL.
 */
export function pageEventUrlVariants(pageUrl: string): string[] {
  if (pageUrl.length > MAX_PAGE_EVENT_URL_LENGTH) {
    throw new Error("Page URL is too long");
  }
  const parsed = new URL(pageUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Page URL must be http or https");
  }
  parsed.hash = "";

  const paths = [parsed.pathname];
  if (parsed.pathname !== "/") {
    paths.push(
      parsed.pathname.endsWith("/")
        ? parsed.pathname.slice(0, -1)
        : `${parsed.pathname}/`,
    );
  }

  const variants = new Set<string>([parsed.toString()]);
  for (const withQuery of [true, false]) {
    for (const path of paths) {
      const variant = new URL(parsed.toString());
      variant.pathname = path;
      if (!withQuery) variant.search = "";
      variants.add(variant.toString());
    }
  }
  return [...variants].slice(0, MAX_PAGE_EVENT_URLS);
}
