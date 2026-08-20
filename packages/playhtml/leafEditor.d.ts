// ABOUTME: Declares the inline state editing helpers exported by the playhtml subpath.
// ABOUTME: Defines public signatures without depending on another package entry file.
export type StatePathSegment = string | number;
export type EditableStateLeafValue = string | number | boolean | null;

type StateLeafParseResult =
  | { ok: true; value: EditableStateLeafValue }
  | { ok: false; error: string };

type StateLeafReplaceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export declare function isEditableStateLeaf(
  value: unknown,
): value is EditableStateLeafValue;

export declare function formatStateLeafValue(
  value: EditableStateLeafValue,
): string;

export declare function parseStateLeafValue(
  input: string,
): StateLeafParseResult;

export declare function replaceStateLeafValue<T>(
  data: T,
  path: StatePathSegment[],
  value: EditableStateLeafValue,
): StateLeafReplaceResult<T>;
