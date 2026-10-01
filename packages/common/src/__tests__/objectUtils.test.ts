// ABOUTME: Verifies shared-object comparison and replacement avoid redundant writes.
// ABOUTME: Prevents bridge fanout from accumulating semantically empty Yjs history.
import { getYjsValue, syncedStore } from "@syncedstore/core";
import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import { deepReplaceIntoProxy } from "../objectUtils";

describe("deepReplaceIntoProxy", () => {
  test("does not create an update for reordered but equal data", () => {
    const doc = new Y.Doc();
    const store = syncedStore<{ value: Record<string, unknown> }>(
      { value: {} },
      doc,
    );
    store.value.project = { title: "same", members: ["a", "b"] };
    store.value.count = 2;
    const stateVector = Y.encodeStateVector(doc);

    doc.transact(() => {
      deepReplaceIntoProxy(store.value, {
        count: 2,
        project: { members: ["a", "b"], title: "same" },
      });
    });

    expect(Y.encodeStateAsUpdate(doc, stateVector)).toHaveLength(2);
    expect(getYjsValue(store.value)).toBeDefined();
    doc.destroy();
  });

  test("writes only the changed primitive into a larger subtree", () => {
    const doc = new Y.Doc();
    const store = syncedStore<{ value: Record<string, unknown> }>(
      { value: {} },
      doc,
    );
    store.value.unchanged = { members: ["a", "b"], count: 2 };
    store.value.changed = 1;
    const stateVector = Y.encodeStateVector(doc);

    doc.transact(() => {
      deepReplaceIntoProxy(store.value, {
        changed: 2,
        unchanged: { count: 2, members: ["a", "b"] },
      });
    });

    const update = Y.decodeUpdate(Y.encodeStateAsUpdate(doc, stateVector));
    expect(update.structs).toHaveLength(1);
    expect(store.value.changed).toBe(2);
    expect(store.value.unchanged).toEqual({ members: ["a", "b"], count: 2 });
    doc.destroy();
  });

  function listStore(initial: unknown[]) {
    const doc = new Y.Doc();
    const store = syncedStore<{ value: Record<string, any> }>({ value: {} }, doc);
    store.value.list = initial;
    return { doc, store };
  }

  test("an edited field inside one list item writes only that field", () => {
    const { doc, store } = listStore(
      Array.from({ length: 50 }, (_, id) => ({ id, votes: 0 })),
    );
    const stateVector = Y.encodeStateVector(doc);
    const next = Array.from({ length: 50 }, (_, id) => ({
      id,
      votes: id === 20 ? 1 : 0,
    }));

    doc.transact(() => deepReplaceIntoProxy(store.value, { list: next }));

    const update = Y.decodeUpdate(Y.encodeStateAsUpdate(doc, stateVector));
    expect(update.structs).toHaveLength(1);
    expect(update.ds.clients.size).toBe(1);
    expect(store.value.list).toEqual(next);
    doc.destroy();
  });

  test("appends, removals, and type changes produce the new array", () => {
    const cases: Array<[unknown[], unknown[]]> = [
      [["a", "b"], ["a", "b", "c"]],
      [["a", "b", "c", "d"], ["a", "d"]],
      [["a", "b", "c"], ["x", "a", "b", "c"]],
      [["a", "b", "b", "a"], ["a", "b", "a"]],
      [[{ k: 1 }, "s", [1, 2]], ["s", { k: 1 }, [1, 3]]],
      [[{ k: 1 }], [[1]]],
      [[1, 2, 3], []],
      [[], [{ nested: [{ deep: true }] }]],
      [[{ items: [1, 2] }], [{ items: [1, 2, 3] }]],
    ];
    for (const [before, after] of cases) {
      const { doc, store } = listStore(before);
      doc.transact(() => deepReplaceIntoProxy(store.value, { list: after }));
      expect(store.value.list).toEqual(after);

      // A client that only receives the update ends up with the same array.
      const replica = new Y.Doc();
      Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
      expect(replica.getMap("value").toJSON().list).toEqual(after);
      doc.destroy();
      replica.destroy();
    }
  });

  test("concurrent edits to different items both survive", () => {
    const initial = Array.from({ length: 5 }, (_, id) => ({ id, votes: 0 }));
    const { doc: first, store: firstStore } = listStore(initial);
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const secondStore = syncedStore<{ value: Record<string, any> }>(
      { value: {} },
      second,
    );

    first.transact(() =>
      deepReplaceIntoProxy(firstStore.value, {
        list: initial.map((item) => (item.id === 4 ? { ...item, votes: 1 } : item)),
      }),
    );
    second.transact(() =>
      deepReplaceIntoProxy(secondStore.value, {
        list: initial.filter((item) => item.id !== 1),
      }),
    );
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    const expected = [
      { id: 0, votes: 0 },
      { id: 2, votes: 0 },
      { id: 3, votes: 0 },
      { id: 4, votes: 1 },
    ];
    expect(firstStore.value.list).toEqual(expected);
    expect(secondStore.value.list).toEqual(expected);
    first.destroy();
    second.destroy();
  });

  function forkStore(doc: Y.Doc) {
    const fork = new Y.Doc();
    Y.applyUpdate(fork, Y.encodeStateAsUpdate(doc));
    const forkStore = syncedStore<{ value: Record<string, any> }>(
      { value: {} },
      fork,
    );
    return { fork, forkStore };
  }

  function exchange(a: Y.Doc, b: Y.Doc) {
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  }

  test("a concurrent reorder never moves another person's edit onto a different item", () => {
    const initial = [
      { id: "x", votes: 0 },
      { id: "y", votes: 0 },
    ];
    const { doc: sorter, store: sorterStore } = listStore(initial);
    const { fork: voter, forkStore: voterStore } = forkStore(sorter);

    sorter.transact(() =>
      deepReplaceIntoProxy(sorterStore.value, { list: [initial[1], initial[0]] }),
    );
    voter.transact(() =>
      deepReplaceIntoProxy(voterStore.value, {
        list: [{ id: "x", votes: 1 }, initial[1]],
      }),
    );
    exchange(sorter, voter);

    for (const list of [sorterStore.value.list, voterStore.value.list]) {
      const y = list.find((item: any) => item.id === "y");
      expect(y).toEqual({ id: "y", votes: 0 });
    }
    expect(sorterStore.value.list).toEqual(voterStore.value.list);
    sorter.destroy();
    voter.destroy();
  });

  test("reordered items without ids are replaced, not rewritten field by field", () => {
    const { doc, store } = listStore([{ name: "a" }, { name: "b" }]);
    const first = getYjsValue(store.value.list[0]);

    doc.transact(() =>
      deepReplaceIntoProxy(store.value, { list: [{ name: "b" }, { name: "a" }] }),
    );

    expect(store.value.list).toEqual([{ name: "b" }, { name: "a" }]);
    expect(getYjsValue(store.value.list[0])).not.toBe(first);
    doc.destroy();
  });

  test("a single changed item without an id is still edited in place", () => {
    const { doc, store } = listStore([{ name: "a", n: 1 }, { name: "b", n: 1 }]);
    const second = getYjsValue(store.value.list[1]);

    doc.transact(() =>
      deepReplaceIntoProxy(store.value, {
        list: [{ name: "a", n: 1 }, { name: "b", n: 2 }],
      }),
    );

    expect(getYjsValue(store.value.list[1])).toBe(second);
    expect(store.value.list[1]).toEqual({ name: "b", n: 2 });
    doc.destroy();
  });
});

