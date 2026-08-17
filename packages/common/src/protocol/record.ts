// ABOUTME: Records shared-data mutations as version 2 protocol operations.
// ABOUTME: Resolves Immer array indices to stable item identities in room snapshots.

import {
  enablePatches,
  produceWithPatches,
  type Draft,
  type Patch,
} from "immer";
import { applyOperation } from "./engine";
import type {
  JsonObject,
  JsonValue,
  Operation,
  OperationValue,
  ProtocolPath,
  RoomSnapshot,
  ValueArrayIdentity,
} from "./index";

enablePatches();

// Immer's Draft<T> recurses on JsonValue's self-referential type and trips
// TS2589, so the produce call is typed through this fixed-shape alias. The
// recipe operates on the tracking draft, which carries its own typing.
const produceJsonWithPatches = produceWithPatches as unknown as (
  base: JsonValue | undefined,
  recipe: (draft: unknown) => void
) => [JsonValue | undefined, Patch[], Patch[]];

type ImmerPath = readonly (string | number)[];

type ArrayItemToken = {
  readonly itemId: string;
  readonly existing: boolean;
};

type StructuralArrayMutation = {
  readonly path: ImmerPath;
  readonly tokens: ArrayItemToken[];
};

type MutationIntent = {
  readonly structuralArrays: Map<string, StructuralArrayMutation>;
  readonly numericReads: Set<string>;
  readonly increments: Map<
    string,
    { delta: number; onlyReadModifyWrites: boolean }
  >;
};

export type MutationCallback<Value extends JsonValue = JsonValue> = (
  draft: Draft<Value>,
) => unknown;

export type RecordedMutation = {
  readonly ops: Operation[];
  readonly next: RoomSnapshot;
};

const arrayMutationMethods = new Set([
  "pop",
  "push",
  "shift",
  "splice",
  "unshift",
]);

const pathKey = (path: ImmerPath): string => JSON.stringify(path);

const isJsonObject = (value: JsonValue): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const valuesEqual = (left: JsonValue, right: JsonValue): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const getElementValue = (
  snapshot: RoomSnapshot,
  capability: string,
  elementId: string,
): JsonValue => {
  const elements = snapshot.state[capability];
  if (!elements || !(elementId in elements)) {
    throw new Error(`Element ${capability}/${elementId} does not exist`);
  }
  return elements[elementId];
};

const getValueAtImmerPath = (value: JsonValue, path: ImmerPath): JsonValue => {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) {
        throw new Error(
          `Array index ${segment} does not exist while recording mutation`,
        );
      }
      current = current[segment];
    } else {
      if (!isJsonObject(current) || !(segment in current)) {
        throw new Error(
          `Object key ${segment} does not exist while recording mutation`,
        );
      }
      current = current[segment];
    }
  }
  return current;
};

const findArrayItemIds = (
  snapshot: RoomSnapshot,
  capability: string,
  elementId: string,
  path: ProtocolPath,
): readonly string[] => {
  const identity = snapshot.arrays.find(
    (candidate) =>
      candidate.capability === capability &&
      candidate.elementId === elementId &&
      candidate.path.length === path.length &&
      candidate.path.every((segment, index) => {
        const other = path[index];
        return typeof segment === "string"
          ? segment === other
          : typeof other !== "string" && segment.itemId === other.itemId;
      }),
  );
  if (!identity)
    throw new Error("Array identity is missing while recording mutation");
  return identity.itemIds;
};

const toProtocolPath = (
  snapshot: RoomSnapshot,
  capability: string,
  elementId: string,
  path: ImmerPath,
): ProtocolPath => {
  const protocolPath: ProtocolPath[number][] = [];
  let current = getElementValue(snapshot, capability, elementId);

  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        throw new Error("Numeric Immer path segment does not address an array");
      }
      const itemIds = findArrayItemIds(
        snapshot,
        capability,
        elementId,
        protocolPath,
      );
      const itemId = itemIds[segment];
      if (itemId === undefined) {
        throw new Error(
          `Array index ${segment} does not have a stable item ID`,
        );
      }
      protocolPath.push({ itemId });
      current = current[segment];
    } else {
      if (!isJsonObject(current) || !(segment in current)) {
        throw new Error(
          `Object key ${segment} does not exist while resolving a path`,
        );
      }
      protocolPath.push(segment);
      current = current[segment];
    }
  }

  return protocolPath;
};

