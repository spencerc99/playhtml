// ABOUTME: The signed request contract for restoring a participant's events from the Worker.
// ABOUTME: Shared by the extension (signs with its identity key) and the Worker (verifies it).

import type { CollectionEvent, CollectionEventType } from "../collectors/types";

/** Events per restore page. Matches the database function's cap. */
export const RESTORE_PAGE_SIZE = 1000;

/** How far a request's signing time may drift from the Worker's clock. */
export const RESTORE_SIGNATURE_MAX_AGE_MS = 5 * 60_000;

export interface RestoreCursor {
  ts: string;
  id: string;
}

export interface RestorePageRequest {
  pid: string;
  type: CollectionEventType;
  before: RestoreCursor | null;
  signedAt: number;
  /** Hex ECDSA P-256 / SHA-256 signature (IEEE P1363 r||s) over restoreSigningMessage. */
  signature: string;
}

export interface RestorePageResponse {
  events: CollectionEvent[];
  nextCursor: RestoreCursor | null;
}

export const ECDSA_SIGN_ALGORITHM = { name: "ECDSA", hash: "SHA-256" } as const;

export function restoreSigningMessage(
  request: Omit<RestorePageRequest, "signature">,
): string {
  return [
    "wwo-restore-v1",
    request.pid,
    request.type,
    request.before?.ts ?? "",
    request.before?.id ?? "",
    String(request.signedAt),
  ].join("\n");
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function signRestorePageRequest(
  privateKey: JsonWebKey,
  unsigned: Omit<RestorePageRequest, "signature">,
): Promise<RestorePageRequest> {
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
    new TextEncoder().encode(restoreSigningMessage(unsigned)),
  );
  return { ...unsigned, signature: bytesToHex(new Uint8Array(signature)) };
}
