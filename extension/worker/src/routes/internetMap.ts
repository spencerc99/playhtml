// ABOUTME: Serves internet map bundles from a private R2 bucket to the admin or a share-link key.
// ABOUTME: Bundles carry participants' full page URLs and titles, so they never ship as public files.

import { getAdminAuthError } from '../lib/adminAuth';
import type { Env } from '../lib/supabase';

const BUNDLE_FILES: Record<string, string> = {
  'map.json': 'application/json',
  'map.bin': 'application/octet-stream',
  // Served as opaque bytes; the viewer sniffs the gzip magic and inflates it.
  'labels.json.gz': 'application/octet-stream',
};

const BUNDLE_NAME = /^[A-Za-z0-9._-]{1,64}$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
};

/**
 * The admin key always works. INTERNET_MAP_SHARE_KEY, when set, is a second
 * key that only opens map bundles, so it can go out in a link
 * (wewere.online/internet-map/?k=...) without exposing the admin routes.
 * Rotate the secret to cut off every shared link at once.
 */
function getMapAuthError(request: Request, env: Env): Response | null {
  const shareKey = env.INTERNET_MAP_SHARE_KEY;
  if (shareKey && request.headers.get('Authorization') === `Bearer ${shareKey}`) return null;
  return getAdminAuthError(request, env.ADMIN_KEY);
}

/** Parses `/internet-map/<bundle>/<file>` into an R2 key, or null when it isn't one. */
export function internetMapObjectKey(path: string): string | null {
  const match = path.match(/^\/internet-map\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const [, bundle, file] = match;
  if (!BUNDLE_NAME.test(bundle) || bundle.startsWith('.')) return null;
  if (!(file in BUNDLE_FILES)) return null;
  return `${bundle}/${file}`;
}

export async function handleInternetMapFile(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const authError = getMapAuthError(request, env);
  if (authError) return authError;

  const key = internetMapObjectKey(path);
  if (!key) {
    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  }

  const object = await env.INTERNET_MAP_BUNDLES.get(key);
  if (!object) {
    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  }

  const file = key.slice(key.indexOf('/') + 1);
  return new Response(object.body, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': BUNDLE_FILES[file],
      // Private data: browsers and shared caches must not keep a copy.
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
