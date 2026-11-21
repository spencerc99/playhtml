// ABOUTME: Verifies that a room snapshot survives being packed for saving and unpacked on load.
// ABOUTME: Covers reordered object keys, nested and empty arrays, and operations addressed by item IDs issued before the save.

import { describe, expect, it } from "vitest";
import { applyOperation, checkSnapshotIntegrity } from "../engine";
import type {
  ArrayIdentity,
  JsonValue,
  PackedSnapshot,
  RoomSnapshot,
} from "../index";
import { packSnapshot, unpackSnapshot } from "../packed";

const snapshot = (): RoomSnapshot => ({
  state: {
    play: {
      board: {
        b: [{ name: "b0", tags: ["x", "y"] }, { name: "b1", tags: [] }],
        "10": ["ten"],
        "2": [],
        a: { deep: [["inner-0", "inner-1"], []] },
      },
      list: ["top-0", "top-1"],
    },
    "can-move": { piece: { x: 1, y: 2 } },
  },
  arrays: [
    { capability: "play", elementId: "list", path: [], itemIds: ["L0", "L1"] },
    { capability: "play", elementId: "board", path: ["b"], itemIds: ["B0", "B1"] },
    {
      capability: "play",
      elementId: "board",
      path: ["b", { itemId: "B0" }, "tags"],
      itemIds: ["T0", "T1"],
    },
    {
      capability: "play",
      elementId: "board",
      path: ["b", { itemId: "B1" }, "tags"],
      itemIds: [],
    },
    { capability: "play", elementId: "board", path: ["10"], itemIds: ["N0"] },
    { capability: "play", elementId: "board", path: ["2"], itemIds: [] },
    {
      capability: "play",
      elementId: "board",
      path: ["a", "deep"],
      itemIds: ["D0", "D1"],
    },
    {
      capability: "play",
      elementId: "board",
      path: ["a", "deep", { itemId: "D0" }],
      itemIds: ["I0", "I1"],
    },
    {
      capability: "play",
      elementId: "board",
      path: ["a", "deep", { itemId: "D1" }],
      itemIds: [],
    },
  ],
  lastMutationIds: { writer: 3 },
});

/** Rebuilds every object with its keys in reverse order, as storage may. */
const withReversedKeys = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(withReversedKeys);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .reverse()
        .map((key) => [key, withReversedKeys(value[key])]),
    );
  }
  return value;
};

const byAddress = (arrays: readonly ArrayIdentity[]): string[] =>
  arrays.map((identity) => JSON.stringify(identity)).sort();

describe("packSnapshot and unpackSnapshot", () => {
  it("keeps only the state, a flat list of item IDs, and mutation IDs", () => {
    const packed = packSnapshot(snapshot());

    expect(Object.keys(packed).sort()).toEqual([
      "itemIds",
      "lastMutationIds",
      "state",
    ]);
    expect([...packed.itemIds].sort()).toEqual(
      ["B0", "B1", "D0", "D1", "I0", "I1", "L0", "L1", "N0", "T0", "T1"].sort(),
    );
    expect(packed.state).toEqual(snapshot().state);
    expect(packed.lastMutationIds).toEqual({ writer: 3 });
  });

  it("rebuilds every array identity after a JSON round trip", () => {
    const packed = JSON.parse(
      JSON.stringify(packSnapshot(snapshot())),
    ) as PackedSnapshot;
    const unpacked = unpackSnapshot(packed);

    expect(byAddress(unpacked.arrays)).toEqual(byAddress(snapshot().arrays));
    expect(checkSnapshotIntegrity(unpacked)).toEqual({ ok: true });
  });

  it("rebuilds the same identities when storage reorders object keys", () => {
    const packed = packSnapshot(snapshot());
    const reordered = withReversedKeys(
      JSON.parse(JSON.stringify(packed)) as JsonValue,
    ) as unknown as PackedSnapshot;
    const unpacked = unpackSnapshot(reordered);

    expect(byAddress(unpacked.arrays)).toEqual(byAddress(snapshot().arrays));
  });

  it("applies an operation addressed by an item ID issued before the save", () => {
    const reordered = withReversedKeys(
      JSON.parse(JSON.stringify(packSnapshot(snapshot()))) as JsonValue,
    ) as unknown as PackedSnapshot;
    const unpacked = unpackSnapshot(reordered);

    const renamed = applyOperation(unpacked, {
      type: "set",
      capability: "play",
      elementId: "board",
      path: ["b", { itemId: "B1" }, "name"],
      value: "renamed",
      arrays: [],
    });
    if (!renamed.ok) throw new Error(renamed.message);
    const removed = applyOperation(renamed.snapshot, {
      type: "remove",
      capability: "play",
      elementId: "board",
      path: ["a", "deep", { itemId: "D0" }],
      target: { kind: "array", itemId: "I0" },
    });
    if (!removed.ok) throw new Error(removed.message);
    const board = removed.snapshot.state.play.board as {
      b: Array<{ name: string }>;
      a: { deep: string[][] };
    };

    expect(board.b.map((item) => item.name)).toEqual(["b0", "renamed"]);
    expect(board.a.deep).toEqual([["inner-1"], []]);
    expect(checkSnapshotIntegrity(removed.snapshot)).toEqual({ ok: true });
  });

  it("packs to the same item ID order whatever the key order", () => {
    const original = snapshot();
    const reordered: RoomSnapshot = {
      ...original,
      state: withReversedKeys(original.state) as RoomSnapshot["state"],
    };

    expect(packSnapshot(reordered).itemIds).toEqual(
      packSnapshot(original).itemIds,
    );
  });

  it("refuses to pack a snapshot whose identities do not fit its arrays", () => {
    const original = snapshot();

    expect(() =>
      packSnapshot({ ...original, arrays: original.arrays.slice(1) }),
    ).toThrow("no item IDs for an array");
    expect(() =>
      packSnapshot({
        ...original,
        arrays: [
          ...original.arrays,
          { capability: "play", elementId: "gone", path: [], itemIds: [] },
        ],
      }),
    ).toThrow("not in it");
    expect(() =>
      packSnapshot({
        ...original,
        arrays: original.arrays.map((identity, index) =>
          index === 0 ? { ...identity, itemIds: ["L0"] } : identity,
        ),
      }),
    ).toThrow("1 item IDs for an array of 2");
    expect(() =>
      packSnapshot({
        ...original,
        arrays: [...original.arrays, original.arrays[0]],
      }),
    ).toThrow("two identity lists");
  });

  it("refuses to unpack item IDs that do not fit the arrays", () => {
    const packed = packSnapshot(snapshot());

    expect(() =>
      unpackSnapshot({ ...packed, itemIds: packed.itemIds.slice(1) }),
    ).toThrow("runs out of item IDs");
    expect(() =>
      unpackSnapshot({ ...packed, itemIds: [...packed.itemIds, "extra"] }),
    ).toThrow("1 item IDs left over");
    expect(() =>
      unpackSnapshot({
        state: { play: { list: ["a", "b"] } },
        itemIds: ["same", "same"],
        lastMutationIds: {},
      }),
    ).toThrow("repeats an item ID");
  });
});
