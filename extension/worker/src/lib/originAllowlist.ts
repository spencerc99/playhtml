// ABOUTME: Origin/Referer allowlist guard for public read endpoints.
// ABOUTME: Stops casual cross-origin scraping of the events API; not a hard auth boundary.

/** Exact-match production origins. */
const ALLOWED_ORIGINS = new Set([
  'https://wewere.online',
  'https://www.wewere.online',
]);

/** Dev origins matched by host (any port). */
const DEV_HOSTS = new Set(['localhost', '127.0.0.1']);

function originIsAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return DEV_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * True when the request comes from one of our own origins.
 * Checks `Origin` first, then `Referer` (navigations and some fetches omit Origin).
 *
 * NOTE: Both headers are client-controllable, so this is a casual-scraping
 * deterrent, not a security boundary.
 */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin) return originIsAllowed(origin);

  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      const url = new URL(referer);
      return originIsAllowed(url.origin);
    } catch {
      return false;
    }
  }

  return false;
}

/** 403 response for disallowed origins. */
export function forbiddenResponse(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