const createOperationValue = (value: JsonValue): OperationValue => {
  const arrays: ValueArrayIdentity[] = [];

  const visit = (current: JsonValue, path: ProtocolPath): void => {
    if (Array.isArray(current)) {
      const itemIds = current.map(() => crypto.randomUUID());
      arrays.push({ path, itemIds });
      current.forEach((item, index) =>
        visit(item, [...path, { itemId: itemIds[index] }]),
      );
      return;
    }
    if (isJsonObject(current)) {
      for (const [key, child] of Object.entries(current)) {
        visit(child, [...path, key]);
      }
    }
  };

  visit(value, []);
  return { value: structuredClone(value), arrays };
};

const applyRecordedOperation = (
  snapshot: RoomSnapshot,
  operation: Operation,
): RoomSnapshot => {
  const result = applyOperation(snapshot, operation);
  if (!result.ok) {
    throw new Error(`Recorded operation was rejected: ${result.message}`);
  }
  return result.snapshot;
};

const createTrackingDraft = (
  value: unknown,
  path: ImmerPath,
  intent: MutationIntent,
  getInitialItemIds: (path: ImmerPath) => readonly string[] | undefined,
): unknown => {
  if (typeof value !== "object" || value === null) return value;

  return new Proxy(value as object, {
    get(target, property, receiver) {
      const child = Reflect.get(target, property, receiver) as unknown;
      const segment =
        Array.isArray(target) &&
        typeof property === "string" &&
        /^(0|[1-9]\d*)$/.test(property)
          ? Number(property)
          : String(property);
      if (
        Array.isArray(target) &&
        typeof property === "string" &&
        arrayMutationMethods.has(property)
      ) {
        return (...args: unknown[]) => {
          const key = pathKey(path);
          let mutation = intent.structuralArrays.get(key);
          if (!mutation) {
            const itemIds = getInitialItemIds(path);
            if (itemIds) {
              mutation = {
                path,
                tokens: itemIds.map((itemId) => ({ itemId, existing: true })),
              };
              intent.structuralArrays.set(key, mutation);
            }
          }
          if (mutation) updateArrayTokens(mutation.tokens, property, args);
          return Reflect.apply(
            child as (...values: unknown[]) => unknown,
            target,
            args,
          );
        };
      }
      if (typeof property === "string" && typeof child === "number") {
        intent.numericReads.add(pathKey([...path, segment]));
      }
      if (
        typeof property === "string" &&
        typeof child === "object" &&
        child !== null
      ) {
        return createTrackingDraft(
          child,
          [...path, segment],
          intent,
          getInitialItemIds,
        );
      }
      return child;
    },
    set(target, property, nextValue, receiver) {
      const segment =
        Array.isArray(target) &&
        typeof property === "string" &&
        /^(0|[1-9]\d*)$/.test(property)
          ? Number(property)
          : String(property);
      const mutationPath = [...path, segment];
      const key = pathKey(mutationPath);
      const previousValue = Reflect.get(target, property, receiver) as unknown;
      const wasRead = intent.numericReads.delete(key);
      if (
        Array.isArray(target) &&
        property === "length" &&
        typeof nextValue === "number"
      ) {
        const structuralKey = pathKey(path);
        let structuralMutation = intent.structuralArrays.get(structuralKey);
        if (!structuralMutation && nextValue < Number(previousValue)) {
          const itemIds = getInitialItemIds(path);
          if (itemIds) {
            structuralMutation = {
              path,
              tokens: itemIds.map((itemId) => ({ itemId, existing: true })),
            };
            intent.structuralArrays.set(structuralKey, structuralMutation);
          }
        }
        if (structuralMutation && nextValue < structuralMutation.tokens.length) {
          structuralMutation.tokens.length = nextValue;
        }
      }
      if (typeof previousValue === "number" && typeof nextValue === "number") {
        const increment = intent.increments.get(key) ?? {
          delta: 0,
          onlyReadModifyWrites: true,
        };
        increment.delta += nextValue - previousValue;
        increment.onlyReadModifyWrites &&= wasRead;
        intent.increments.set(key, increment);
      }
      return Reflect.set(target, property, nextValue, receiver);
    },
    deleteProperty(target, property) {
      return Reflect.deleteProperty(target, property);
    },
  });
};

const toArrayIndex = (value: unknown, length: number): number => {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return 0;
  if (numeric === Number.POSITIVE_INFINITY) return length;
  if (numeric === Number.NEGATIVE_INFINITY) return 0;
  const integer = Math.trunc(numeric);
  return integer < 0
    ? Math.max(length + integer, 0)
    : Math.min(integer, length);
};

