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
    if (valuesEqual(target, src)) return;
    target.splice(0, target.length, ...src);
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
