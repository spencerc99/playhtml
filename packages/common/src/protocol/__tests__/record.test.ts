// ABOUTME: Verifies translation of real setData mutation patterns into protocol operations.
// ABOUTME: Covers array methods, stable paths, numeric intent, and whole-value sets.

import { describe, expect, it } from "vitest";
import { checkSnapshotIntegrity } from "../engine";
import type { JsonValue, RoomSnapshot } from "../index";
import { recordMutation } from "../record";

type Data = {
  count: number;
  absolute: number;
  map: Record<string, JsonValue>;
  items: Array<{ name: string }>;
  optional?: { values: string[] };
};

const snapshot = (): RoomSnapshot => ({
  state: {
    play: {
      element: {
        count: 1,
        absolute: 1,
        map: { keep: true, remove: "me" },
        items: [{ name: "a" }, { name: "b" }, { name: "c" }],
      },
    },
  },
  arrays: [
    {
      capability: "play",
      elementId: "element",
      path: ["items"],
      itemIds: ["item-a", "item-b", "item-c"],
    },
  ],
  lastMutationIds: {},
});

const value = (result: { next: RoomSnapshot }): Data =>
  result.next.state.play.element as Data;

const expectIntegrity = (result: { next: RoomSnapshot }): void => {
  expect(checkSnapshotIntegrity(result.next)).toEqual({ ok: true });
};

