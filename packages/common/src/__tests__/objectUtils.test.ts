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
});
