// ABOUTME: Verifies version 2 operation application and rejection semantics.
// ABOUTME: Exercises stable array identities and snapshot integrity invariants.

import { describe, expect, it } from "vitest";
import {
  applyOperation,
  applyOperationInPlace,
  checkSnapshotIntegrity,
} from "../engine";
import type { Operation, RoomSnapshot } from "../index";

const snapshot = (): RoomSnapshot => ({
  state: {
    play: {
      element: {
        count: 2,
        label: "ready",
        object: { occupied: { value: 1 } },
        list: [
          { name: "a", tags: ["one"] },
          { name: "b", tags: [] },
        ],
      },
    },
  },
  arrays: [
    {
      capability: "play",
      elementId: "element",
      path: ["list"],
      itemIds: ["item-a", "item-b"],
    },
    {
      capability: "play",
      elementId: "element",
      path: ["list", { itemId: "item-a" }, "tags"],
      itemIds: ["tag-one"],
    },
    {
      capability: "play",
      elementId: "element",
      path: ["list", { itemId: "item-b" }, "tags"],
      itemIds: [],
    },
  ],
  lastMutationIds: { client: 4 },
});

const address = {
  capability: "play",
  elementId: "element",
};

const apply = (input: RoomSnapshot, operation: Operation): RoomSnapshot => {
  const result = applyOperation(input, operation);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.snapshot;
};