describe("recordMutation", () => {
  it("records +=, -=, and postfix updates as increments", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.count += 3;
        draft.count -= 1;
        draft.count++;
      },
    );

    expect(result.ops).toEqual([
      {
        type: "increment",
        capability: "play",
        elementId: "element",
        path: ["count"],
        delta: 3,
      },
    ]);
    expect(value(result).count).toBe(4);
  });

  it("keeps absolute numeric assignments as sets", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.absolute = 10;
      },
    );

    expect(result.ops).toMatchObject([
      { type: "set", path: ["absolute"], value: 10 },
    ]);
  });

  it("records nested and computed-key assignments, deletion, and multiple writes", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.map.keep = false;
        draft.map.added = { nested: true };
        delete draft.map.remove;
        draft.absolute = 7;
      },
    );

    expect(result.ops.map((operation) => operation.type)).toEqual([
      "set",
      "insert",
      "remove",
      "set",
    ]);
    expect(value(result)).toMatchObject({
      map: { keep: false, added: { nested: true } },
      absolute: 7,
    });
  });

  it("records nullish initialization with nested array identities", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.optional ??= { values: [] };
      },
    );

    expect(result.ops).toMatchObject([
      {
        type: "insert",
        path: [],
        target: { kind: "object", key: "optional" },
        value: { values: [] },
        arrays: [{ path: ["values"], itemIds: [] }],
      },
    ]);
    expectIntegrity(result);
  });

  it("observes mutations delegated to a helper function", () => {
    const update = (draft: Data): void => {
      draft.map.helper = "called";
      draft.items.push({ name: "helper" });
    };
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        update(draft);
      },
    );

    expect(result.ops.map((operation) => operation.type)).toEqual([
      "insert",
      "insert",
    ]);
    expect(value(result).items.at(-1)).toEqual({ name: "helper" });
    expectIntegrity(result);
  });

  it("records push with multiple values as stable inserts", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.items.push({ name: "d" }, { name: "e" });
      },
    );

    expect(result.ops).toHaveLength(2);
    expect(result.ops).toEqual([
      expect.objectContaining({
        type: "insert",
        target: expect.objectContaining({ index: 3 }),
      }),
      expect.objectContaining({
        type: "insert",
        target: expect.objectContaining({ index: 4 }),
      }),
    ]);
    expect(value(result).items.map((item) => item.name)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("records unshift as an index-zero insert without replacing existing identities", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.items.unshift({ name: "first" });
      },
    );

    expect(result.ops).toEqual([
      expect.objectContaining({
        type: "insert",
        target: expect.objectContaining({ index: 0 }),
      }),
    ]);
    expect(result.next.arrays[0].itemIds.slice(1)).toEqual([
      "item-a",
      "item-b",
      "item-c",
    ]);
  });

  it("preserves unshift placement when the inserted value equals an existing item", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.items.unshift({ name: "a" });
      },
    );

    expect(result.ops).toEqual([
      expect.objectContaining({
        type: "insert",
        target: expect.objectContaining({ index: 0 }),
      }),
    ]);
    expect(result.next.arrays[0].itemIds[1]).toBe("item-a");
  });

  it("records insertion-only splice", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.items.splice(1, 0, { name: "inserted" });
      },
    );

    expect(result.ops).toEqual([
      expect.objectContaining({
        type: "insert",
        target: expect.objectContaining({ index: 1 }),
      }),
    ]);
    expect(value(result).items.map((item) => item.name)).toEqual([
      "a",
      "inserted",
      "b",
      "c",
    ]);
  });

  it("records removal-only splice by stable item ID", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.items.splice(1, 1);
      },
    );

    expect(result.ops).toEqual([
      expect.objectContaining({
        type: "remove",
        target: { kind: "array", itemId: "item-b" },
      }),
    ]);
    expect(value(result).items.map((item) => item.name)).toEqual(["a", "c"]);
  });

  it("records replacement splice as remove followed by insert", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.items.splice(1, 1, { name: "replacement" });
      },
    );

    expect(result.ops).toEqual([
      expect.objectContaining({
        type: "remove",
        target: { kind: "array", itemId: "item-b" },
      }),
      expect.objectContaining({
        type: "insert",
        target: expect.objectContaining({ kind: "array", index: 1 }),
      }),
    ]);
    expect(value(result).items.map((item) => item.name)).toEqual([
      "a",
      "replacement",
      "c",
    ]);
  });

  it("assigns a fresh identity when a splice replacement has the same value", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.items.splice(1, 1, { name: "b" });
      },
    );

    expect(result.ops).toEqual([
      expect.objectContaining({
        type: "remove",
        target: { kind: "array", itemId: "item-b" },
      }),
      expect.objectContaining({
        type: "insert",
        target: expect.objectContaining({ kind: "array", index: 1 }),
      }),
    ]);
    expect(result.next.arrays[0].itemIds[1]).not.toBe("item-b");
  });

  it("records full-array splice replacement as removes and inserts", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.items.splice(0, draft.items.length, { name: "x" }, { name: "y" });
      },
    );

    expect(result.ops.map((operation) => operation.type)).toEqual([
      "remove",
      "remove",
      "remove",
      "insert",
      "insert",
    ]);
    expect(value(result).items.map((item) => item.name)).toEqual(["x", "y"]);
  });

  it.each([
    ["shift", (draft: Data) => draft.items.shift(), "item-a", ["b", "c"]],
    ["pop", (draft: Data) => draft.items.pop(), "item-c", ["a", "b"]],
  ])("records %s as a stable removal", (_name, mutate, itemId, names) => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        mutate(draft);
      },
    );

    expect(result.ops).toEqual([
      expect.objectContaining({
        type: "remove",
        target: { kind: "array", itemId },
      }),
    ]);
    expect(value(result).items.map((item) => item.name)).toEqual(names);
  });

  it("records array index assignment as a set addressed by item ID", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.items[1] = { name: "updated" };
      },
    );

    expect(result.ops).toMatchObject([
      {
        type: "set",
        path: ["items", { itemId: "item-b" }],
        value: { name: "updated" },
      },
    ]);
    expect(result.next.arrays[0].itemIds).toEqual([
      "item-a",
      "item-b",
      "item-c",
    ]);
  });

  it("records length truncation as stable removals", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.items.length = 1;
      },
    );

    expect(result.ops).toHaveLength(2);
    expect(result.ops.every((operation) => operation.type === "remove")).toBe(
      true,
    );
    expect(value(result).items).toEqual([{ name: "a" }]);
  });

  it.each([
    ["object", { replaced: true }],
    ["array", [1, { nested: [] }]],
    ["primitive", false],
  ] as const)(
    "records a whole-root %s value-form replacement",
    (_name, replacement) => {
      const result = recordMutation(snapshot(), "play", "element", replacement);

      expect(result.ops).toMatchObject([
        { type: "set", path: [], value: replacement },
      ]);
      expect(result.next.state.play.element).toEqual(replacement);
      expectIntegrity(result);
    },
  );

  it("ignores callback return values exactly like the runtime contract", () => {
    const result = recordMutation<Data>(
      snapshot(),
      "play",
      "element",
      (draft) => {
        draft.map.keep = false;
        return { replaced: true };
      },
    );
    const returnOnly = recordMutation<number>(
      {
        state: { play: { element: 1 } },
        arrays: [],
        lastMutationIds: {},
      },
      "play",
      "element",
      () => 2,
    );

    expect(result.ops).toMatchObject([
      { type: "set", path: ["map", "keep"], value: false },
    ]);
    expect(returnOnly.ops).toEqual([]);
    expect(returnOnly.next.state.play.element).toBe(1);
  });
});
