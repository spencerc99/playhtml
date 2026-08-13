// ABOUTME: Tests cinderblock site-diary snapshot helpers and cooldown rules.
import { describe, expect, test } from "bun:test";
import {
  MAX_SNAPSHOTS,
  SNAPSHOT_COOLDOWN_MS,
  applySnapshotToDraft,
  canSaveSnapshot,
  compactBlocksSnapshot,
  createDefaultYard,
  createSnapshotRecord,
  formatCooldown,
  getLatestSnapshotTime,
  getSnapshotBlockCount,
  getSnapshotCooldownRemainingMs,
  isBlockSnapshot,
  listSnapshotsNewestFirst,
} from "../model.js";

const sampleBlocks = {
  "block-1": { x: 180, y: 642, angle: 0 },
  "block-2": { x: 390.12, y: 641.88, angle: 0.12345 },
};

describe("cinderblock site diary", () => {
  test("default yard includes an empty snapshots map", () => {
    const yard = createDefaultYard();
    expect(yard.snapshots).toEqual({});
    expect(Object.keys(yard.blocks).length).toBeGreaterThan(0);
  });

  test("stores compact block transforms instead of image bytes", () => {
    const record = createSnapshotRecord({
      id: "snap-1",
      blocks: sampleBlocks,
      createdAt: 100,
    });

    expect(record.imageDataUrl).toBeUndefined();
    expect(record.blocks["block-2"]).toEqual({
      x: 390.1,
      y: 641.9,
      angle: 0.1235,
    });
    expect(getSnapshotBlockCount(record)).toBe(2);
    expect(JSON.stringify(record).length).toBeLessThan(250);
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
          blocks: sampleBlocks,
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
          blocks: sampleBlocks,
          createdAt: 10,
        }),
        newer: createSnapshotRecord({
          id: "newer",
          blocks: sampleBlocks,
          createdAt: 50,
        }),
        legacy: {
          id: "legacy",
          createdAt: 99,
          imageDataUrl: "data:image/jpeg;base64,aaaaaaaaaaaaaaaa",
        },
      },
    };

    expect(listSnapshotsNewestFirst(data).map((snap) => snap.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(getLatestSnapshotTime(data)).toBe(50);
    expect(isBlockSnapshot(data.snapshots.legacy)).toBe(false);
  });

  test("prunes oldest snapshots and strips legacy image entries", () => {
    const snapshots = {
      legacy: {
        id: "legacy",
        createdAt: 1,
        imageDataUrl: "data:image/jpeg;base64," + "x".repeat(20_000),
      },
    };

    for (let index = 0; index < MAX_SNAPSHOTS + 3; index += 1) {
      applySnapshotToDraft(
        snapshots,
        createSnapshotRecord({
          id: `snap-${index}`,
          blocks: compactBlocksSnapshot(sampleBlocks),
          createdAt: index + 1,
        }),
      );
    }

    expect(snapshots.legacy).toBeUndefined();
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
