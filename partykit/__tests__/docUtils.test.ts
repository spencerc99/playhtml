// ABOUTME: Verifies Y.Doc snapshot relationship helpers with real encoded updates.
// ABOUTME: Covers compaction safety checks that depend on live-vs-persisted history.
import { describe, expect, it } from "bun:test";
import { syncedStore } from "@syncedstore/core";
import * as Y from "yjs";
import {
  documentContainsSnapshot,
  encodeDocToBase64,
  jsonToDoc,
  replaceDocState,
} from "../docUtils";

function attendancePlayData(names: string[]): Record<string, any> {
  return {
    "can-play": {
      "week-attendance": {
        attendees: names.map((name) => ({
          pid: name.toLowerCase(),
          name,
        })),
      },
    },
  };
}

function cloneDoc(doc: Y.Doc): Y.Doc {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
  return clone;
}

describe("documentContainsSnapshot", () => {
  it("recognizes a live document that contains the persisted snapshot", () => {
    const liveDoc = jsonToDoc(attendancePlayData(["Ada"]));
    const persistedBase64 = encodeDocToBase64(liveDoc);

    replaceDocState(liveDoc, attendancePlayData(["Ada", "Ben"]));

    expect(
      documentContainsSnapshot(encodeDocToBase64(liveDoc), persistedBase64),
    ).toBe(true);
  });

  it("rejects a stale live document that is missing persisted updates", () => {
    const liveDoc = jsonToDoc(attendancePlayData(["Ada"]));
    const persistedDoc = jsonToDoc(attendancePlayData(["Ada", "Ben"]));

    expect(
      documentContainsSnapshot(
        encodeDocToBase64(liveDoc),
        encodeDocToBase64(persistedDoc),
      ),
    ).toBe(false);
  });

  it("rejects forked documents that each contain unique updates", () => {
    const baseDoc = jsonToDoc(attendancePlayData(["Ada"]));
    const liveDoc = cloneDoc(baseDoc);
    const persistedDoc = cloneDoc(baseDoc);

    replaceDocState(liveDoc, attendancePlayData(["Ada", "Ben"]));
    replaceDocState(persistedDoc, attendancePlayData(["Ada", "Cam"]));

    expect(
      documentContainsSnapshot(
        encodeDocToBase64(liveDoc),
        encodeDocToBase64(persistedDoc),
      ),
    ).toBe(false);
    expect(
      documentContainsSnapshot(
        encodeDocToBase64(persistedDoc),
        encodeDocToBase64(liveDoc),
      ),
    ).toBe(false);
  });

  it("rejects a snapshot whose deletion the live document has not applied", () => {
    const baseDoc = jsonToDoc(attendancePlayData(["Ada", "Ben"]));
    const liveDoc = cloneDoc(baseDoc);
    const persistedDoc = cloneDoc(baseDoc);
    const store = syncedStore<{ play: Record<string, any> }>(
      { play: {} },
      persistedDoc,
    );

    persistedDoc.transact(() => {
      store.play["can-play"]["week-attendance"].attendees.splice(1, 1);
    });

    expect(
      documentContainsSnapshot(
        encodeDocToBase64(liveDoc),
        encodeDocToBase64(persistedDoc),
      ),
    ).toBe(false);

    Y.applyUpdate(liveDoc, Y.encodeStateAsUpdate(persistedDoc));
    expect(
      documentContainsSnapshot(
        encodeDocToBase64(liveDoc),
        encodeDocToBase64(persistedDoc),
      ),
    ).toBe(true);
  });

  it("accepts identical documents that contain deletions", () => {
    const doc = jsonToDoc(attendancePlayData(["Ada"]));
    replaceDocState(doc, attendancePlayData(["Ada", "Ben"]));
    replaceDocState(doc, attendancePlayData(["Cam"]));
    const encoded = encodeDocToBase64(doc);

    expect(documentContainsSnapshot(encoded, encoded)).toBe(true);
    expect(
      documentContainsSnapshot(encodeDocToBase64(cloneDoc(doc)), encoded),
    ).toBe(true);
  });

  it("accepts a live document strictly ahead of a snapshot with deletions", () => {
    const liveDoc = jsonToDoc(attendancePlayData(["Ada"]));
    replaceDocState(liveDoc, attendancePlayData(["Ada", "Ben"]));
    const persistedBase64 = encodeDocToBase64(liveDoc);

    replaceDocState(liveDoc, attendancePlayData(["Ada", "Ben", "Cam"]));
    const liveBase64 = encodeDocToBase64(liveDoc);

    expect(documentContainsSnapshot(liveBase64, persistedBase64)).toBe(true);
    expect(documentContainsSnapshot(persistedBase64, liveBase64)).toBe(false);
  });

  it("rejects a snapshot with a struct the document lacks", () => {
    const liveDoc = jsonToDoc(attendancePlayData(["Ada"]));
    replaceDocState(liveDoc, attendancePlayData(["Ben"]));
    const persistedDoc = cloneDoc(liveDoc);
    persistedDoc.getMap("extra").set("added", 1);

    expect(
      documentContainsSnapshot(
        encodeDocToBase64(liveDoc),
        encodeDocToBase64(persistedDoc),
      ),
    ).toBe(false);
  });

  it("accepts documents edited by different clients once they are synced", () => {
    const first = new Y.Doc();
    const second = new Y.Doc();
    first.getMap("play").set("a", 1);
    second.getMap("play").set("b", 2);
    first.getMap("play").set("a", 3);
    second.getArray("list").insert(0, [1, 2, 3]);
    second.getArray("list").delete(1, 1);

    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    const firstBase64 = encodeDocToBase64(first);
    const secondBase64 = encodeDocToBase64(second);
    expect(documentContainsSnapshot(firstBase64, secondBase64)).toBe(true);
    expect(documentContainsSnapshot(secondBase64, firstBase64)).toBe(true);
  });

  it("handles empty document boundaries", () => {
    const emptyDoc = new Y.Doc();
    const populatedDoc = jsonToDoc(attendancePlayData(["Ada"]));
    const emptyBase64 = encodeDocToBase64(emptyDoc);
    const populatedBase64 = encodeDocToBase64(populatedDoc);

    expect(documentContainsSnapshot(emptyBase64, emptyBase64)).toBe(true);
    expect(documentContainsSnapshot(populatedBase64, emptyBase64)).toBe(true);
    expect(documentContainsSnapshot(emptyBase64, populatedBase64)).toBe(false);
  });
});
