// ABOUTME: Pure-JSON moderation helpers shared by the admin browser UI and Worker.
// ABOUTME: Walks play data into reviewable text records and removes them by hashed key.

/** Canonical JSON with sorted keys, so hashing is order-independent. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`
  );
  return `{${entries.join(",")}}`;
}

/** Stable short content hash (FNV-1a over canonical JSON) as a hex string. */
export function hashRecord(record: unknown): string {
  const text = canonicalize(record);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
