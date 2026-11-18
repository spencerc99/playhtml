// ABOUTME: Compares a presented credential against a configured secret in constant time.
// ABOUTME: Hashes both sides first so neither content nor length shapes the comparison time.

const encoder = new TextEncoder();

type TimingSafeEqual = (a: ArrayBufferView, b: ArrayBufferView) => boolean;

function runtimeTimingSafeEqual(): TimingSafeEqual | null {
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: TimingSafeEqual;
  };
  return typeof subtle.timingSafeEqual === "function"
    ? subtle.timingSafeEqual.bind(subtle)
    : null;
}

// Equal-length byte comparison that visits every byte with no early exit.
export function bytesEqualConstantTime(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }
  return difference === 0;
}

// SHA-256 digests are always 32 bytes, so presented credentials of any length
// reach the same fixed-size comparison as the configured secret.
export async function secretMatches(
  presented: string,
  configured: string,
): Promise<boolean> {
  const [presentedDigest, configuredDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(configured)),
  ]);
  const a = new Uint8Array(presentedDigest);
  const b = new Uint8Array(configuredDigest);
  const timingSafeEqual = runtimeTimingSafeEqual();
  return timingSafeEqual ? timingSafeEqual(a, b) : bytesEqualConstantTime(a, b);
}
