// ABOUTME: Verifies conversion between v1 Yjs documents and v2 room snapshots.
// ABOUTME: Checks plain values, typed failures, array sidecar coverage, and the return trip to v1.

import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import type { ProtocolPath, RoomSnapshot } from "@playhtml/common";
import {
  convertDocumentToSnapshot,
  convertSnapshotToDocument,
} from "../convert";
import { encodeDocToBase64, getDocResetEpoch, jsonToDoc } from "../docUtils";
import { buildRollbackDocument } from "../scripts/rollback-room";

function convertPlayData(playData: Record<string, unknown>): RoomSnapshot {
  const doc = jsonToDoc(playData);
  try {
    const result = convertDocumentToSnapshot(encodeDocToBase64(doc));
    if (!result.ok) throw new Error(result.error.message);
    return result.snapshot;
  } finally {
    doc.destroy();
  }
}

function pathKey(path: ProtocolPath): string {
  return JSON.stringify(path);
}

function checkSnapshotIntegrity(snapshot: RoomSnapshot): void {
  const seenArrayPaths = new Set<string>();

  function visit(
    value: unknown,
    capability: string,
    elementId: string,
    path: ProtocolPath,
  ): void {
    if (Array.isArray(value)) {
      const matches = snapshot.arrays.filter(
        (array) =>
          array.capability === capability &&
          array.elementId === elementId &&
          pathKey(array.path) === pathKey(path),
      );
      expect(matches).toHaveLength(1);
      const arrayIdentity = matches[0];
      expect(arrayIdentity.itemIds).toHaveLength(value.length);
      expect(new Set(arrayIdentity.itemIds).size).toBe(value.length);
      seenArrayPaths.add(`${capability}\0${elementId}\0${pathKey(path)}`);

      value.forEach((item, index) => {
        visit(item, capability, elementId, [
          ...path,
          { itemId: arrayIdentity.itemIds[index] },
        ]);
      });
      return;
    }

    if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        visit(child, capability, elementId, [...path, key]);
      }
    }
  }

  for (const [capability, elements] of Object.entries(snapshot.state)) {
    for (const [elementId, value] of Object.entries(elements)) {
      visit(value, capability, elementId, []);
    }
  }

  expect(snapshot.arrays).toHaveLength(seenArrayPaths.size);
  for (const array of snapshot.arrays) {
    expect(
      seenArrayPaths.has(
        `${array.capability}\0${array.elementId}\0${pathKey(array.path)}`,
      ),
    ).toBe(true);
  }
}

describe("convertDocumentToSnapshot", () => {
  it("converts can-move, can-toggle, and can-spin values", () => {
    const playData = {
      "can-move": { mover: { x: 12, y: -4 } },
      "can-toggle": { switch: { on: true } },
      "can-spin": { spinner: { rotation: 270 } },
    };

    const snapshot = convertPlayData(playData);

    expect(snapshot.state).toEqual(playData);
    expect(snapshot.arrays).toEqual([]);
    expect(snapshot.lastMutationIds).toEqual({});
    checkSnapshotIntegrity(snapshot);
  });

  it("converts nested can-play arrays at every depth", () => {
    const playData = {
      "can-play": {
        board: {
          columns: [
            {
              title: "Todo",
              cards: [
                { title: "First", tags: ["urgent", "small"] },
                { title: "Second", tags: [] },
              ],
              metadata: { labels: ["work"] },
            },
          ],
          selected: ["First"],
        },
      },
    };

    const snapshot = convertPlayData(playData);

    expect(snapshot.state).toEqual(playData);
    expect(snapshot.arrays).toHaveLength(6);
    checkSnapshotIntegrity(snapshot);
  });

  it("preserves values for unknown capabilities", () => {
    const playData = {
      "can-future": {
        element: { enabled: false, values: [{ id: 1 }, { id: 2 }] },
      },
    };

    const snapshot = convertPlayData(playData);

    expect(snapshot.state).toEqual(playData);
    expect(snapshot.arrays).toHaveLength(1);
    checkSnapshotIntegrity(snapshot);
  });

  it("converts a document with no play data to an empty room", () => {
    const doc = new Y.Doc();
    try {
      const result = convertDocumentToSnapshot(encodeDocToBase64(doc));

      expect(result).toEqual({
        ok: true,
        snapshot: { state: {}, arrays: [], lastMutationIds: {} },
      });
    } finally {
      doc.destroy();
    }
  });

  it("returns a typed error for corrupt document data", () => {
    const result = convertDocumentToSnapshot("not-a-yjs-update");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid-document");
    }
  });

  it("does not mutate the decoded values while assigning identities", () => {
    const playData = {
      "can-play": { element: { items: [{ value: 1 }, { value: 2 }] } },
    };
    const original = structuredClone(playData);

    const snapshot = convertPlayData(playData);

    expect(playData).toEqual(original);
    expect(snapshot.state).toEqual(original);
    checkSnapshotIntegrity(snapshot);
  });
});

describe("convertSnapshotToDocument", () => {
  const playData = {
    "can-move": { sign: { x: 12, y: -4 } },
    "can-play": {
      guestbook: [
        { name: "ada", message: "hi", tags: ["a", "b"] },
        { name: "lin", message: "", tags: [] },
      ],
      counter: { count: 3, nested: { on: true, label: null } },
    },
  };

  it("returns the same room state after a v1 to v2 to v1 trip", () => {
    const snapshot = convertPlayData(playData);
    const document = convertSnapshotToDocument(snapshot, 1_794_000_000_000);

    const decoded = convertDocumentToSnapshot(document);
    if (!decoded.ok) throw new Error(decoded.error.message);
    expect(decoded.snapshot.state).toEqual(playData);
  });

  it("stamps the reset epoch into the v1 document", () => {
    const snapshot = convertPlayData(playData);
    const document = convertSnapshotToDocument(snapshot, 1_794_000_000_123);

    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, new Uint8Array(Buffer.from(document, "base64")));
      expect(getDocResetEpoch(doc)).toBe(1_794_000_000_123);
    } finally {
      doc.destroy();
    }
  });

  it("builds a decodable v1 document for an empty room", () => {
    const document = convertSnapshotToDocument(
      { state: {}, arrays: [], lastMutationIds: {} },
      1_794_000_000_000,
    );

    const decoded = convertDocumentToSnapshot(document);
    if (!decoded.ok) throw new Error(decoded.error.message);
    expect(decoded.snapshot.state).toEqual({});
  });

  it("rejects a reset epoch that is not a positive integer", () => {
    const snapshot = convertPlayData(playData);
    expect(() => convertSnapshotToDocument(snapshot, 0)).toThrow(
      "resetEpoch must be a positive integer.",
    );
    expect(() => convertSnapshotToDocument(snapshot, 1.5)).toThrow(
      "resetEpoch must be a positive integer.",
    );
  });
});

describe("buildRollbackDocument", () => {
  it("accepts a snapshot whose capability holds no elements", () => {
    const document = buildRollbackDocument(
      {
        state: { "can-move": {}, "can-toggle": { lamp: { on: true } } },
        arrays: [],
        lastMutationIds: { "client-1": 4 },
      },
      1_794_000_000_000,
    );

    const decoded = convertDocumentToSnapshot(document);
    if (!decoded.ok) throw new Error(decoded.error.message);
    expect(decoded.snapshot.state["can-toggle"]).toEqual({
      lamp: { on: true },
    });
  });
});
