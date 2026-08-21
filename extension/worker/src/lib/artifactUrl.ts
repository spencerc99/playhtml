// ABOUTME: Normalizes a URL to a stable quarantine-verdict key.
// ABOUTME: Keeps the query string (an image src's identity often lives there); only the hash is dropped.

/**
 * Normalize a URL to a stable verdict key. Unlike the extension's page-URL
 * normalization, this KEEPS the query string — for an image `src` the query
 * often carries the image's identity (?w=800&sig=…). Only the hash is dropped.
 * Getting this right is migration-critical: collapsing distinct URLs onto one
 * key is irreversible.
 */
export function normalizeArtifactUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.protocol = 'https:';
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    let out = u.toString();
    // strip a trailing slash on the path (but keep it for a bare origin)
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}
