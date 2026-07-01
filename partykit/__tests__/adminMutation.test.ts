// ABOUTME: Tests admin snapshot helpers that turn edited play data into resettable documents.
// ABOUTME: Keeps database-edit routes pinned to fresh Y.Doc snapshots with reset metadata.
import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import { Buffer } from "node:buffer";
import {
  createAdminSnapshotFromPlayData,
  resolveRoomResetEpoch,
} from "../adminMutation";
import { docToJson, getDocResetEpoch } from "../docUtils";

describe("createAdminSnapshotFromPlayData", () => {
  it("stores play data in a fresh document with the provided reset epoch", () => {
    const play = {
      "can-play": {
        counter: { count: 3 },
      },
      "can-post": {
        guestbook: [{ name: "Ada", message: "hello" }],
      },
    };

    const snapshot = createAdminSnapshotFromPlayData(play, 98765);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(snapshot.base64, "base64")));

    expect(docToJson(doc)).toEqual(play);
    expect(getDocResetEpoch(doc)).toBe(98765);
    expect(snapshot.documentSize).toBe(snapshot.base64.length);
    expect(snapshot.resetEpoch).toBe(98765);
  });
});

describe("resolveRoomResetEpoch", () => {
  it("does not move an existing room reset epoch backward", () => {
    expect(
      resolveRoomResetEpoch({
        snapshotEpoch: 100,
        storedEpoch: 200,
        bumpEpoch: false,
        now: 250,
      })
    ).toBe(200);
  });

  it("creates a monotonic epoch when bumping the reset boundary", () => {
    expect(
      resolveRoomResetEpoch({
        snapshotEpoch: 100,
        storedEpoch: 300,
        bumpEpoch: true,
        now: 250,
      })
    ).toBe(301);
  });
});