const updateArrayTokens = (
  tokens: ArrayItemToken[],
  method: string,
  args: readonly unknown[],
): void => {
  const createTokens = (count: number): ArrayItemToken[] =>
    Array.from({ length: count }, () => ({
      itemId: crypto.randomUUID(),
      existing: false,
    }));

  switch (method) {
    case "push":
      tokens.push(...createTokens(args.length));
      return;
    case "unshift":
      tokens.unshift(...createTokens(args.length));
      return;
    case "pop":
      tokens.pop();
      return;
    case "shift":
      tokens.shift();
      return;
    case "splice": {
      const start = toArrayIndex(args[0], tokens.length);
      const deleteCount =
        args.length < 2
          ? tokens.length - start
          : Math.min(
              Math.max(Math.trunc(Number(args[1])) || 0, 0),
              tokens.length - start,
            );
      tokens.splice(
        start,
        deleteCount,
        ...createTokens(Math.max(args.length - 2, 0)),
      );
    }
  }
};

const isCoveredStructuralArrayPatch = (
  patch: Patch,
  structuralPaths: readonly ImmerPath[],
): boolean =>
  structuralPaths.some(
    (arrayPath) =>
      patch.path.length > arrayPath.length &&
      arrayPath.every((segment, index) => patch.path[index] === segment) &&
      (typeof patch.path[arrayPath.length] === "number" ||
        patch.path[arrayPath.length] === "length"),
  );

const recordStructuralArray = (
  snapshot: RoomSnapshot,
  capability: string,
  elementId: string,
  mutation: StructuralArrayMutation,
  finalValue: JsonValue,
): { readonly ops: Operation[]; readonly next: RoomSnapshot } => {
  const immerPath = mutation.path;
  const previousArray = getValueAtImmerPath(
    getElementValue(snapshot, capability, elementId),
    immerPath,
  );
  const nextArray = getValueAtImmerPath(finalValue, immerPath);
  if (!Array.isArray(previousArray) || !Array.isArray(nextArray)) {
    throw new Error(
      "A recorded array method did not preserve the array container",
    );
  }
  const path = toProtocolPath(snapshot, capability, elementId, immerPath);
  const itemIds = findArrayItemIds(snapshot, capability, elementId, path);
  const retainedItemIds = new Set(
    mutation.tokens
      .filter((token) => token.existing)
      .map((token) => token.itemId),
  );
  const ops: Operation[] = [];
  let working = snapshot;

  previousArray.forEach((_item, index) => {
    if (retainedItemIds.has(itemIds[index])) return;
    const operation: Operation = {
      type: "remove",
      capability,
      elementId,
      path,
      target: { kind: "array", itemId: itemIds[index] },
    };
    ops.push(operation);
    working = applyRecordedOperation(working, operation);
  });

  mutation.tokens.forEach((token, index) => {
    if (token.existing) return;
    const operation: Operation = {
      type: "insert",
      capability,
      elementId,
      path,
      target: { kind: "array", index, itemId: token.itemId },
      ...createOperationValue(nextArray[index]),
    };
    ops.push(operation);
    working = applyRecordedOperation(working, operation);
  });

  mutation.tokens.forEach((token, index) => {
    if (!token.existing) return;
    const previousIndex = itemIds.indexOf(token.itemId);
    if (valuesEqual(previousArray[previousIndex], nextArray[index])) return;
    const operation: Operation = {
      type: "set",
      capability,
      elementId,
      path: [...path, { itemId: token.itemId }],
      ...createOperationValue(nextArray[index]),
    };
    ops.push(operation);
    working = applyRecordedOperation(working, operation);
  });

  return { ops, next: working };
};

