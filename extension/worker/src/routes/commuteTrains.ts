// ABOUTME: Validates public train boarding requests and forwards them to the dispatcher.
// ABOUTME: Exposes assignment responses to allowed WWO website and development origins.

import { getDomain } from 'tldts';
import type { CommuteTrainBoardRequest } from '@playhtml/extension-types';
import type { Env } from '../lib/supabase';

const RIDER_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;
const DISPATCHER_NAME = 'internet-commute-v1';
const RATE_LIMIT_RETRY_SECONDS = 60;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function parseDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized || normalized !== value) return null;
  return getDomain(normalized, { allowPrivateDomains: true }) === normalized
    ? normalized
    : null;
}

export function parseCommuteTrainBoardRequest(
  value: unknown,
): CommuteTrainBoardRequest | null {
  const body = record(value);
  if (!body || typeof body.riderToken !== 'string') return null;
  if (!RIDER_TOKEN_PATTERN.test(body.riderToken)) return null;

  const requestedStop = record(body.requestedStop);
  if (!requestedStop || typeof requestedStop.kind !== 'string') return null;
  if (requestedStop.kind === 'none') {
    return { riderToken: body.riderToken, requestedStop: { kind: 'none' } };
  }
  if (requestedStop.kind === 'domain') {
    const domain = parseDomain(requestedStop.domain);
    if (!domain) return null;
    return {
      riderToken: body.riderToken,
      requestedStop: { kind: 'domain', domain },
    };
  }
  return null;
}

export async function handleCommuteTrainBoard(
  request: Request,
  env: Env,
): Promise<Response> {
  let rateLimitAllowed: boolean;
  try {
    const rateLimit = await env.COMMUTE_BOARD_RATE_LIMITER.limit({
      key: request.headers.get('CF-Connecting-IP') ?? 'unidentified-client',
    });
    rateLimitAllowed = rateLimit.success;
  } catch (error) {
    console.error('[commute trains] rate limiter unavailable:', error);
    return jsonResponse(503, { error: 'Boarding is temporarily unavailable' });
  }
  if (!rateLimitAllowed) {
    return jsonResponse(
      429,
      { error: 'Too many boarding requests' },
      { 'Retry-After': String(RATE_LIMIT_RETRY_SECONDS) },
    );
  }

  let parsed: CommuteTrainBoardRequest | null;
  try {
    parsed = parseCommuteTrainBoardRequest(await request.json());
  } catch {
    parsed = null;
  }
  if (!parsed) return jsonResponse(400, { error: 'Invalid boarding request' });

  const id = env.COMMUTE_TRAIN_DISPATCHER.idFromName(DISPATCHER_NAME);
  const response = await env.COMMUTE_TRAIN_DISPATCHER.get(id).fetch(
    new Request('https://dispatcher.internal/board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    }),
  );
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...headers,
    },
  });
}
