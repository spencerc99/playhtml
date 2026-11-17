// ABOUTME: Parses untrusted path segments, query parameters, and JSON bodies for Worker routes.
// ABOUTME: Each parser returns null for malformed input so routes can answer 400 instead of throwing.

/** Decodes a percent-encoded path segment, or null when it has a bad escape like "%E0%A4%A". */
export function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** A JSON object body, or null when the body is not JSON or is null, an array, or a primitive. */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

/** A date ("2026-11-11") or ISO date-time ("2026-11-11T10:00:00.000Z", optional offset). */
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * True when the leading YYYY-MM-DD names a day that exists. `Date.parse` rolls
 * "2026-02-31" forward to March instead of rejecting it.
 */
function isRealCalendarDate(raw: string): boolean {
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(5, 7));
  const day = Number(raw.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export type OptionalParam<T> = { ok: true; value: T | null } | { ok: false };

/**
 * An optional ISO date bound from the query string. Absent or empty is
 * `{ ok: true, value: null }`; anything that is not a real ISO date is `{ ok: false }`.
 */
export function parseOptionalIsoDate(
  params: URLSearchParams,
  name: string,
): OptionalParam<string> {
  const raw = params.get(name);
  if (!raw) return { ok: true, value: null };
  if (
    !ISO_DATE_PATTERN.test(raw) ||
    Number.isNaN(Date.parse(raw)) ||
    !isRealCalendarDate(raw)
  ) {
    return { ok: false };
  }
  return { ok: true, value: raw };
}

/**
 * An optional positive integer from the query string. Absent or empty is
 * `{ ok: true, value: null }`; zero, negatives, decimals, and words are `{ ok: false }`.
 */
export function parseOptionalPositiveInt(
  params: URLSearchParams,
  name: string,
): OptionalParam<number> {
  const raw = params.get(name);
  if (!raw) return { ok: true, value: null };
  if (!/^[1-9]\d{0,8}$/.test(raw)) return { ok: false };
  return { ok: true, value: Number(raw) };
}