describe("applyOperation", () => {
  it("replaces a nested value without mutating the input", () => {
    const input = snapshot();
    const next = apply(input, {
      type: "set",
      ...address,
      path: ["label"],
      value: "done",
      arrays: [],
    });

    expect(next.state.play.element).toMatchObject({ label: "done" });
    expect(input.state.play.element).toMatchObject({ label: "ready" });
    expect(next).not.toBe(input);
  });

  it("does not alias the touched element across any operation type", () => {
    const operations: Operation[] = [
      {
        type: "set",
        ...address,
        path: ["label"],
        value: "done",
        arrays: [],
      },
      {
        type: "insert",
        ...address,
        path: ["object"],
        target: { kind: "object", key: "added" },
        value: true,
        arrays: [],
      },
      {
        type: "remove",
        ...address,
        path: ["list"],
        target: { kind: "array", itemId: "item-b" },
      },
      {
        type: "increment",
        ...address,
        path: ["count"],
        delta: 1,
      },
    ];

    for (const operation of operations) {
      const input = snapshot();
      const before = structuredClone(input);
      const next = apply(input, operation);
      const nextObject = (
        next.state.play.element as {
          object: { occupied: { value: number } };
        }
      ).object;
      nextObject.occupied.value = 99;

      expect(input).toEqual(before);
    }
  });

  it("preserves a retained snapshot through later operations", () => {
    const retained = apply(snapshot(), {
      type: "set",
      ...address,
      path: ["label"],
      value: "retained",
      arrays: [],
    });
    const retainedValue = structuredClone(retained);
    let current = retained;

    for (let index = 0; index < 10; index += 1) {
      current = apply(current, {
        type: "increment",
        ...address,
        path: ["count"],
        delta: 1,
      });
    }

    expect(retained).toEqual(retainedValue);
    expect((current.state.play.element as { count: number }).count).toBe(12);
  });

  it("replaces whole values and installs identities for every nested array", () => {
    const next = apply(snapshot(), {
      type: "set",
      ...address,
      path: [],
      value: { groups: [["x"]] },
      arrays: [
        { path: ["groups"], itemIds: ["group"] },
        { path: ["groups", { itemId: "group" }], itemIds: ["x"] },
      ],
    });

    expect(next.state.play.element).toEqual({ groups: [["x"]] });
    expect(next.arrays).toHaveLength(2);
    expect(checkSnapshotIntegrity(next)).toEqual({ ok: true });
  });

  it("increments finite numeric targets", () => {
    const next = apply(snapshot(), {
      type: "increment",
      ...address,
      path: ["count"],
      delta: 3,
    });

    expect(next.state.play.element).toMatchObject({ count: 5 });
  });

  it.each([
    ["a non-numeric target", ["label"] as const, 1],
    ["a non-finite delta", ["count"] as const, Number.POSITIVE_INFINITY],
  ])("rejects %s", (_label, path, delta) => {
    const result = applyOperation(snapshot(), {
      type: "increment",
      ...address,
      path,
      delta,
    });

    expect(result).toMatchObject({ ok: false, code: "invalid-operation" });
  });

  it("rejects a non-finite increment result", () => {
    const input = snapshot();
    (input.state.play.element as { count: number }).count = Number.MAX_VALUE;

    expect(
      applyOperation(input, {
        type: "increment",
        ...address,
        path: ["count"],
        delta: Number.MAX_VALUE,
      }),
    ).toMatchObject({ ok: false, code: "invalid-operation" });
  });

  it("inserts an unoccupied object key", () => {
    const next = apply(snapshot(), {
      type: "insert",
      ...address,
      path: ["object"],
      target: { kind: "object", key: "added" },
      value: [1],
      arrays: [{ path: [], itemIds: ["nested-item"] }],
    });

    expect(next.state.play.element).toMatchObject({ object: { added: [1] } });
    expect(checkSnapshotIntegrity(next)).toEqual({ ok: true });
  });

  it("rejects occupied object keys except identical retries", () => {
    const operation: Operation = {
      type: "insert",
      ...address,
      path: ["object"],
      target: { kind: "object", key: "retry" },
      value: { values: [1] },
      arrays: [{ path: ["values"], itemIds: ["nested"] }],
    };
    const inserted = apply(snapshot(), operation);
    const retry = applyOperation(inserted, operation);
    const collision = applyOperation(inserted, {
      ...operation,
      value: { values: [2] },
    });

    expect(retry).toEqual({ ok: true, snapshot: inserted });
    expect(collision).toMatchObject({ ok: false, code: "invalid-operation" });
  });

  it("inserts arrays by index and falls back to the end after shrinkage", () => {
    const first = apply(snapshot(), {
      type: "insert",
      ...address,
      path: ["list"],
      target: { kind: "array", index: 1, itemId: "item-middle" },
      value: { name: "middle", tags: [] },
      arrays: [{ path: ["tags"], itemIds: [] }],
    });
    const next = apply(first, {
      type: "insert",
      ...address,
      path: ["list"],
      target: { kind: "array", index: 99, itemId: "item-end" },
      value: { name: "end", tags: [] },
      arrays: [{ path: ["tags"], itemIds: [] }],
    });

    expect(
      (next.state.play.element as { list: Array<{ name: string }> }).list,
    ).toEqual([
      expect.objectContaining({ name: "a" }),
      expect.objectContaining({ name: "middle" }),
      expect.objectContaining({ name: "b" }),
      expect.objectContaining({ name: "end" }),
    ]);
    expect(
      next.arrays.find((identity) => identity.path[0] === "list")?.itemIds,
    ).toEqual(["item-a", "item-middle", "item-b", "item-end"]);
    expect(checkSnapshotIntegrity(next)).toEqual({ ok: true });
  });

  it("treats identical array item retries as no-ops and rejects ID collisions", () => {
    const operation: Operation = {
      type: "insert",
      ...address,
      path: ["list"],
      target: { kind: "array", index: 2, itemId: "item-c" },
      value: { name: "c", tags: [] },
      arrays: [{ path: ["tags"], itemIds: [] }],
    };
    const inserted = apply(snapshot(), operation);

    expect(applyOperation(inserted, operation)).toEqual({
      ok: true,
      snapshot: inserted,
    });
    expect(
      applyOperation(inserted, {
        ...operation,
        value: { name: "changed", tags: [] },
      }),
    ).toMatchObject({ ok: false, code: "invalid-operation" });
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid array insert index %s",
    (index) => {
      expect(
        applyOperation(snapshot(), {
          type: "insert",
          ...address,
          path: ["list"],
          target: { kind: "array", index, itemId: "invalid-index" },
          value: null,
          arrays: [],
        }),
      ).toMatchObject({ ok: false, code: "invalid-operation" });
    },
  );

  it("removes object keys and array items by stable ID with nested metadata", () => {
    const objectRemoved = apply(snapshot(), {
      type: "remove",
      ...address,
      path: ["object"],
      target: { kind: "object", key: "occupied" },
    });
    const arrayRemoved = apply(objectRemoved, {
      type: "remove",
      ...address,
      path: ["list"],
      target: { kind: "array", itemId: "item-a" },
    });

    expect(arrayRemoved.state.play.element).toMatchObject({
      object: {},
      list: [{ name: "b", tags: [] }],
    });
    expect(arrayRemoved.arrays).toHaveLength(2);
    expect(checkSnapshotIntegrity(arrayRemoved)).toEqual({ ok: true });
  });

  it("treats missing remove targets as idempotent no-ops", () => {
    const objectResult = applyOperation(snapshot(), {
      type: "remove",
      ...address,
      path: ["object"],
      target: { kind: "object", key: "missing" },
    });
    const arrayResult = applyOperation(snapshot(), {
      type: "remove",
      ...address,
      path: ["list"],
      target: { kind: "array", itemId: "missing" },
    });

    expect(objectResult).toEqual({ ok: true, snapshot: snapshot() });
    expect(arrayResult).toEqual({ ok: true, snapshot: snapshot() });
  });

  it.each([
    ["missing path", ["missing", "child"] as const],
    ["wrong object traversal", ["label", "child"] as const],
    ["wrong array traversal", ["list", "0"] as const],
    ["missing stable item", ["list", { itemId: "missing" }, "name"] as const],
  ])("rejects traversal through a %s", (_label, path) => {
    expect(
      applyOperation(snapshot(), {
        type: "set",
        ...address,
        path,
        value: "x",
        arrays: [],
      }),
    ).toMatchObject({ ok: false, code: "invalid-operation" });
  });

  it("rejects operation values whose array identities are incomplete", () => {
    expect(
      applyOperation(snapshot(), {
        type: "set",
        ...address,
        path: ["label"],
        value: ["x"],
        arrays: [],
      }),
    ).toMatchObject({ ok: false, code: "invalid-operation" });
  });

  it("reports sidecar length, duplicate ID, missing identity, and extra identity errors", () => {
    const lengthMismatch = snapshot();
    lengthMismatch.arrays[0].itemIds = ["item-a"];
    const duplicateId = snapshot();
    duplicateId.arrays[0].itemIds = ["item-a", "item-a"];
    const missingIdentity = snapshot();
    missingIdentity.arrays = missingIdentity.arrays.slice(1);
    const extraIdentity = snapshot();
    extraIdentity.arrays = [
      ...extraIdentity.arrays,
      { ...address, path: ["ghost"], itemIds: [] },
    ];

    expect(checkSnapshotIntegrity(lengthMismatch).ok).toBe(false);
    expect(checkSnapshotIntegrity(duplicateId).ok).toBe(false);
    expect(checkSnapshotIntegrity(missingIdentity).ok).toBe(false);
    expect(checkSnapshotIntegrity(extraIdentity).ok).toBe(false);
  });
});

describe("applyOperationInPlace", () => {
  it("replaces only the touched element inside stable room containers", () => {
    const input = snapshot();
    input.state.play.sibling = { count: 10 };
    const state = input.state;
    const capability = input.state.play;
    const arrays = input.arrays;
    const touched = input.state.play.element;
    const sibling = input.state.play.sibling;

    const result = applyOperationInPlace(
      input,
      {
        type: "increment",
        ...address,
        path: ["count"],
        delta: 1,
      },
      { validate: true },
    );

    expect(result).toEqual({ ok: true, snapshot: input });
    expect(result.ok && result.snapshot).toBe(input);
    expect(input.state).toBe(state);
    expect(input.state.play).toBe(capability);
    expect(input.arrays).toBe(arrays);
    expect(input.state.play.element).not.toBe(touched);
    expect(input.state.play.sibling).toBe(sibling);
    expect(input.state.play.element).toMatchObject({ count: 3 });
    expect(checkSnapshotIntegrity(input)).toEqual({ ok: true });
  });

  it("rolls back the value and sidecars when an operation is rejected", () => {
    const input = snapshot();
    const before = structuredClone(input);
    const element = input.state.play.element;
    const arrays = input.arrays;
    const identities = [...input.arrays];

    const result = applyOperationInPlace(input, {
      type: "insert",
      ...address,
      path: ["list"],
      target: { kind: "array", index: 0, itemId: "item-a" },
      value: { name: "collision", tags: [] },
      arrays: [{ path: ["tags"], itemIds: [] }],
    });

    expect(result).toMatchObject({ ok: false, code: "invalid-operation" });
    expect(input).toEqual(before);
    expect(input.state.play.element).toBe(element);
    expect(input.arrays).toBe(arrays);
    expect(input.arrays).toEqual(identities);
    input.arrays.forEach((identity, index) => {
      expect(identity).toBe(identities[index]);
    });
  });
});

describe("new element creation", () => {
  const emptySnapshot = (): RoomSnapshot => ({
    state: {},
    arrays: [],
    lastMutationIds: {},
  });

  it("root set creates the capability bucket and element", () => {
    const result = applyOperation(emptySnapshot(), {
      type: "set",
      capability: "can-toggle",
      elementId: "lamp",
      path: [],
      value: { on: false },
      arrays: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.state["can-toggle"]?.lamp).toEqual({ on: false });
      expect(checkSnapshotIntegrity(result.snapshot).ok).toBe(true);
    }
  });

  it("root set on a new element installs array identities", () => {
    const result = applyOperation(emptySnapshot(), {
      type: "set",
      capability: "can-play",
      elementId: "guestbook",
      path: [],
      value: { entries: ["hi"] },
      arrays: [{ path: ["entries"], itemIds: ["item-1"] }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(checkSnapshotIntegrity(result.snapshot).ok).toBe(true);
      expect(result.snapshot.arrays).toHaveLength(1);
    }
  });

  it("non-root operations on a missing element are rejected", () => {
    for (const operation of [
      {
        type: "set",
        capability: "can-play",
        elementId: "ghost",
        path: ["field"],
        value: 1,
        arrays: [],
      },
      {
        type: "increment",
        capability: "can-play",
        elementId: "ghost",
        path: ["count"],
        delta: 1,
      },
    ] as const) {
      const result = applyOperation(emptySnapshot(), operation);
      expect(result.ok).toBe(false);
    }
  });
});
