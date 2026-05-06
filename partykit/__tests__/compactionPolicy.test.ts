// ABOUTME: Verifies pure scheduling and snapshot decisions for PartyServer compaction.
// ABOUTME: Keeps hibernation-safe compaction rules testable outside Cloudflare runtime.
import { describe, expect, it } from "bun:test";
import {
  getNextAlarmTime,
  shouldStoreCompactedDocument,
} from "../compactionPolicy";

describe("shouldStoreCompactedDocument", () => {
  it("only stores compacted snapshots that reduce document size", () => {
    expect(shouldStoreCompactedDocument(100, 99)).toBe(true);
    expect(shouldStoreCompactedDocument(100, 100)).toBe(false);
    expect(shouldStoreCompactedDocument(100, 101)).toBe(false);
  });
});

describe("getNextAlarmTime", () => {
  it("returns null when no compaction or bridge lease work is pending", () => {
    expect(
      getNextAlarmTime({
        compactAfter: null,
        hasBridgeLeases: false,
        now: 1_000,
        pruneIntervalMs: 10_000,
      })
    ).toBe(null);
  });

  it("uses the pending compaction time when only compaction is pending", () => {
    expect(
      getNextAlarmTime({
        compactAfter: 5_000,
        hasBridgeLeases: false,
        now: 1_000,
        pruneIntervalMs: 10_000,
      })
    ).toBe(5_000);
  });

  it("uses the next prune time when only bridge lease work is pending", () => {
    expect(
      getNextAlarmTime({
        compactAfter: null,
        hasBridgeLeases: true,
        now: 1_000,
        pruneIntervalMs: 10_000,
      })
    ).toBe(11_000);
  });

  it("uses the earliest time when compaction and bridge lease work are both pending", () => {
    expect(
      getNextAlarmTime({
        compactAfter: 5_000,
        hasBridgeLeases: true,
        now: 1_000,
        pruneIntervalMs: 10_000,
      })
    ).toBe(5_000);

    expect(
      getNextAlarmTime({
        compactAfter: 20_000,
        hasBridgeLeases: true,
        now: 1_000,
        pruneIntervalMs: 10_000,
      })
    ).toBe(11_000);
  });
});
