// ABOUTME: Verifies that bridge fan-out narrows Yjs transactions to the play elements they touched.
// ABOUTME: Uses real SyncedStore docs shaped like playhtml rooms.
import { describe, expect, it } from "bun:test";
import { syncedStore } from "@syncedstore/core";
import * as Y from "yjs";
import {
  AllElements,
  collectChangedPlayElementIds,
  touchesAny,
} from "../bridgeDirty";

function makeRoom() {
  const doc = new Y.Doc();
  const store = syncedStore<{ play: Record<string, any>; pageData: any }>(
    { play: {}, pageData: {} },
    doc,
  );
  doc.transact(() => {
    store.play["can-play"] = {
      "wordmark-colors": { h: "hsl(1 50% 40%)" },
      lamp: { on: false },
      guestbook: { entries: [{ name: "a" }] },
    };
    store.play["can-move"] = { sign: { x: 0, y: 0 } };
  });
  return { doc, store, playMap: doc.getMap("play") };
}

function changedBy(doc: Y.Doc, playMap: Y.Map<unknown>, fn: () => void) {
  let changed = new Set<string>();
  const listener = (tr: Y.Transaction) => {
    changed = collectChangedPlayElementIds(tr, playMap, changed);
  };
  doc.on("afterTransaction", listener);
  doc.transact(fn);
  doc.off("afterTransaction", listener);
  return changed;
}

describe("collectChangedPlayElementIds", () => {
  it("names the element whose nested value changed", () => {
    const { doc, store, playMap } = makeRoom();
    const changed = changedBy(doc, playMap, () => {
      store.play["can-play"]["wordmark-colors"].m = "hsl(2 50% 40%)";
    });
    expect([...changed]).toEqual(["wordmark-colors"]);
  });

  it("names an element changed deep inside an array", () => {
    const { doc, store, playMap } = makeRoom();
    const changed = changedBy(doc, playMap, () => {
      store.play["can-play"].guestbook.entries.push({ name: "b" });
    });
    expect([...changed]).toEqual(["guestbook"]);
  });

  it("names an element set directly on its tag map", () => {
    const { doc, store, playMap } = makeRoom();
    const changed = changedBy(doc, playMap, () => {
      store.play["can-move"].couch = { x: 1, y: 1 };
    });
    expect([...changed]).toEqual(["couch"]);
  });

  it("ignores changes to other elements and to page data", () => {
    const { doc, store, playMap } = makeRoom();
    const changed = changedBy(doc, playMap, () => {
      store.play["can-move"].sign.x = 5;
      store.pageData.visits = 3;
    });
    expect(changed.has("wordmark-colors")).toBe(false);
    expect([...changed]).toEqual(["sign"]);
  });

  it("reports nothing for changes outside the play map", () => {
    const { doc, store, playMap } = makeRoom();
    const changed = changedBy(doc, playMap, () => {
      store.pageData.visits = 4;
    });
    expect(changed.size).toBe(0);
  });

  it("falls back to everything when a tag map is replaced", () => {
    const { doc, store, playMap } = makeRoom();
    const changed = changedBy(doc, playMap, () => {
      store.play["can-toggle"] = { light: true };
    });
    expect(changed.has(AllElements)).toBe(true);
  });

  it("sees changes that arrive as remote updates", () => {
    const { doc, store, playMap } = makeRoom();
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    const remoteStore = syncedStore<{ play: Record<string, any> }>(
      { play: {} },
      remote,
    );
    let update: Uint8Array | null = null;
    remote.on("update", (u: Uint8Array) => {
      update = u;
    });
    remoteStore.play["can-play"].lamp.on = true;
    expect(store.play["can-play"].lamp.on).toBe(false);

    let changed = new Set<string>();
    doc.on("afterTransaction", (tr: Y.Transaction) => {
      changed = collectChangedPlayElementIds(tr, playMap, changed);
    });
    Y.applyUpdate(doc, update!);
    expect([...changed]).toEqual(["lamp"]);
  });
});

describe("touchesAny", () => {
  it("matches only listed ids unless everything changed", () => {
    expect(touchesAny(new Set(["lamp"]), ["wordmark-colors"])).toBe(false);
    expect(touchesAny(new Set(["lamp"]), ["lamp", "x"])).toBe(true);
    expect(touchesAny(new Set([AllElements]), ["x"])).toBe(true);
  });
});
