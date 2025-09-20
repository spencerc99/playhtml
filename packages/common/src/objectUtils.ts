export function isPlainObject(value: any): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function deepReplaceIntoProxy(target: any, src: any) {
  if (src === null || src === undefined) return;
  if (Array.isArray(src)) {
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
        (target as any)[k] = v as any;
      }
    }
    return;
  }
  // primitives
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  target = src as any;
}
