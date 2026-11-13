// ABOUTME: Recognizes participant ids that are identity public keys and verifies their signatures.
// ABOUTME: Shared by every route that trusts a request only when the pid's key signed it.

import {
  ECDSA_SIGN_ALGORITHM,
  hexToBytes,
} from '../../../src/utils/restoreRequest';

/** Uncompressed P-256 public key: 0x04 prefix, then 64 bytes of x and y, lowercase hex. */
const PARTICIPANT_KEY_PATTERN = /^pk_04[0-9a-f]{128}$/;

/** Hex ECDSA P-256 signature in IEEE P1363 form (r||s, 64 bytes). */
const SIGNATURE_PATTERN = /^[0-9a-f]{128}$/;

/** True when `pid` is a participant id the extension generates: "pk_" + the raw public key. */
export function isParticipantKey(pid: unknown): pid is string {
  return typeof pid === 'string' && PARTICIPANT_KEY_PATTERN.test(pid);
}

export function isSignatureHex(signature: unknown): signature is string {
  return typeof signature === 'string' && SIGNATURE_PATTERN.test(signature);
}

/**
 * True when `signature` is the pid's key signing `message`. Callers check the
 * pid and signature formats first; a malformed key makes importKey throw.
 */
export async function verifyParticipantSignature(
  pid: string,
  signature: string,
  message: string,
): Promise<boolean> {
  const publicKey = await crypto.subtle.importKey(
    'raw',
    hexToBytes(pid.slice('pk_'.length)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    ECDSA_SIGN_ALGORITHM,
    publicKey,
    hexToBytes(signature),
    new TextEncoder().encode(message),
  );
}

/** True when the Worker rejects unsigned participant requests (REQUIRE_PARTICIPANT_SIGNATURES is "true"). */
export function requiresParticipantSignatures(env: { REQUIRE_PARTICIPANT_SIGNATURES?: string }): boolean {
  return env.REQUIRE_PARTICIPANT_SIGNATURES === 'true';
}

/** True when a request body has any signature field, so it must be verified. */
export function carriesSignature(body: Record<string, unknown>): boolean {
  return body.signature !== undefined || body.signedAt !== undefined;
}
