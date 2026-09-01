// ABOUTME: Verifies signed participant color updates against public-key participant IDs.
// ABOUTME: Binds a signature to the exact color update and its monotonic version.

const PID_REGEX = /^pk_([0-9a-f]{130})$/i;

export function isValidParticipantPid(pid: string): boolean {
  return PID_REGEX.test(pid);
}

export function participantColorUpdatePayload(
  pid: string,
  color: string,
  version: number,
): string {
  return `participant-color-v1\n${pid}\n${color}\n${version}`;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeHex(value: string): Uint8Array {
  return Uint8Array.from(
    value.match(/.{2}/g) ?? [],
    (pair) => Number.parseInt(pair, 16),
  );
}

export async function verifyParticipantColorUpdate(
  pid: string,
  color: string,
  version: number,
  signature: string,
): Promise<boolean> {
  const pidMatch = PID_REGEX.exec(pid);
  const signatureBytes = decodeBase64(signature);
  if (!pidMatch || !signatureBytes) return false;

  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      decodeHex(pidMatch[1]).buffer as ArrayBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      signatureBytes.buffer as ArrayBuffer,
      new TextEncoder().encode(participantColorUpdatePayload(pid, color, version)).buffer as ArrayBuffer,
    );
  } catch {
    return false;
  }
}
