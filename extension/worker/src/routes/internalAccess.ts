// ABOUTME: Reads and administers the WWO extension beta-access allowlist.
// ABOUTME: Exposes exact-ID checks publicly while protecting list mutations.

import { getAdminAuthError } from '../lib/adminAuth';
import type { Env } from '../lib/supabase';

const ACCESS_KEY_PREFIX = 'internal-access:';
const PUBLIC_ID_PATTERN = /^pk_[0-9a-f]{130}$/i;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

interface AccessMetadata {
  addedAt: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function isValidPublicId(publicId: string): boolean {
  return PUBLIC_ID_PATTERN.test(publicId);
}

function accessKey(publicId: string): string {
  return `${ACCESS_KEY_PREFIX}${publicId}`;
}

export async function handleInternalAccessCheck(
  env: Env,
  publicId: string,
): Promise<Response> {
  if (!isValidPublicId(publicId)) {
    return jsonResponse(400, { error: 'Invalid public ID' });
  }

  const value = await env.WWO_INTERNAL_ACCESS.get(accessKey(publicId));
  return jsonResponse(200, { enabled: value !== null });
}

export async function handleAdminInternalAccessList(
  request: Request,
  env: Env,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;

  const entries: Array<{ publicId: string; addedAt: string }> = [];
  let cursor: string | undefined;

  do {
    const page = await env.WWO_INTERNAL_ACCESS.list<AccessMetadata>({
      prefix: ACCESS_KEY_PREFIX,
      ...(cursor ? { cursor } : {}),
    });

    for (const key of page.keys) {
      if (typeof key.metadata?.addedAt !== 'string') {
        return jsonResponse(500, { error: 'Allowlist metadata is malformed' });
      }
      entries.push({
        publicId: key.name.slice(ACCESS_KEY_PREFIX.length),
        addedAt: key.metadata.addedAt,
      });
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  entries.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  return jsonResponse(200, { entries });
}

export async function handleAdminInternalAccessAdd(
  request: Request,
  env: Env,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const publicId = (body as Record<string, unknown>).publicId;
  if (typeof publicId !== 'string' || !isValidPublicId(publicId)) {
    return jsonResponse(400, { error: 'Invalid public ID' });
  }

  const addedAt = new Date().toISOString();
  await env.WWO_INTERNAL_ACCESS.put(accessKey(publicId), '1', {
    metadata: { addedAt } satisfies AccessMetadata,
  });

  return jsonResponse(201, { publicId, addedAt });
}

export async function handleAdminInternalAccessRemove(
  request: Request,
  env: Env,
  publicId: string,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;
  if (!isValidPublicId(publicId)) {
    return jsonResponse(400, { error: 'Invalid public ID' });
  }

  await env.WWO_INTERNAL_ACCESS.delete(accessKey(publicId));
  return jsonResponse(200, { ok: true });
}
