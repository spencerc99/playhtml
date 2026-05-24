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

function createTargetFor(source: object): object {
  return Array.isArray(source) ? [] : {};
}

function syncArrayLength(source: object, target: object): void {
  if (!Array.isArray(source) || !Array.isArray(target)) {
    return;
  }

  target.length = source.length;
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

    const sourceObject = value as object;
    const target = createTargetFor(sourceObject);
    const proxy = new Proxy(target, {
      get(_target, property) {
        if (
          Array.isArray(sourceObject) &&
          ARRAY_MUTATION_METHODS.has(property)
        ) {
          return throwReadOnlyStoreError;
        }
        return readOnlyValue(Reflect.get(sourceObject, property, sourceObject));
      },
      getOwnPropertyDescriptor(_target, property) {
        syncArrayLength(sourceObject, target);

        if (Array.isArray(sourceObject) && property === "length") {
          return Reflect.getOwnPropertyDescriptor(target, property);
        }

        const descriptor = Reflect.getOwnPropertyDescriptor(
          sourceObject,
          property,
        );
        if (!descriptor) {
          return descriptor;
        }

        if ("value" in descriptor) {
          return {
            ...descriptor,
            configurable: true,
            value: readOnlyValue(descriptor.value),
            writable: false,
          };
        }

        return {
          configurable: true,
          enumerable: descriptor.enumerable,
          value: readOnlyValue(
            Reflect.get(sourceObject, property, sourceObject),
          ),
          writable: false,
        };
      },
      has(_target, property) {
        return property in sourceObject;
      },
      ownKeys() {
        syncArrayLength(sourceObject, target);
        return Reflect.ownKeys(sourceObject);
      },
      getPrototypeOf() {
        return Reflect.getPrototypeOf(sourceObject);
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
