// ABOUTME: Applies version 2 protocol operations to immutable room snapshots.
// ABOUTME: Keeps visible arrays and their stable identity sidecar in lockstep.

import type {
  ArrayIdentity,
  JsonObject,
  JsonValue,
  Operation,
  OperationAddress,
  OperationRejectionCode,
  OperationValue,
  ProtocolPath,
  RoomSnapshot,
} from "./index";

export type ApplyOperationResult =
  | { readonly ok: true; readonly snapshot: RoomSnapshot }
  | {
      readonly ok: false;
      readonly code: OperationRejectionCode;
      readonly message: string;
    };

export type SnapshotIntegrityResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

type MutableArrayIdentity = {
  capability: string;
  elementId: string;
  path: ProtocolPath;
  itemIds: string[];
};

type MutableSnapshot = {
  state: Record<string, Record<string, JsonValue>>;
  arrays: MutableArrayIdentity[];
  lastMutationIds: Record<string, number>;
};

class OperationError extends Error {}

const pathsEqual = (left: ProtocolPath, right: ProtocolPath): boolean =>
  left.length === right.length &&
  left.every((segment, index) => {
    const other = right[index];
    return (
      typeof segment === typeof other &&
      (typeof segment === "string"
        ? segment === other
        : segment.itemId === (other as { readonly itemId: string }).itemId)
    );
  });

const pathStartsWith = (path: ProtocolPath, prefix: ProtocolPath): boolean =>
  path.length >= prefix.length &&
  pathsEqual(path.slice(0, prefix.length), prefix);

const formatPath = (path: ProtocolPath): string =>
  path.length === 0
    ? "<root>"
    : path
        .map((segment) =>
          typeof segment === "string" ? segment : `[itemId=${segment.itemId}]`,
        )
        .join(".");

const isObject = (value: JsonValue): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const valuesEqual = (left: JsonValue, right: JsonValue): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

function findArrayIdentity(
  arrays: readonly MutableArrayIdentity[],
  address: OperationAddress,
): MutableArrayIdentity | undefined;
function findArrayIdentity(
  arrays: readonly ArrayIdentity[],
  address: OperationAddress,
): ArrayIdentity | undefined;
function findArrayIdentity(
  arrays: readonly (ArrayIdentity | MutableArrayIdentity)[],
  address: OperationAddress,
): ArrayIdentity | MutableArrayIdentity | undefined {
  return arrays.find(
    (identity) =>
      identity.capability === address.capability &&
      identity.elementId === address.elementId &&
      pathsEqual(identity.path, address.path),
  );
}

const getElementValue = (
  snapshot: RoomSnapshot | MutableSnapshot,
  address: OperationAddress,
): JsonValue => {
  const capability = snapshot.state[address.capability];
  if (!capability || !(address.elementId in capability)) {
    throw new OperationError(
      `Element ${address.capability}/${address.elementId} does not exist`,
    );
  }
  return capability[address.elementId];
};

const getValueAtPath = (
  snapshot: RoomSnapshot | MutableSnapshot,
  address: OperationAddress,
): JsonValue => {
  let value = getElementValue(snapshot, address);
  const traversed: ProtocolPath[number][] = [];

  for (const segment of address.path) {
    if (typeof segment === "string") {
      if (!isObject(value)) {
        throw new OperationError(
          `Expected an object while traversing ${formatPath(traversed)}`,
        );
      }
      if (!(segment in value)) {
        throw new OperationError(
          `Path ${formatPath([...traversed, segment])} is missing`,
        );
      }
      value = value[segment];
    } else {
      if (!Array.isArray(value)) {
        throw new OperationError(
          `Expected an array while traversing ${formatPath(traversed)}`,
        );
      }
      const identity = findArrayIdentity(snapshot.arrays, {
        capability: address.capability,
        elementId: address.elementId,
        path: traversed,
      });
      if (!identity) {
        throw new OperationError(
          `Array identity is missing at ${formatPath(traversed)}`,
        );
      }
      const index = identity.itemIds.indexOf(segment.itemId);
      if (index === -1) {
        throw new OperationError(
          `Array item ${segment.itemId} is missing at ${formatPath(traversed)}`,
        );
      }
      value = value[index];
    }
    traversed.push(segment);
  }

  return value;
};

