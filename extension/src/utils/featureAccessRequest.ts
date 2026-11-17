// ABOUTME: The signed request contract for reading a participant's feature access from the Worker.
// ABOUTME: Shared by the extension (signs with its identity key) and the Worker (verifies it).

import { ECDSA_SIGN_ALGORITHM, bytesToHex } from "./restoreRequest";

/** How far a request's signing time may drift from the Worker's clock. */
export const FEATURE_ACCESS_SIGNATURE_MAX_AGE_MS = 5 * 60_000;

/** GET /feature-access/:id carries its proof in headers, since a GET has no body. */
export const FEATURE_ACCESS_SIGNED_AT_HEADER = "X-WWO-Signed-At";
export const FEATURE_ACCESS_SIGNATURE_HEADER = "X-WWO-Signature";

export interface FeatureAccessRequest {
  publicId: string;
  signedAt: number;
  /** Hex ECDSA P-256 / SHA-256 signature (IEEE P1363 r||s) over featureAccessSigningMessage. */
  signature: string;
}

export function featureAccessSigningMessage(
  request: Omit<FeatureAccessRequest, "signature">,
): string {
  return [
    "wwo-feature-access-v1",
    request.publicId,
    String(request.signedAt),
  ].join("\n");
}

export async function signFeatureAccessRequest(
  privateKey: JsonWebKey,
  unsigned: Omit<FeatureAccessRequest, "signature">,
): Promise<FeatureAccessRequest> {
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
    new TextEncoder().encode(featureAccessSigningMessage(unsigned)),
  );
  return { ...unsigned, signature: bytesToHex(new Uint8Array(signature)) };
}

/** The headers a signed GET /feature-access/:id sends. */
export function featureAccessHeaders(
  request: FeatureAccessRequest,
): Record<string, string> {
  return {
    [FEATURE_ACCESS_SIGNED_AT_HEADER]: String(request.signedAt),
    [FEATURE_ACCESS_SIGNATURE_HEADER]: request.signature,
  };
}
