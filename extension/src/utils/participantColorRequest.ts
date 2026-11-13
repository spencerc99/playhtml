// ABOUTME: The signed request contract for setting a participant's cursor color on the Worker.
// ABOUTME: Shared by the extension (signs with its identity key) and the Worker (verifies it).

import { ECDSA_SIGN_ALGORITHM, bytesToHex } from "./restoreRequest";

/** How far a request's signing time may drift from the Worker's clock. */
export const PARTICIPANT_COLOR_SIGNATURE_MAX_AGE_MS = 5 * 60_000;

export interface ParticipantColorRequest {
  pid: string;
  color: string;
  signedAt: number;
  /** Hex ECDSA P-256 / SHA-256 signature (IEEE P1363 r||s) over participantColorSigningMessage. */
  signature: string;
}

/** The JSON body of PUT /participants/:pid; the pid travels in the path. */
export interface ParticipantColorBody {
  cursor_color: string;
  signedAt: number;
  signature: string;
}

export function participantColorSigningMessage(
  request: Omit<ParticipantColorRequest, "signature">,
): string {
  return [
    "wwo-participant-color-v1",
    request.pid,
    request.color,
    String(request.signedAt),
  ].join("\n");
}

export async function signParticipantColorRequest(
  privateKey: JsonWebKey,
  unsigned: Omit<ParticipantColorRequest, "signature">,
): Promise<ParticipantColorRequest> {
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
    new TextEncoder().encode(participantColorSigningMessage(unsigned)),
  );
  return { ...unsigned, signature: bytesToHex(new Uint8Array(signature)) };
}
