// ABOUTME: Provides pure policy helpers for PartyServer document compaction.
// ABOUTME: Keeps alarm selection and compaction commit decisions deterministic and testable.
export function shouldStoreCompactedDocument(
  beforeSize: number,
  afterSize: number
): boolean {
  return afterSize < beforeSize;
}

export function isCompactionAutosave(
  documentBase64: string,
  compactionSnapshotBase64: string | null
): boolean {
  return (
    compactionSnapshotBase64 !== null &&
    documentBase64 === compactionSnapshotBase64
  );
}

export function shouldCommitBackgroundCompaction(): boolean {
  return false;
}

// Emergency compaction protects rooms that stay continuously connected and
// therefore never reach the empty-room compaction path. The check is split in
// two parts: this cheap predicate runs on every autosave using the encoded
// size we already computed, and only lets the expensive Y.Doc rebuild happen
// after the high-watermark threshold and cooldown allow it.
export function shouldCheckEmergencyCompaction({
  documentSize,
  thresholdBytes,
  nextCheckAt,
  now,
}: {
  documentSize: number;
  thresholdBytes: number;
  nextCheckAt: number | null;
  now: number;
}): boolean {
  if (documentSize < thresholdBytes) {
    return false;
  }

  return nextCheckAt === null || nextCheckAt <= now;
}

// A connected-room emergency reset is disruptive because clients must reload
// into a fresh Yjs history. Do it only when the compacted snapshot either gets
// back under the high-watermark threshold or saves at least 25% of that
// threshold. The percentage is derived from the threshold so staging can lower
// one setting for smoke tests without needing a separate reduction constant.
export function shouldUseEmergencyCompactedDocument({
  beforeSize,
  afterSize,
  thresholdBytes,
}: {
  beforeSize: number;
  afterSize: number;
  thresholdBytes: number;
}): boolean {
  if (!shouldStoreCompactedDocument(beforeSize, afterSize)) {
    return false;
  }

  if (afterSize < thresholdBytes) {
    return true;
  }

  return beforeSize - afterSize >= thresholdBytes / 4;
}

export function getNextAlarmTime({
  compactAfter,
  hasBridgeLeases,
  now,
  pruneIntervalMs,
}: {
  compactAfter: number | null;
  hasBridgeLeases: boolean;
  now: number;
  pruneIntervalMs: number;
}): number | null {
  const candidates: number[] = [];

  if (compactAfter !== null) {
    candidates.push(compactAfter);
  }

  if (hasBridgeLeases) {
    candidates.push(now + pruneIntervalMs);
  }

  if (!candidates.length) {
    return null;
  }

  return Math.min(...candidates);
}
