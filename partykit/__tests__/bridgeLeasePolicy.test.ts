// ABOUTME: Verifies renewal and merging of shared-reference bridge leases.
// ABOUTME: Keeps active identical references subscribed without losing source metadata.
import { describe, expect, it } from "bun:test";
import { mergeSharedReferenceLeases } from "../bridgeLeasePolicy";

describe("mergeSharedReferenceLeases", () => {
  it("does not renew a recent identical reference", () => {
    const result = mergeSharedReferenceLeases({
      existing: [
        {
          sourceRoomId: "source-room",
          elementIds: ["shared"],
          sourceResetEpoch: 42,
          lastSeen: "2026-08-24T23:00:00.000Z",
        },
      ],
      requested: [{ sourceRoomId: "source-room", elementIds: ["shared"] }],
      nowIso: "2026-08-25T00:00:00.000Z",
    });

    expect(result.changed).toBe(false);
    expect(result.entries).toEqual([
      {
        sourceRoomId: "source-room",
        elementIds: ["shared"],
        sourceResetEpoch: 42,
        lastSeen: "2026-08-24T23:00:00.000Z",
      },
    ]);
  });

  it("renews an identical reference once its lease is old", () => {
    const result = mergeSharedReferenceLeases({
      existing: [
        {
          sourceRoomId: "source-room",
          elementIds: ["shared"],
          sourceResetEpoch: 42,
          lastSeen: "2026-08-24T00:00:00.000Z",
        },
      ],
      requested: [{ sourceRoomId: "source-room", elementIds: ["shared"] }],
      nowIso: "2026-08-25T00:00:00.000Z",
    });

    expect(result.changed).toBe(true);
    expect(result.entries[0]?.lastSeen).toBe("2026-08-25T00:00:00.000Z");
  });

  it("merges new ids without refreshing unrelated source leases", () => {
    const result = mergeSharedReferenceLeases({
      existing: [
        {
          sourceRoomId: "source-room",
          elementIds: ["first"],
          lastSeen: "2026-08-24T00:00:00.000Z",
        },
        {
          sourceRoomId: "other-room",
          elementIds: ["other"],
          lastSeen: "2026-08-23T00:00:00.000Z",
        },
      ],
      requested: [{ sourceRoomId: "source-room", elementIds: ["second"] }],
      nowIso: "2026-08-25T00:00:00.000Z",
    });

    expect(result.entries).toEqual([
      {
        sourceRoomId: "source-room",
        elementIds: ["first", "second"],
        lastSeen: "2026-08-25T00:00:00.000Z",
      },
      {
        sourceRoomId: "other-room",
        elementIds: ["other"],
        lastSeen: "2026-08-23T00:00:00.000Z",
      },
    ]);
  });
});
