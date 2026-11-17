// ABOUTME: The signed request contract for asking to join an experiment cohort.
// ABOUTME: Shared by the extension (signs with its identity key) and the Worker (verifies it).

import { ECDSA_SIGN_ALGORITHM, bytesToHex } from "./restoreRequest";

/** How far a request's signing time may drift from the Worker's clock. */
export const ACCESS_REQUEST_SIGNATURE_MAX_AGE_MS = 5 * 60_000;

/** The JSON body of POST /access-requests. */
export interface AccessRequest {
  publicId: string;
  /** Contact email exactly as sent, or null when the participant shares none. */
  email: string | null;
  requestedFeatures: string[];
  signedAt: number;
  /** Hex ECDSA P-256 / SHA-256 signature (IEEE P1363 r||s) over accessRequestSigningMessage. */
  signature: string;
}

export function accessRequestSigningMessage(
  request: Omit<AccessRequest, "signature">,
): string {
  return [
    "wwo-access-request-v1",
    request.publicId,
    request.email ?? "",
    request.requestedFeatures.join(","),
    String(request.signedAt),
  ].join("\n");
}

export async function signAccessRequest(
  privateKey: JsonWebKey,
  unsigned: Omit<AccessRequest, "signature">,
): Promise<AccessRequest> {
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
    new TextEncoder().encode(accessRequestSigningMessage(unsigned)),
  );
  return { ...unsigned, signature: bytesToHex(new Uint8Array(signature)) };
}
