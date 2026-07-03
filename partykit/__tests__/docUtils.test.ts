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
      documentContainsSnapshot(encodeDocToBase64(liveDoc), persistedBase64)
    ).toBe(true);
  });

  it("rejects a stale live document that is missing persisted updates", () => {
    const liveDoc = jsonToDoc(attendancePlayData(["Ada"]));
    const persistedDoc = jsonToDoc(attendancePlayData(["Ada", "Ben"]));

    expect(
      documentContainsSnapshot(
        encodeDocToBase64(liveDoc),
        encodeDocToBase64(persistedDoc)
      )
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
        encodeDocToBase64(persistedDoc)
      )
    ).toBe(false);
    expect(
      documentContainsSnapshot(
        encodeDocToBase64(persistedDoc),
        encodeDocToBase64(liveDoc)
      )
    ).toBe(false);
  });

  it("rejects snapshots with deletion-only updates missing from the live document", () => {
    const baseDoc = jsonToDoc(attendancePlayData(["Ada", "Ben"]));
    const liveDoc = cloneDoc(baseDoc);
    const persistedDoc = cloneDoc(baseDoc);
    const store = syncedStore<{ play: Record<string, any> }>(
      { play: {} },
      persistedDoc
    );

    persistedDoc.transact(() => {
      store.play["can-play"]["week-attendance"].attendees.splice(1, 1);
    });

    expect(
      documentContainsSnapshot(
        encodeDocToBase64(liveDoc),
        encodeDocToBase64(persistedDoc)
      )
    ).toBe(false);
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
