// ABOUTME: Compares and updates plain shared-data structures without redundant writes.
// ABOUTME: Preserves proxy identity while avoiding unnecessary CRDT history.
export function isPlainObject(value: any): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function valuesEqual(left: any, right: any): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      rightKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(left, key) &&
          valuesEqual(left[key], right[key]),
      )
    );
  }
  return false;
}

export function deepReplaceIntoProxy(target: any, src: any) {
  if (src === null || src === undefined) return;
  if (Array.isArray(src)) {
    replaceArrayIntoProxy(target, src);
    return;
  }
  if (isPlainObject(src)) {
    for (const key of Object.keys(target)) {
      if (!(key in src)) delete target[key];
    }
    for (const [k, v] of Object.entries(src)) {
      if (Array.isArray(v)) {
        if (!Array.isArray(target[k])) target[k] = [];
        deepReplaceIntoProxy(target[k], v);
      } else if (isPlainObject(v)) {
        if (!isPlainObject(target[k])) target[k] = {};
        deepReplaceIntoProxy(target[k], v);
      } else {
        if (!Object.is(target[k], v)) {
          (target as any)[k] = v as any;
        }
      }
    }
    return;
  }
  // primitives
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  target = src as any;
}

// An item that names itself with `id` is the same item only when the id
// matches. Updating an item in place under a different id would turn a
// reorder into field rewrites, and a concurrent edit to the original item would
// then land on whatever moved into its slot.
function isSameItem(current: any, next: any): boolean {
  const currentHasId = isPlainObject(current) && "id" in current;
  const nextHasId = isPlainObject(next) && "id" in next;
  if (currentHasId || nextHasId) {
    return currentHasId && nextHasId && valuesEqual(current.id, next.id);
  }
  return true;
}

// Rewrites only the part of the array that changed. Unchanged leading and
// trailing items are left alone. When the changed region keeps its length,
// an item that is clearly the same item is updated in place, so one edited
// field writes one field instead of re-inserting the whole list. Items are
// the same when their ids match, or, without ids, when the item is the only
// one that changed (several changed id-less items look like a reorder, and
// those are replaced whole).
function replaceArrayIntoProxy(target: any[], src: any[]): void {
  let start = 0;
  const shortest = Math.min(target.length, src.length);
  while (start < shortest && valuesEqual(target[start], src[start])) start += 1;
  if (start === target.length && start === src.length) return;

  let targetEnd = target.length;
  let srcEnd = src.length;
  while (
    targetEnd > start &&
    srcEnd > start &&
    valuesEqual(target[targetEnd - 1], src[srcEnd - 1])
  ) {
    targetEnd -= 1;
    srcEnd -= 1;
  }

  if (targetEnd - start !== srcEnd - start) {
    target.splice(start, targetEnd - start, ...src.slice(start, srcEnd));
    return;
  }

  const changedIndexes: number[] = [];
  for (let index = start; index < srcEnd; index += 1) {
    if (!valuesEqual(target[index], src[index])) changedIndexes.push(index);
  }
  const singleChange = changedIndexes.length === 1;

  for (const index of changedIndexes) {
    const current = target[index];
    const next = src[index];
    const sameContainer =
      (Array.isArray(current) && Array.isArray(next)) ||
      (isPlainObject(current) && isPlainObject(next));
    const hasId =
      (isPlainObject(current) && "id" in current) ||
      (isPlainObject(next) && "id" in next);
    const sameItem = hasId ? isSameItem(current, next) : singleChange;
    if (sameContainer && sameItem) {
      deepReplaceIntoProxy(current, next);
    } else {
      target.splice(index, 1, next);
    }
  }
}

export function clonePlain<T>(value: T): T {
  // Prefer structuredClone when available; fallback to JSON clone for plain data
  try {
    // @ts-ignore
    if (typeof structuredClone === "function") {
      // @ts-ignore
      return structuredClone(value);
    }
  } catch {}
  if (value === null || value === undefined) return value;
  if (typeof value === "object") {
    return JSON.parse(JSON.stringify(value));
  }
  return value;
}