const cloneSnapshot = (snapshot: RoomSnapshot): MutableSnapshot =>
  structuredClone(snapshot) as MutableSnapshot;

const collectArrayPaths = (
  value: JsonValue,
  arrays: readonly ArrayIdentity[] | readonly MutableArrayIdentity[],
  address: OperationAddress,
  found: ProtocolPath[],
): void => {
  if (Array.isArray(value)) {
    const identity = findArrayIdentity(arrays, address);
    if (!identity) {
      throw new OperationError(
        `Array identity is missing at ${formatPath(address.path)}`,
      );
    }
    if (identity.itemIds.length !== value.length) {
      throw new OperationError(
        `Array length and item ID count differ at ${formatPath(address.path)}`,
      );
    }
    if (new Set(identity.itemIds).size !== identity.itemIds.length) {
      throw new OperationError(
        `Array item IDs are not unique at ${formatPath(address.path)}`,
      );
    }
    found.push(address.path);
    value.forEach((item, index) => {
      collectArrayPaths(
        item,
        arrays,
        {
          ...address,
          path: [...address.path, { itemId: identity.itemIds[index] }],
        },
        found,
      );
    });
    return;
  }

  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectArrayPaths(
        child,
        arrays,
        { ...address, path: [...address.path, key] },
        found,
      );
    }
  }
};

/** Verifies that every visible array has exactly one matching identity list. */
export const checkSnapshotIntegrity = (
  snapshot: RoomSnapshot,
): SnapshotIntegrityResult => {
  try {
    const found: ArrayIdentity[] = [];
    const foundPaths: Array<{
      capability: string;
      elementId: string;
      path: ProtocolPath;
    }> = [];

    for (const [capability, elements] of Object.entries(snapshot.state)) {
      for (const [elementId, value] of Object.entries(elements)) {
        const paths: ProtocolPath[] = [];
        collectArrayPaths(
          value,
          snapshot.arrays,
          { capability, elementId, path: [] },
          paths,
        );
        for (const path of paths) {
          foundPaths.push({ capability, elementId, path });
          const identity = findArrayIdentity(snapshot.arrays, {
            capability,
            elementId,
            path,
          });
          if (identity) found.push(identity as ArrayIdentity);
        }
      }
    }

    if (found.length !== snapshot.arrays.length) {
      const extra = snapshot.arrays.find(
        (identity) =>
          !foundPaths.some(
            (path) =>
              path.capability === identity.capability &&
              path.elementId === identity.elementId &&
              pathsEqual(path.path, identity.path),
          ),
      );
      throw new OperationError(
        extra
          ? `Array identity has no matching array at ${formatPath(extra.path)}`
          : "Duplicate array identity entries exist",
      );
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Snapshot integrity check failed",
    };
  }
};

const validateOperationValue = (operationValue: OperationValue): void => {
  const snapshot: RoomSnapshot = {
    state: { value: { value: operationValue.value } },
    arrays: operationValue.arrays.map((identity) => ({
      capability: "value",
      elementId: "value",
      path: identity.path,
      itemIds: identity.itemIds,
    })),
    lastMutationIds: {},
  };
  const integrity = checkSnapshotIntegrity(snapshot);
  if (!integrity.ok)
    throw new OperationError(`Invalid operation value: ${integrity.message}`);
};

const installValueArrays = (
  snapshot: MutableSnapshot,
  address: OperationAddress,
  operationValue: OperationValue,
): void => {
  snapshot.arrays.push(
    ...operationValue.arrays.map((identity) => ({
      capability: address.capability,
      elementId: address.elementId,
      path: [...address.path, ...identity.path],
      itemIds: [...identity.itemIds],
    })),
  );
};

const removeValueArrays = (
  snapshot: MutableSnapshot,
  address: OperationAddress,
): void => {
  snapshot.arrays = snapshot.arrays.filter(
    (identity) =>
      identity.capability !== address.capability ||
      identity.elementId !== address.elementId ||
      !pathStartsWith(identity.path, address.path),
  );
};

