// ABOUTME: URL normalization utilities for consistent matching
// ABOUTME: Strips query parameters and hash fragments, normalizes protocol and case

/**
 * Normalize URL to base path for consistent matching
 *
 * Transformations:
 * - Always use https protocol
 * - Remove query parameters
 * - Remove hash fragments
 * - Lowercase pathname
 * - Strip trailing slash (except root)
 *
 * Examples:
 *   http://example.com/Page?q=1#hash -> https://example.com/page
 *   https://example.com/page/ -> https://example.com/page
 *   https://example.com/ -> https://example.com/
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Normalize to https and lowercase pathname
    const pathname = urlObj.pathname.toLowerCase();
    let normalized = `https://${urlObj.host}${pathname}`;

    // Strip trailing slash except for root path
    if (normalized.endsWith('/') && normalized !== `https://${urlObj.host}/`) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  } catch {
    // If URL parsing fails, return lowercase original
    return url.toLowerCase();
  }
}

/**
 * Extract domain from URL, removing www prefix
 *
 * Examples:
 *   https://www.example.com/page -> example.com
 *   http://github.com/user/repo -> github.com
 */
export function extractDomain(url: string | null): string {
  if (!url) return '';
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Determine if URL is a root path (should show domain-wide data)
 *
 * Root paths: /, /index.html, /index.htm, etc.
 */
export function isRootPath(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();

    return (
      pathname === '/' ||
      pathname === '' ||
      pathname === '/index.html' ||
      pathname === '/index.htm' ||
      pathname === '/index.php' ||
      pathname === '/home' ||
      pathname === '/home.html'
    );
  } catch {
    return false;
  }
}

/**
 * Determine filter scope based on current URL
 *
 * Logic:
 * - Root paths (/, /index.html) -> domain-wide
 * - Nested paths (/wiki/Page) -> URL-specific
 */
export function determineFilterScope(currentUrl: string): {
  mode: 'domain' | 'url';
  filter: string;
  displayPath: string;
} {
  try {
    const urlObj = new URL(currentUrl);
    const domain = extractDomain(currentUrl);

    if (isRootPath(currentUrl)) {
      return {
        mode: 'domain',
        filter: domain,
        displayPath: domain,
      };
    } else {
      const normalizedUrl = normalizeUrl(currentUrl);
      return {
        mode: 'url',
        filter: normalizedUrl,
        displayPath: urlObj.pathname,
      };
    }
  } catch {
    const domain = extractDomain(currentUrl);
    return {
      mode: 'domain',
      filter: domain,
      displayPath: domain,
    };
  }
}
