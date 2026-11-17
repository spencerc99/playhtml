// ABOUTME: Makes the random ids the protocol uses for clients and array items.
// ABOUTME: Works on plain http pages, where the browser hides crypto.randomUUID.

/**
 * Returns a random version 4 UUID. `crypto.randomUUID` only exists on https
 * and localhost pages, so the id is built from `crypto.getRandomValues`, which
 * every page has.
 */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
