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

export interface RawRecord {
  /** Stable key for one extraction snapshot: `${path}#${index}`. */
  key: string;
  /** Dotted path to the containing array, e.g. "can-play.newWords". */
  path: string;
  /** Position within that array. */
  index: number;
  /** The full record object. */
  fields: Record<string, unknown>;
  /** Content hash of `fields`; the stale-snapshot anchor. */
  contentHash: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArrayOfObjects(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isPlainObject);
}

/**
 * Walk a `play` JSON structure and emit one RawRecord per object found in any
 * array-of-objects. Recurses through wrapper objects (e.g. LiveChat's
 * { messages: [...] }) so nested arrays are found. Arrays of primitives and
 * scalar element data (e.g. { on: true }) yield no records.
 */
export function recordsFromPlay(play: Record<string, unknown>): RawRecord[] {
  const records: RawRecord[] = [];

  const visit = (value: unknown, path: string): void => {
    if (isArrayOfObjects(value)) {
      value.forEach((obj, index) => {
        records.push({
          key: `${path}#${index}`,
          path,
          index,
          fields: obj,
          contentHash: hashRecord(obj),
        });
      });
      return;
    }
    if (isPlainObject(value)) {
      for (const childKey of Object.keys(value)) {
        visit(value[childKey], path ? `${path}.${childKey}` : childKey);
      }
    }
  };

  for (const tag of Object.keys(play)) {
    visit(play[tag], tag);
  }
  return records;
}
