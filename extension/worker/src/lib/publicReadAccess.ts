// ABOUTME: Decides whether a public read of shared events (/events/recent) may be answered.
// ABOUTME: Accepts an allowed browser Origin/Referer or a fresh participant-key signature in headers.

import { isAllowedOrigin } from './originAllowlist';
import {
  isParticipantKey,
  isSignatureHex,
  verifyParticipantSignature,
} from './participantKey';
import {
  PUBLIC_ID_HEADER,
  RECENT_EVENTS_SIGNATURE_MAX_AGE_MS,
  SIGNATURE_HEADER,
  SIGNED_AT_HEADER,
  recentEventsSigningMessage,
} from '../../../src/utils/recentEventsRequest';

/** Request headers the CORS preflight allows, including the signed-read headers. */
export const PREFLIGHT_ALLOW_HEADERS = [
  'Content-Type',
  'Authorization',
  PUBLIC_ID_HEADER,
  SIGNED_AT_HEADER,
  SIGNATURE_HEADER,
].join(', ');

/**
 * How a public read was let in, or why it was not:
 * - 'origin': it came from one of our own origins (see isAllowedOrigin)
 * - 'signature': it carried a valid, fresh participant-key signature
 * - 'unauthorized': it carried signature headers that do not verify (401)
 * - 'forbidden': no allowed origin and no signature (403)
 */
export type PublicReadAccess = 'origin' | 'signature' | 'unauthorized' | 'forbidden';

type HeaderSource = { headers: { get(name: string): string | null } };

/**
 * The extension's service worker and extension pages send no Origin or
 * Referer on a GET, so they sign instead. Any valid P-256 participant key is
 * accepted: shared events are already public to the artwork pages, so like
 * the origin check this deters casual scraping rather than guarding any one
 * participant's data. An
 * allowed origin is enough on its own; the signature only adds a way in.
 */
export async function publicReadAccess(
  request: HeaderSource,
  now: number = Date.now(),
): Promise<PublicReadAccess> {
  if (isAllowedOrigin(request as Request)) return 'origin';

  const publicId = request.headers.get(PUBLIC_ID_HEADER);
  const signedAtHeader = request.headers.get(SIGNED_AT_HEADER);
  const signature = request.headers.get(SIGNATURE_HEADER);
  if (publicId === null && signedAtHeader === null && signature === null) {
    return 'forbidden';
  }

  const signedAt = Number(signedAtHeader);
  if (
    !isParticipantKey(publicId) ||
    signedAtHeader === null ||
    !/^\d+$/.test(signedAtHeader) ||
    !Number.isSafeInteger(signedAt) ||
    !isSignatureHex(signature) ||
    Math.abs(now - signedAt) > RECENT_EVENTS_SIGNATURE_MAX_AGE_MS
  ) {
    return 'unauthorized';
  }

  try {
    const verified = await verifyParticipantSignature(
      publicId,
      signature,
      recentEventsSigningMessage({ publicId, signedAt }),
    );
    return verified ? 'signature' : 'unauthorized';
  } catch {
    // A well-formed id that is not a point on the curve fails to import.
    return 'unauthorized';
  }
}

/** 401 response for signature headers that do not verify. */
export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Invalid signature' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
