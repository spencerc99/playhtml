// ABOUTME: Provides shared helpers for inline editing primitive state values.
// ABOUTME: Parses editor input and replaces existing leaves without mutating state trees.
export type StatePathSegment = string | number;
export type EditableStateLeafValue = string | number | boolean | null;

export type StateLeafParseResult =
  | { ok: true; value: EditableStateLeafValue }
  | { ok: false; error: string };

export type StateLeafReplaceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function isEditableStateLeaf(
  value: unknown,
): value is EditableStateLeafValue {
  if (value === null) return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" || typeof value === "boolean";
}

export function formatStateLeafValue(value: EditableStateLeafValue): string {
  return JSON.stringify(value);
}

export function parseStateLeafValue(input: string): StateLeafParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "Enter a JSON string, number, boolean, or null.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      error: "Enter a valid JSON string, number, boolean, or null.",
    };
  }

  if (!isEditableStateLeaf(parsed)) {
    return {
      ok: false,
      error: "Only primitive values can be edited inline.",
    };
  }

  return { ok: true, value: parsed };
}

export function replaceStateLeafValue<T>(
  data: T,
  path: StatePathSegment[],
  value: EditableStateLeafValue,
): StateLeafReplaceResult<T> {
  if (path.length === 0) {
    return {
      ok: false,
      error: "Choose a value inside the state tree.",
    };
  }

  const current = getPathValue(data, path);
  if (!current.exists) {
    return { ok: false, error: "State path does not exist." };
  }

  if (!isEditableStateLeaf(current.value)) {
    return {
      ok: false,
      error: "Only primitive values can be edited inline.",
    };
  }

  return {
    ok: true,
    data: replacePathValue(data, path, value) as T,
  };
}

function getPathValue(
  data: unknown,
  path: StatePathSegment[],
): { exists: true; value: unknown } | { exists: false } {
  let current = data;
  for (const segment of path) {
    if (!hasPathSegment(current, segment)) {
      return { exists: false };
    }
    current = (current as any)[segment as any];
  }
  return { exists: true, value: current };
}

function hasPathSegment(value: unknown, segment: StatePathSegment): boolean {
  if (Array.isArray(value)) {
    return (
      typeof segment === "number" &&
      Number.isInteger(segment) &&
      segment >= 0 &&
      segment < value.length
    );
  }

  if (value === null || typeof value !== "object") {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(value, String(segment));
}

function replacePathValue(
  value: unknown,
  path: StatePathSegment[],
  replacement: EditableStateLeafValue,
): unknown {
  const [segment, ...rest] = path;
  if (segment === undefined) return replacement;

  const copy = Array.isArray(value)
    ? [...value]
    : { ...(value as Record<string, unknown>) };
  (copy as any)[segment as any] = replacePathValue(
    (value as any)[segment as any],
    rest,
    replacement,
  );
  return copy;
}
