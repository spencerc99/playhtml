// ABOUTME: The signed request contract for deleting a participant's shared events from one site.
// ABOUTME: Shared by the extension (signs with its identity key) and the Worker (verifies it).

import { ECDSA_SIGN_ALGORITHM, bytesToHex } from "./restoreRequest";

/** How far a request's signing time may drift from the Worker's clock. */
export const SITE_DELETE_SIGNATURE_MAX_AGE_MS = 5 * 60_000;

/** Rows the Worker deletes per request; the extension repeats until fewer come back. */
export const SITE_DELETE_BATCH_SIZE = 5000;

export interface SiteDeleteRequest {
  pid: string;
  /** Normalized host, like "chase.com". Covers its subdomains too. */
  host: string;
  signedAt: number;
  /** Hex ECDSA P-256 / SHA-256 signature (IEEE P1363 r||s) over siteDeleteSigningMessage. */
  signature: string;
}

export interface SiteDeleteResponse {
  deleted: number;
  /** True when this request may have left more rows; send another. */
  more: boolean;
}

export function siteDeleteSigningMessage(
  request: Omit<SiteDeleteRequest, "signature">,
): string {
  return [
    "wwo-delete-site-v1",
    request.pid,
    request.host,
    String(request.signedAt),
  ].join("\n");
}

export async function signSiteDeleteRequest(
  privateKey: JsonWebKey,
  unsigned: Omit<SiteDeleteRequest, "signature">,
): Promise<SiteDeleteRequest> {
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
    new TextEncoder().encode(siteDeleteSigningMessage(unsigned)),
  );
  return { ...unsigned, signature: bytesToHex(new Uint8Array(signature)) };
}