const setValueAtPath = (
  snapshot: MutableSnapshot,
  address: OperationAddress,
  value: JsonValue,
): void => {
  if (address.path.length === 0) {
    snapshot.state[address.capability][address.elementId] = value;
    return;
  }

  const parentPath = address.path.slice(0, -1);
  const segment = address.path[address.path.length - 1];
  const parent = getValueAtPath(snapshot, { ...address, path: parentPath });
  if (typeof segment === "string") {
    if (!isObject(parent)) {
      throw new OperationError(
        `Expected an object at ${formatPath(parentPath)}`,
      );
    }
    (parent as Record<string, JsonValue>)[segment] = value;
    return;
  }
  if (!Array.isArray(parent)) {
    throw new OperationError(`Expected an array at ${formatPath(parentPath)}`);
  }
  const identity = findArrayIdentity(snapshot.arrays, {
    ...address,
    path: parentPath,
  });
  if (!identity)
    throw new OperationError(
      `Array identity is missing at ${formatPath(parentPath)}`,
    );
  const index = identity.itemIds.indexOf(segment.itemId);
  if (index === -1)
    throw new OperationError(`Array item ${segment.itemId} is missing`);
  (parent as JsonValue[])[index] = value;
};

const applySet = (
  snapshot: MutableSnapshot,
  operation: Operation & { type: "set" },
): void => {
  validateOperationValue(operation);
  // A root set is the only operation that may create its element, because it
  // is how a new element's default data is seeded. Deeper paths still require
  // the element and the full path to exist.
  if (operation.path.length === 0) {
    if (!snapshot.state[operation.capability]) {
      snapshot.state[operation.capability] = {};
    }
    removeValueArrays(snapshot, operation);
    snapshot.state[operation.capability][operation.elementId] = structuredClone(
      operation.value,
    );
    installValueArrays(snapshot, operation, operation);
    return;
  }
  getValueAtPath(snapshot, operation);
  removeValueArrays(snapshot, operation);
  setValueAtPath(snapshot, operation, structuredClone(operation.value));
  installValueArrays(snapshot, operation, operation);
};

const operationValueMatches = (
  snapshot: MutableSnapshot,
  address: OperationAddress,
  operation: OperationValue,
): boolean => {
  const current = getValueAtPath(snapshot, address);
  if (!valuesEqual(current, operation.value)) return false;

  return operation.arrays.every((expected) => {
    const actual = findArrayIdentity(snapshot.arrays, {
      ...address,
      path: [...address.path, ...expected.path],
    });
    return (
      actual !== undefined &&
      actual.itemIds.length === expected.itemIds.length &&
      actual.itemIds.every(
        (itemId, index) => itemId === expected.itemIds[index],
      )
    );
  });
};

const applyInsert = (
  snapshot: MutableSnapshot,
  operation: Operation & { type: "insert" },
): void => {
  validateOperationValue(operation);
  const container = getValueAtPath(snapshot, operation);

  if (operation.target.kind === "object") {
    if (!isObject(container)) {
      throw new OperationError(
        `Insert target at ${formatPath(operation.path)} is not an object`,
      );
    }
    const valueAddress = {
      ...operation,
      path: [...operation.path, operation.target.key],
    };
    if (operation.target.key in container) {
      if (operationValueMatches(snapshot, valueAddress, operation)) return;
      throw new OperationError(
        `Object key ${operation.target.key} is already occupied`,
      );
    }
    (container as Record<string, JsonValue>)[operation.target.key] =
      structuredClone(operation.value);
    installValueArrays(snapshot, valueAddress, operation);
    return;
  }

  if (!Array.isArray(container)) {
    throw new OperationError(
      `Insert target at ${formatPath(operation.path)} is not an array`,
    );
  }
  if (
    !Number.isSafeInteger(operation.target.index) ||
    operation.target.index < 0
  ) {
    throw new OperationError(
      "Array insert index must be a non-negative safe integer",
    );
  }
  const identity = findArrayIdentity(snapshot.arrays, operation);
  if (!identity)
    throw new OperationError(
      `Array identity is missing at ${formatPath(operation.path)}`,
    );
  const existingIndex = identity.itemIds.indexOf(operation.target.itemId);
  if (existingIndex !== -1) {
    const valueAddress = {
      ...operation,
      path: [...operation.path, { itemId: operation.target.itemId }],
    };
    if (operationValueMatches(snapshot, valueAddress, operation)) return;
    throw new OperationError(
      `Array item ID ${operation.target.itemId} is already occupied`,
    );
  }

  const index = Math.min(operation.target.index, container.length);
  (container as JsonValue[]).splice(index, 0, structuredClone(operation.value));
  identity.itemIds.splice(index, 0, operation.target.itemId);
  installValueArrays(
    snapshot,
    {
      ...operation,
      path: [...operation.path, { itemId: operation.target.itemId }],
    },
    operation,
  );
};

