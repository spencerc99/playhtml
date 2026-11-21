// ABOUTME: Converts a room snapshot to and from the compact form that is saved and sent to clients.
// ABOUTME: The compact form keeps array item IDs in one list and leaves each array's address to be rebuilt from the room state.

import type {
  ArrayIdentity,
  JsonValue,
  PackedSnapshot,
  ProtocolPath,
  RoomSnapshot,
  RoomState,
} from "./index";

type ArrayVisitor = (
  capability: string,
  elementId: string,
  path: ProtocolPath,
  length: number,
) => readonly string[];

const isObject = (value: JsonValue): value is { [key: string]: JsonValue } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const addressKey = (
  capability: string,
  elementId: string,
  path: ProtocolPath,
): string => JSON.stringify([capability, elementId, path]);

const walkValue = (
  value: JsonValue,
  capability: string,
  elementId: string,
  path: ProtocolPath,
  visit: ArrayVisitor,
): void => {
  if (Array.isArray(value)) {
    const itemIds = visit(capability, elementId, path, value.length);
    value.forEach((item, index) => {
      walkValue(
        item,
        capability,
        elementId,
        [...path, { itemId: itemIds[index] }],
        visit,
      );
    });
    return;
  }
  if (isObject(value)) {
    for (const key of Object.keys(value).sort()) {
      walkValue(value[key], capability, elementId, [...path, key], visit);
    }
  }
};

/**
 * Visits every array in a room state: an array before the arrays inside its
 * items, and object keys in sorted order. Sorting makes the order depend only
 * on the data, not on the key order an object happens to have, which a
 * database or a JSON round trip may change. The visitor returns the array's
 * item IDs, which become the path segments of the arrays inside it.
 */
const walkArrays = (state: RoomState, visit: ArrayVisitor): void => {
  for (const capability of Object.keys(state).sort()) {
    const elements = state[capability];
    for (const elementId of Object.keys(elements).sort()) {
      walkValue(elements[elementId], capability, elementId, [], visit);
    }
  }
};

/** Drops array addresses from a snapshot, keeping item IDs in walk order. */
export const packSnapshot = (snapshot: RoomSnapshot): PackedSnapshot => {
  const identities = new Map<string, ArrayIdentity>();
  for (const identity of snapshot.arrays) {
    identities.set(
      addressKey(identity.capability, identity.elementId, identity.path),
      identity,
    );
  }
  if (identities.size !== snapshot.arrays.length) {
    throw new Error("Snapshot has two identity lists for one array");
  }

  const itemIds: string[] = [];
  let visited = 0;
  walkArrays(snapshot.state, (capability, elementId, path, length) => {
    const identity = identities.get(addressKey(capability, elementId, path));
    if (!identity) {
      throw new Error(
        `Snapshot has no item IDs for an array in ${capability}/${elementId}`,
      );
    }
    if (identity.itemIds.length !== length) {
      throw new Error(
        `Snapshot has ${identity.itemIds.length} item IDs for an array of ${length} in ${capability}/${elementId}`,
      );
    }
    visited += 1;
    for (const itemId of identity.itemIds) itemIds.push(itemId);
    return identity.itemIds;
  });
  if (visited !== snapshot.arrays.length) {
    throw new Error("Snapshot has item IDs for an array that is not in it");
  }

  return {
    state: snapshot.state,
    itemIds,
    lastMutationIds: snapshot.lastMutationIds,
  };
};

/**
 * Rebuilds array addresses for a packed snapshot. Throws when the item IDs do
 * not fit the arrays in the state exactly.
 */
export const unpackSnapshot = (packed: PackedSnapshot): RoomSnapshot => {
  const arrays: ArrayIdentity[] = [];
  let next = 0;
  walkArrays(packed.state, (capability, elementId, path, length) => {
    if (next + length > packed.itemIds.length) {
      throw new Error(
        `Packed snapshot runs out of item IDs in ${capability}/${elementId}`,
      );
    }
    const itemIds = packed.itemIds.slice(next, next + length);
    next += length;
    if (new Set(itemIds).size !== itemIds.length) {
      throw new Error(
        `Packed snapshot repeats an item ID within an array in ${capability}/${elementId}`,
      );
    }
    arrays.push({ capability, elementId, path, itemIds });
    return itemIds;
  });
  if (next !== packed.itemIds.length) {
    throw new Error(
      `Packed snapshot has ${packed.itemIds.length - next} item IDs left over`,
    );
  }

  return {
    state: packed.state,
    arrays,
    lastMutationIds: packed.lastMutationIds,
  };
};
