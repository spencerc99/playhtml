// ABOUTME: POST /events/restore — returns one page of a participant's own events, newest first.
// ABOUTME: The request must be signed with the participant's identity key, whose public half is the pid.

import { createSupabaseClient, type Env } from '../lib/supabase';
import { createIpRateLimiter } from '../lib/ipRateLimit';
import { toCollectionEvents } from './recent';
import {
  ECDSA_SIGN_ALGORITHM,
  RESTORE_PAGE_SIZE,
  RESTORE_SIGNATURE_MAX_AGE_MS,
  hexToBytes,
  restoreSigningMessage,
  type RestorePageRequest,
  type RestorePageResponse,
} from '../../../src/utils/restoreRequest';

/** Uncompressed P-256 public key: 0x04 prefix, then 64 bytes of x and y. */
const PUBLIC_KEY_PID_PATTERN = /^pk_04[0-9a-f]{128}$/;
const RESTORE_TYPES = new Set(['cursor', 'navigation', 'viewport', 'keyboard', 'element']);

// A full restore of a heavy participant is about a thousand pages.
const rateLimiter = createIpRateLimiter(600, 60_000);

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function parseRestorePageRequest(body: unknown): RestorePageRequest | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  const { pid, type, before, signedAt, signature } = value;
  if (typeof pid !== 'string' || !PUBLIC_KEY_PID_PATTERN.test(pid)) return null;
  if (typeof type !== 'string' || !RESTORE_TYPES.has(type)) return null;
  if (typeof signedAt !== 'number' || !Number.isFinite(signedAt)) return null;
  if (typeof signature !== 'string' || !/^[0-9a-f]{128}$/.test(signature)) return null;
  if (before !== null) {
    if (!before || typeof before !== 'object') return null;
    const cursor = before as Record<string, unknown>;
    if (typeof cursor.ts !== 'string' || Number.isNaN(Date.parse(cursor.ts))) return null;
    if (typeof cursor.id !== 'string' || cursor.id.length === 0 || cursor.id.length > 200) {
      return null;
    }
  }
  return value as unknown as RestorePageRequest;
}

export async function verifyRestoreSignature(
  request: RestorePageRequest,
  now: number,
): Promise<boolean> {
  if (Math.abs(now - request.signedAt) > RESTORE_SIGNATURE_MAX_AGE_MS) return false;
  const publicKey = await crypto.subtle.importKey(
    'raw',
    hexToBytes(request.pid.slice('pk_'.length)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    ECDSA_SIGN_ALGORITHM,
    publicKey,
    hexToBytes(request.signature),
    new TextEncoder().encode(restoreSigningMessage(request)),
  );
}

export async function handleRestore(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (rateLimiter.isLimited(ip, Date.now())) {
    return jsonResponse({ error: 'Too many requests' }, 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  const restoreRequest = parseRestorePageRequest(body);
  if (!restoreRequest) return jsonResponse({ error: 'Invalid restore request' }, 400);

  let verified = false;
  try {
    verified = await verifyRestoreSignature(restoreRequest, Date.now());
  } catch (error) {
    console.error('Restore signature check failed:', error);
  }
  if (!verified) return jsonResponse({ error: 'Invalid signature' }, 401);

  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase.rpc('participant_events_page', {
    p_participant_id: restoreRequest.pid,
    p_type: restoreRequest.type,
    p_before_ts: restoreRequest.before?.ts ?? 'infinity',
    p_before_id: restoreRequest.before?.id ?? '',
    p_limit: RESTORE_PAGE_SIZE,
  });
  if (error) {
    console.error('Restore query error:', error);
    return jsonResponse({ error: 'Failed to fetch events', details: error.message }, 500);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const last = rows.at(-1);
  const response: RestorePageResponse = {
    events: await toCollectionEvents(supabase, rows),
    nextCursor:
      rows.length === RESTORE_PAGE_SIZE && last
        ? { ts: last.ts as string, id: last.id as string }
        : null,
  };
  return jsonResponse(response, 200);
}
