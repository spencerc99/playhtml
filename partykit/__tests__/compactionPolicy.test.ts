// ABOUTME: Verifies pure scheduling and snapshot decisions for PartyServer compaction.
// ABOUTME: Keeps hibernation-safe compaction rules testable outside Cloudflare runtime.
import { describe, expect, it } from "bun:test";
import {
  getNextAlarmTime,
  getCompactionCommitDecision,
  isCompactionAutosave,
  shouldCompactBeforePersist,
  shouldCheckEmergencyCompaction,
  shouldCommitCompactionSnapshot,
  shouldUseEmergencyCompactedDocument,
  shouldStoreCompactedDocument,
} from "../compactionPolicy";

describe("shouldStoreCompactedDocument", () => {
  it("only stores compacted snapshots that reduce document size", () => {
    expect(shouldStoreCompactedDocument(100, 99)).toBe(true);
    expect(shouldStoreCompactedDocument(100, 100)).toBe(false);
    expect(shouldStoreCompactedDocument(100, 101)).toBe(false);
  });
});

describe("isCompactionAutosave", () => {
  it("matches only the compacted snapshot autosave", () => {
    expect(isCompactionAutosave("snapshot-a", "snapshot-a")).toBe(true);
    expect(isCompactionAutosave("snapshot-b", "snapshot-a")).toBe(false);
    expect(isCompactionAutosave("snapshot-a", null)).toBe(false);
  });
});

describe("shouldCommitCompactionSnapshot", () => {
  it("only commits when the persisted document still matches the compacted source", () => {
    expect(
      shouldCommitCompactionSnapshot({
        sourceDocumentBase64: "source",
        persistedDocumentBase64: "source",
      })
    ).toBe(true);
    expect(
      shouldCommitCompactionSnapshot({
        sourceDocumentBase64: "source",
        persistedDocumentBase64: "newer",
      })
    ).toBe(false);
    expect(
      shouldCommitCompactionSnapshot({
        sourceDocumentBase64: "source",
        persistedDocumentBase64: null,
      })
    ).toBe(false);
  });
});

describe("getCompactionCommitDecision", () => {
  it("persists the live document before compaction when persisted data changed", () => {
    expect(
      getCompactionCommitDecision({
        sourceDocumentBase64: "source",
        persistedDocumentBase64: "source",
        sourceContainsPersistedDocument: false,
      })
    ).toEqual({ kind: "commit-compaction" });
    expect(
      getCompactionCommitDecision({
        sourceDocumentBase64: "source",
        persistedDocumentBase64: "newer",
        sourceContainsPersistedDocument: true,
      })
    ).toEqual({ kind: "persist-live-document" });
    expect(
      getCompactionCommitDecision({
        sourceDocumentBase64: "source",
        persistedDocumentBase64: null,
        sourceContainsPersistedDocument: false,
      })
    ).toEqual({ kind: "persist-live-document" });
  });

  it("leaves persisted data untouched when the live source is missing database updates", () => {
    expect(
      getCompactionCommitDecision({
        sourceDocumentBase64: "source",
        persistedDocumentBase64: "newer",
        sourceContainsPersistedDocument: false,
      })
    ).toEqual({ kind: "skip-compaction" });
  });
});

describe("shouldCheckEmergencyCompaction", () => {
  it("only runs the expensive check after the size threshold and cooldown", () => {
    expect(
      shouldCheckEmergencyCompaction({
        documentSize: 999,
        thresholdBytes: 1_000,
        nextCheckAt: null,
        now: 5_000,
      })
    ).toBe(false);

    expect(
      shouldCheckEmergencyCompaction({
        documentSize: 1_000,
        thresholdBytes: 1_000,
        nextCheckAt: 6_000,
        now: 5_000,
      })
    ).toBe(false);

    expect(
      shouldCheckEmergencyCompaction({
        documentSize: 1_000,
        thresholdBytes: 1_000,
        nextCheckAt: 5_000,
        now: 5_000,
      })
    ).toBe(true);

    expect(
      shouldCheckEmergencyCompaction({
        documentSize: 1_000,
        thresholdBytes: 1_000,
        nextCheckAt: null,
        now: 5_000,
      })
    ).toBe(true);
  });
});

describe("shouldCompactBeforePersist", () => {
  it("checks large autosave candidates only when compaction is allowed", () => {
    expect(
      shouldCompactBeforePersist({
        allowCompaction: true,
        documentSize: 999,
        thresholdBytes: 1_000,
      })
    ).toBe(false);

    expect(
      shouldCompactBeforePersist({
        allowCompaction: true,
        documentSize: 1_000,
        thresholdBytes: 1_000,
      })
    ).toBe(true);

    expect(
      shouldCompactBeforePersist({
        allowCompaction: false,
        documentSize: 1_000,
        thresholdBytes: 1_000,
      })
    ).toBe(false);
  });
});

describe("shouldUseEmergencyCompactedDocument", () => {
  it("requires compaction to move a large room below threshold or save meaningful space", () => {
    expect(
      shouldUseEmergencyCompactedDocument({
        beforeSize: 1_200,
        afterSize: 900,
        thresholdBytes: 1_000,
      })
    ).toBe(true);

    expect(
      shouldUseEmergencyCompactedDocument({
        beforeSize: 2_000,
        afterSize: 1_700,
        thresholdBytes: 1_000,
      })
    ).toBe(true);

    expect(
      shouldUseEmergencyCompactedDocument({
        beforeSize: 2_000,
        afterSize: 1_900,
        thresholdBytes: 1_000,
      })
    ).toBe(false);

    expect(
      shouldUseEmergencyCompactedDocument({
        beforeSize: 2_000,
        afterSize: 2_000,
        thresholdBytes: 1_000,
      })
    ).toBe(false);
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
