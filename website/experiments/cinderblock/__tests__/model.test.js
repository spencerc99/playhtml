// ABOUTME: Tests cinderblock site-diary snapshot helpers and cooldown rules.
import { describe, expect, test } from "bun:test";
import {
  MAX_SNAPSHOTS,
  SNAPSHOT_COOLDOWN_MS,
  applySnapshotToDraft,
  canSaveSnapshot,
  createDefaultYard,
  createSnapshotRecord,
  formatCooldown,
  getLatestSnapshotTime,
  getSnapshotCooldownRemainingMs,
  listSnapshotsNewestFirst,
} from "../model.js";

describe("cinderblock site diary", () => {
  test("default yard includes an empty snapshots map", () => {
    const yard = createDefaultYard();
    expect(yard.snapshots).toEqual({});
    expect(Object.keys(yard.blocks).length).toBeGreaterThan(0);
  });

  test("cooldown is ready when no snapshots exist", () => {
    expect(canSaveSnapshot({ snapshots: {} }, 1_000)).toBe(true);
    expect(getSnapshotCooldownRemainingMs({ snapshots: {} }, 1_000)).toBe(0);
  });

  test("cooldown blocks saves until the threshold elapses", () => {
    const createdAt = 1_000_000;
    const data = {
      snapshots: {
        "snap-1": createSnapshotRecord({
          id: "snap-1",
          imageDataUrl: "data:image/jpeg;base64,abc",
          createdAt,
        }),
      },
    };

    expect(canSaveSnapshot(data, createdAt + 1_000)).toBe(false);
    expect(getSnapshotCooldownRemainingMs(data, createdAt + 1_000)).toBe(
      SNAPSHOT_COOLDOWN_MS - 1_000,
    );
    expect(canSaveSnapshot(data, createdAt + SNAPSHOT_COOLDOWN_MS)).toBe(true);
  });

  test("lists snapshots newest first and tracks the latest time", () => {
    const data = {
      snapshots: {
        older: createSnapshotRecord({
          id: "older",
          imageDataUrl: "data:image/jpeg;base64,a",
          createdAt: 10,
        }),
        newer: createSnapshotRecord({
          id: "newer",
          imageDataUrl: "data:image/jpeg;base64,b",
          createdAt: 50,
        }),
      },
    };

    expect(listSnapshotsNewestFirst(data).map((snap) => snap.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(getLatestSnapshotTime(data)).toBe(50);
  });

  test("prunes the oldest snapshots when the diary exceeds the cap", () => {
    const snapshots = {};
    for (let index = 0; index < MAX_SNAPSHOTS + 3; index += 1) {
      applySnapshotToDraft(
        snapshots,
        createSnapshotRecord({
          id: `snap-${index}`,
          imageDataUrl: `data:image/jpeg;base64,${index}`,
          createdAt: index + 1,
        }),
      );
    }

    expect(Object.keys(snapshots)).toHaveLength(MAX_SNAPSHOTS);
    expect(snapshots["snap-0"]).toBeUndefined();
    expect(snapshots["snap-1"]).toBeUndefined();
    expect(snapshots["snap-2"]).toBeUndefined();
    expect(snapshots[`snap-${MAX_SNAPSHOTS + 2}`]).toBeDefined();
  });

  test("formats cooldown labels for the save status", () => {
    expect(formatCooldown(5_000)).toBe("5s");
    expect(formatCooldown(65_000)).toBe("1m 05s");
    expect(formatCooldown(15 * 60 * 1000)).toBe("15m 00s");
  });

  test("treats missing or invalid snapshots as empty", () => {
    expect(listSnapshotsNewestFirst({})).toEqual([]);
    expect(listSnapshotsNewestFirst({ snapshots: [] })).toEqual([]);
    expect(getLatestSnapshotTime(null)).toBe(0);
  });
});
