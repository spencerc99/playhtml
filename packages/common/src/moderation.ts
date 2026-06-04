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

export interface ModerationRecord extends RawRecord {
  /** The record's own identifier field, if any (id | ts | timestamp). */
  id?: string;
  /** Display text: chosen text field(s) joined for review. */
  text: string;
  /** Non-text scalar fields, surfaced as badges in the UI. */
  metadata: Record<string, unknown>;
  /** Numeric report count if the record carries one. */
  reportCount?: number;
}

const TEXT_FIELD_NAMES = [
  "text",
  "word",
  "message",
  "content",
  "note",
  "comment",
  "name",
];
const ID_FIELD_NAMES = ["id", "ts", "timestamp"];
const REPORT_FIELD_NAMES = ["reportCount", "reports", "votes"];
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

function isContentString(value: unknown): value is string {
  return typeof value === "string" && !HEX_COLOR.test(value) && value.trim() !== "";
}

export function extractRecords(play: Record<string, unknown>): ModerationRecord[] {
  return recordsFromPlay(play).map((raw) => {
    const fields = raw.fields;

    const namedTextValues: string[] = [];
    for (const name of TEXT_FIELD_NAMES) {
      const v = fields[name];
      if (isContentString(v)) namedTextValues.push(v);
    }

    let text: string;
    if (namedTextValues.length > 0) {
      text = namedTextValues.join(" — ");
    } else {
      const strings = Object.values(fields).filter(isContentString) as string[];
      text = strings.sort((a, b) => b.length - a.length)[0] ?? "";
    }

    let id: string | undefined;
    for (const name of ID_FIELD_NAMES) {
      const v = fields[name];
      if (typeof v === "string" || typeof v === "number") {
        id = String(v);
        break;
      }
    }

    let reportCount: number | undefined;
    for (const name of REPORT_FIELD_NAMES) {
      const v = fields[name];
      if (typeof v === "number") {
        reportCount = v;
        break;
      }
    }

    const textFieldSet = new Set(TEXT_FIELD_NAMES);
    const metadata: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (textFieldSet.has(k) && isContentString(v)) continue;
      metadata[k] = v;
    }

    return { ...raw, id, text, metadata, reportCount };
  });
}

export interface RemoveTarget {
  key: string;
  contentHash: string;
}

export interface SkippedTarget {
  key: string;
  reason: "hash-mismatch" | "not-found";
}

export interface RemoveResult {
  play: Record<string, unknown>;
  removed: number;
  skipped: SkippedTarget[];
}

/**
 * Remove records from a copy of `play` by hashed target. A target is removed
 * only if its key resolves to an existing record whose current content hash
 * matches the supplied one (the stale-snapshot guard). Within each array,
 * resolved indices are spliced in descending order so they don't shift
 * mid-delete. The input is never mutated.
 */
export function removeRecordsByTargets(
  play: Record<string, unknown>,
  targets: RemoveTarget[]
): RemoveResult {
  const next = JSON.parse(JSON.stringify(play)) as Record<string, unknown>;
  const current = recordsFromPlay(next);
  const byKey = new Map(current.map((r) => [r.key, r]));

  const skipped: SkippedTarget[] = [];
  // Map of array path -> indices to delete (validated).
  const deletionsByPath = new Map<string, number[]>();

  for (const target of targets) {
    const record = byKey.get(target.key);
    if (!record) {
      skipped.push({ key: target.key, reason: "not-found" });
      continue;
    }
    if (record.contentHash !== target.contentHash) {
      skipped.push({ key: target.key, reason: "hash-mismatch" });
      continue;
    }
    const indices = deletionsByPath.get(record.path) ?? [];
    indices.push(record.index);
    deletionsByPath.set(record.path, indices);
  }

  let removed = 0;
  for (const [path, indices] of deletionsByPath) {
    const arr = resolveArray(next, path);
    if (!arr) continue;
    for (const index of [...indices].sort((a, b) => b - a)) {
      arr.splice(index, 1);
      removed++;
    }
  }

  return { play: next, removed, skipped };
}

/** Resolve a dotted path (e.g. "can-play.chat1.messages") to its array, or null. */
function resolveArray(
  play: Record<string, unknown>,
  path: string
): unknown[] | null {
  const parts = path.split(".");
  let node: unknown = play;
  for (const part of parts) {
    if (!isPlainObject(node)) return null;
    node = node[part];
  }
  return Array.isArray(node) ? node : null;
}