const recordPatch = (
  snapshot: RoomSnapshot,
  capability: string,
  elementId: string,
  patch: Patch,
  increments: MutationIntent["increments"],
):
  | { readonly operation: Operation; readonly next: RoomSnapshot }
  | undefined => {
  const patchPath = patch.path as ImmerPath;
  const parentImmerPath = patchPath.slice(0, -1);
  const target = patchPath[patchPath.length - 1];

  if (patch.op === "replace") {
    const path = toProtocolPath(snapshot, capability, elementId, patchPath);
    const increment = increments.get(pathKey(patchPath));
    const current = getValueAtImmerPath(
      getElementValue(snapshot, capability, elementId),
      patchPath,
    );
    if (valuesEqual(current, patch.value as JsonValue)) return undefined;
    const operation: Operation =
      increment?.onlyReadModifyWrites &&
      typeof current === "number" &&
      typeof patch.value === "number" &&
      current + increment.delta === patch.value
        ? {
            type: "increment",
            capability,
            elementId,
            path,
            delta: increment.delta,
          }
        : {
            type: "set",
            capability,
            elementId,
            path,
            ...createOperationValue(patch.value as JsonValue),
          };
    return { operation, next: applyRecordedOperation(snapshot, operation) };
  }

  const parentPath = toProtocolPath(
    snapshot,
    capability,
    elementId,
    parentImmerPath,
  );
  const parent = getValueAtImmerPath(
    getElementValue(snapshot, capability, elementId),
    parentImmerPath,
  );

  if (patch.op === "add") {
    if (Array.isArray(parent)) {
      if (typeof target !== "number")
        throw new Error("Array add patch has no index");
      const operation: Operation = {
        type: "insert",
        capability,
        elementId,
        path: parentPath,
        target: { kind: "array", index: target, itemId: crypto.randomUUID() },
        ...createOperationValue(patch.value as JsonValue),
      };
      return { operation, next: applyRecordedOperation(snapshot, operation) };
    }
    if (typeof target !== "string")
      throw new Error("Object add patch has no key");
    const operation: Operation = {
      type: "insert",
      capability,
      elementId,
      path: parentPath,
      target: { kind: "object", key: target },
      ...createOperationValue(patch.value as JsonValue),
    };
    return { operation, next: applyRecordedOperation(snapshot, operation) };
  }

  if (Array.isArray(parent)) {
    if (typeof target !== "number")
      throw new Error("Array remove patch has no index");
    const itemIds = findArrayItemIds(
      snapshot,
      capability,
      elementId,
      parentPath,
    );
    const operation: Operation = {
      type: "remove",
      capability,
      elementId,
      path: parentPath,
      target: { kind: "array", itemId: itemIds[target] },
    };
    return { operation, next: applyRecordedOperation(snapshot, operation) };
  }
  if (typeof target !== "string")
    throw new Error("Object remove patch has no key");
  const operation: Operation = {
    type: "remove",
    capability,
    elementId,
    path: parentPath,
    target: { kind: "object", key: target },
  };
  return { operation, next: applyRecordedOperation(snapshot, operation) };
};

/**
 * Records a setData mutation without changing the input snapshot.
 * Callback return values are ignored, matching the current runtime contract.
 * Value-form root sets may change shape between object, array, and primitive.
 */
export const recordMutation = <Value extends JsonValue>(
  snapshot: RoomSnapshot,
  capability: string,
  elementId: string,
  mutator: Value | MutationCallback<Value>,
): RecordedMutation => {
  if (typeof mutator !== "function") {
    const operation: Operation = {
      type: "set",
      capability,
      elementId,
      path: [],
      ...createOperationValue(mutator as JsonValue),
    };
    return {
      ops: [operation],
      next: applyRecordedOperation(snapshot, operation),
    };
  }

  const initialValue = getElementValue(snapshot, capability, elementId);
  const intent: MutationIntent = {
    structuralArrays: new Map(),
    numericReads: new Set(),
    increments: new Map(),
  };
  const [finalValue, patches] = produceJsonWithPatches(initialValue, (draft) => {
    mutator(
      createTrackingDraft(draft, [], intent, (path) => {
        try {
          const protocolPath = toProtocolPath(
            snapshot,
            capability,
            elementId,
            path,
          );
          return findArrayItemIds(
            snapshot,
            capability,
            elementId,
            protocolPath,
          );
        } catch {
          return undefined;
        }
      }) as Draft<Value>,
    );
  });
  const structuralArrays = [...intent.structuralArrays.values()];
  const structuralPaths = structuralArrays.map((mutation) => mutation.path);
  const ops: Operation[] = [];
  let working = snapshot;

  for (const mutation of structuralArrays) {
    const recorded = recordStructuralArray(
      working,
      capability,
      elementId,
      mutation,
      finalValue as JsonValue,
    );
    ops.push(...recorded.ops);
    working = recorded.next;
  }

  for (const patch of patches) {
    if (isCoveredStructuralArrayPatch(patch, structuralPaths)) continue;
    const recorded = recordPatch(
      working,
      capability,
      elementId,
      patch,
      intent.increments,
    );
    if (!recorded) continue;
    ops.push(recorded.operation);
    working = recorded.next;
  }

  return { ops, next: working };
};
