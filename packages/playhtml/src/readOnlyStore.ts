// ABOUTME: Creates read-only views over shared playhtml data.
// ABOUTME: Preserves public inspection while blocking direct mutation.
type DeepReadonlyStore<T> = T extends (...args: any[]) => any
  ? T
  : T extends readonly (infer U)[]
    ? ReadonlyArray<DeepReadonlyStore<U>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonlyStore<T[K]> }
      : T;

const READ_ONLY_STORE_MESSAGE = [
  "playhtml.syncedStore is read-only.",
  "Use setData() or the admin console to change shared data.",
].join(" ");
const ARRAY_MUTATION_METHODS = new Set<PropertyKey>([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

function throwReadOnlyStoreError(): never {
  throw new Error(READ_ONLY_STORE_MESSAGE);
}

export function createReadOnlyStore<T extends object>(
  source: T,
): DeepReadonlyStore<T> {
  const proxyBySource = new WeakMap<object, unknown>();

  function readOnlyValue<TValue>(value: TValue): TValue {
    if (value === null || typeof value !== "object") {
      return value;
    }

    const cached = proxyBySource.get(value);
    if (cached) {
      return cached as TValue;
    }

    const proxy = new Proxy(value, {
      get(target, property, receiver) {
        if (Array.isArray(target) && ARRAY_MUTATION_METHODS.has(property)) {
          return throwReadOnlyStoreError;
        }
        return readOnlyValue(Reflect.get(target, property, receiver));
      },
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (!descriptor) {
          return descriptor;
        }

        if ("value" in descriptor) {
          const writable =
            descriptor.configurable === false
              ? descriptor.writable
              : false;
          return {
            ...descriptor,
            value: readOnlyValue(descriptor.value),
            writable,
          };
        }

        return descriptor;
      },
      set: throwReadOnlyStoreError,
      deleteProperty: throwReadOnlyStoreError,
      defineProperty: throwReadOnlyStoreError,
      setPrototypeOf: throwReadOnlyStoreError,
      preventExtensions: throwReadOnlyStoreError,
    });

    proxyBySource.set(value, proxy);
    return proxy as TValue;
  }

  return readOnlyValue(source) as DeepReadonlyStore<T>;
}

export type ReadOnlyStore<T extends object> = DeepReadonlyStore<T>;
