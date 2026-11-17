// ABOUTME: The signed request contract for reading shared events from the Worker without an allowed Origin.
// ABOUTME: Shared by the extension (signs with its identity key) and the Worker (verifies it).

import { ECDSA_SIGN_ALGORITHM, bytesToHex } from "./restoreRequest";

/** How far a request's signing time may drift from the Worker's clock. */
export const RECENT_EVENTS_SIGNATURE_MAX_AGE_MS = 5 * 60_000;

/** A GET carries its proof in headers, since it has no body. */
export const PUBLIC_ID_HEADER = "X-WWO-Public-Id";
export const SIGNED_AT_HEADER = "X-WWO-Signed-At";
export const SIGNATURE_HEADER = "X-WWO-Signature";

export interface RecentEventsRequest {
  /** The signer's participant id: "pk_" + its raw P-256 public key. */
  publicId: string;
  signedAt: number;
  /** Hex ECDSA P-256 / SHA-256 signature (IEEE P1363 r||s) over recentEventsSigningMessage. */
  signature: string;
}

export function recentEventsSigningMessage(
  request: Omit<RecentEventsRequest, "signature">,
): string {
  return [
    "wwo-recent-events-v1",
    request.publicId,
    String(request.signedAt),
  ].join("\n");
}

export async function signRecentEventsRequest(
  privateKey: JsonWebKey,
  unsigned: Omit<RecentEventsRequest, "signature">,
): Promise<RecentEventsRequest> {
  const key = await crypto.subtle.importKey(
    "jwk",
    privateKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    ECDSA_SIGN_ALGORITHM,
    key,
    new TextEncoder().encode(recentEventsSigningMessage(unsigned)),
  );
  return { ...unsigned, signature: bytesToHex(new Uint8Array(signature)) };
}

/** The headers a signed read sends. */
export function recentEventsHeaders(
  request: RecentEventsRequest,
): Record<string, string> {
  return {
    [PUBLIC_ID_HEADER]: request.publicId,
    [SIGNED_AT_HEADER]: String(request.signedAt),
    [SIGNATURE_HEADER]: request.signature,
  };
}
