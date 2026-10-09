// ABOUTME: Serves internet map bundles from a private R2 bucket to the admin only.
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
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
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
    },
  });
}