const applyRemove = (
  snapshot: MutableSnapshot,
  operation: Operation & { type: "remove" },
): void => {
  const container = getValueAtPath(snapshot, operation);
  if (operation.target.kind === "object") {
    if (!isObject(container)) {
      throw new OperationError(
        `Remove target at ${formatPath(operation.path)} is not an object`,
      );
    }
    if (!(operation.target.key in container)) return;
    const valueAddress = {
      ...operation,
      path: [...operation.path, operation.target.key],
    };
    removeValueArrays(snapshot, valueAddress);
    delete (container as Record<string, JsonValue>)[operation.target.key];
    return;
  }

  if (!Array.isArray(container)) {
    throw new OperationError(
      `Remove target at ${formatPath(operation.path)} is not an array`,
    );
  }
  const identity = findArrayIdentity(snapshot.arrays, operation);
  if (!identity)
    throw new OperationError(
      `Array identity is missing at ${formatPath(operation.path)}`,
    );
  const index = identity.itemIds.indexOf(operation.target.itemId);
  if (index === -1) return;
  removeValueArrays(snapshot, {
    ...operation,
    path: [...operation.path, { itemId: operation.target.itemId }],
  });
  (container as JsonValue[]).splice(index, 1);
  identity.itemIds.splice(index, 1);
};

const applyIncrement = (
  snapshot: MutableSnapshot,
  operation: Operation & { type: "increment" },
): void => {
  if (!Number.isFinite(operation.delta)) {
    throw new OperationError("Increment delta must be finite");
  }
  const current = getValueAtPath(snapshot, operation);
  if (typeof current !== "number" || !Number.isFinite(current)) {
    throw new OperationError("Increment target must be a finite number");
  }
  const next = current + operation.delta;
  if (!Number.isFinite(next)) {
    throw new OperationError("Increment result must be finite");
  }
  setValueAtPath(snapshot, operation, next);
};

export type ApplyOperationOptions = {
  /**
   * Verify full snapshot integrity before and after the apply. The walk is
   * O(room size), so production paths leave it off; tests turn it on.
   */
  readonly validate?: boolean;
};

/** Applies one operation without mutating either the input snapshot or operation. */
export const applyOperation = (
  snapshot: RoomSnapshot,
  operation: Operation,
  options?: ApplyOperationOptions,
): ApplyOperationResult => {
  const validate = options?.validate ?? false;
  try {
    if (validate) {
      const initialIntegrity = checkSnapshotIntegrity(snapshot);
      if (!initialIntegrity.ok) {
        throw new OperationError(
          `Invalid snapshot: ${initialIntegrity.message}`,
        );
      }
    }
    const next = cloneSnapshot(snapshot);
    switch (operation.type) {
      case "set":
        applySet(next, operation);
        break;
      case "insert":
        applyInsert(next, operation);
        break;
      case "remove":
        applyRemove(next, operation);
        break;
      case "increment":
        applyIncrement(next, operation);
        break;
    }
    const finalIntegrity = validate
      ? checkSnapshotIntegrity(next)
      : ({ ok: true } as const);
    if (!finalIntegrity.ok) {
      throw new OperationError(
        `Operation broke snapshot integrity: ${finalIntegrity.message}`,
      );
    }
    return { ok: true, snapshot: next };
  } catch (error) {
    return {
      ok: false,
      code: "invalid-operation",
      message:
        error instanceof Error
          ? error.message
          : "Operation could not be applied",
    };
  }
};
