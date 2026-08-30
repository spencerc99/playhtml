// ABOUTME: Verifies signed quarantine-tape strip/rip writes against the actor's own P-256 public key.
// ABOUTME: The actor id IS the raw hex-encoded public key (same scheme as participant identity), so no separate registry is needed.

const ACTOR_ID_REGEX = /^pk_([0-9a-f]{130})$/i;

export function isValidQuarantineActorId(id: string): boolean {
  return ACTOR_ID_REGEX.test(id);
}

// Keep these byte-for-byte identical to the client-side copies in
// extension/src/features/social/quarantine-tape/quarantineProof.ts — both
// sides build the exact string that gets signed/verified.
export function quarantineStripPayload(
  actor: string,
  url: string,
  type: string,
  a: { wall: string; t: number },
  b: { wall: string; t: number },
  seed: number,
): string {
  return `quarantine-strip-v1\n${actor}\n${url}\n${type}\n${a.wall}:${a.t}\n${b.wall}:${b.t}\n${seed}`;
}

export function quarantineRipPayload(
  actor: string,
  url: string,
  stripId: string,
  pos: number,
): string {
  return `quarantine-rip-v1\n${actor}\n${url}\n${stripId}\n${pos}`;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

export async function verifyQuarantineSignature(
  actor: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  const match = ACTOR_ID_REGEX.exec(actor);
  const signatureBytes = decodeBase64(signature);
  if (!match || !signatureBytes) return false;

  try {
    const publicKey = await crypto.subtle.importKey(
      'raw',
      decodeHex(match[1]).buffer as ArrayBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signatureBytes.buffer as ArrayBuffer,
      new TextEncoder().encode(payload).buffer as ArrayBuffer,
    );
  } catch {
    return false;
  }
}
