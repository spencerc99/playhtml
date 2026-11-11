// ABOUTME: Checks that extracting shared play subtrees matches a full SyncedStore walk.
// ABOUTME: Uses real SyncedStore docs shaped like playhtml rooms, including edge cases.
import { describe, expect, it, mock } from "bun:test";
import { getYjsValue, syncedStore } from "@syncedstore/core";
import * as Y from "yjs";

mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      readonly ctx: unknown,
      readonly env: unknown,
    ) {}
  },
  env: {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_KEY: "test-supabase-key",
    ADMIN_TOKEN: "test-admin-token",
    PARTYKIT_BRIDGE_SECRET: "test-bridge-secret",
    Main: {},
  },
}));

const { PartyServer } = await import("../party");

// Reference extraction: bind SyncedStore and walk every element of every tag.
function referenceExtract(
  doc: Y.Doc,
  elementIds: Set<string>,
): Record<string, Record<string, any>> {
  const result: Record<string, Record<string, any>> = {};
  const store = syncedStore<{ play: Record<string, any> }>({ play: {} }, doc);
  const playY = getYjsValue(store.play) as unknown as Y.Map<any>;
  if (!playY) return result;
  playY.forEach((tagMap: any, tag: string) => {
    if (!(tagMap instanceof Y.Map)) return;
    const outForTag: Record<string, any> = {};
    tagMap.forEach((val: any, elementId: string) => {
      if (!elementIds.has(elementId)) return;
      const plain = typeof val?.toJSON === "function" ? val.toJSON() : val;
      outForTag[elementId] = plain;
    });
    if (Object.keys(outForTag).length) {
      result[tag] = outForTag;
    }
  });
  return result;
}

const server = Object.create(PartyServer.prototype);

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  const store = syncedStore<{ play: Record<string, any> }>({ play: {} }, doc);
  doc.transact(() => {
    store.play["can-play"] = {
      lamp: { on: false },
      guestbook: { entries: [{ name: "a", at: 1 }, { name: "b" }] },
      counter: 3,
      label: "hello",
      nothing: null,
      shared: { nested: { deep: [1, [2, 3]] } },
    };
    store.play["can-move"] = { sign: { x: 0, y: 0 }, shared: { x: 4, y: 5 } };
    store.play["can-toggle"] = { lamp: true, gone: false };
    store.play["empty-tag"] = {};
  });
  doc.transact(() => {
    delete store.play["can-toggle"].gone;
    store.play["can-play"].guestbook.entries.push({ name: "c" });
  });
  // Raw Yjs shapes a SyncedStore client would not write but a room may hold.
  const play = doc.getMap("play");
  play.set("not-a-map", 42);
  (play.get("can-play") as Y.Map<any>).set("raw-undefined", undefined);
  const text = new Y.Text();
  text.insert(0, "typed");
  (play.get("can-move") as Y.Map<any>).set("text", text);
  return doc;
}

const idSets: string[][] = [
  [],
  ["lamp"],
  ["shared"],
  ["gone"],
  ["missing"],
  ["raw-undefined", "nothing", "counter"],
  ["text", "sign", "guestbook", "label"],
  ["lamp", "shared", "sign", "gone", "missing", "not-a-map", "empty-tag"],
];

describe("extractPlaySubtrees", () => {
  for (const ids of idSets) {
    it(`matches the full walk for [${ids.join(", ")}]`, () => {
      const doc = makeDoc();
      const expected = referenceExtract(doc, new Set(ids));
      const actual = server.extractPlaySubtrees(doc, new Set(ids));
      expect(actual).toEqual(expected);
      expect(Object.keys(actual)).toEqual(Object.keys(expected));
      for (const tag of Object.keys(expected)) {
        expect(new Set(Object.keys(actual[tag]))).toEqual(
          new Set(Object.keys(expected[tag])),
        );
      }
    });
  }

  it("matches the full walk on a document synced from another client", () => {
    const source = makeDoc();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
    const ids = new Set(["lamp", "shared", "text", "raw-undefined"]);
    expect(server.extractPlaySubtrees(doc, ids)).toEqual(
      referenceExtract(doc, ids),
    );
  });

  it("returns nothing for a document without play data", () => {
    const doc = new Y.Doc();
    expect(server.extractPlaySubtrees(doc, new Set(["lamp"]))).toEqual({});
    expect(referenceExtract(doc, new Set(["lamp"]))).toEqual({});
  });
});
