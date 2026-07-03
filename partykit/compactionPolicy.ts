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

export function shouldCommitCompactionSnapshot({
  sourceDocumentBase64,
  persistedDocumentBase64,
}: {
  sourceDocumentBase64: string;
  persistedDocumentBase64: string | null;
}): boolean {
  return (
    getCompactionCommitDecision({
      sourceDocumentBase64,
      persistedDocumentBase64,
      sourceContainsPersistedDocument: false,
    }).kind === "commit-compaction"
  );
}

export type CompactionCommitDecision =
  | { kind: "commit-compaction" }
  | { kind: "persist-live-document" }
  | { kind: "skip-compaction" };

export function getCompactionCommitDecision({
  sourceDocumentBase64,
  persistedDocumentBase64,
  sourceContainsPersistedDocument,
}: {
  sourceDocumentBase64: string;
  persistedDocumentBase64: string | null;
  sourceContainsPersistedDocument: boolean;
}): CompactionCommitDecision {
  if (persistedDocumentBase64 === sourceDocumentBase64) {
    return { kind: "commit-compaction" };
  }

  if (persistedDocumentBase64 !== null && !sourceContainsPersistedDocument) {
    return { kind: "skip-compaction" };
  }

  return { kind: "persist-live-document" };
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

export function shouldSetAlarm({
  previousAlarm,
  nextAlarm,
  now,
}: {
  previousAlarm: number | null | undefined;
  nextAlarm: number;
  now: number;
}): boolean {
  return (
    previousAlarm === null ||
    previousAlarm === undefined ||
    previousAlarm <= now ||
    nextAlarm < previousAlarm
  );
}

type BridgeLease = {
  createdAt?: string;
  lastSeen?: string;
};

function isBridgeLeaseWithinWindow(
  lease: BridgeLease,
  now: number,
  leaseMs: number
): boolean {
  const lastSeen = lease.lastSeen || lease.createdAt;
  const timestamp = lastSeen ? Date.parse(lastSeen) : NaN;
  if (!Number.isFinite(timestamp)) return true;
  return now - timestamp <= leaseMs;
}

export function getPrunedBridgeLeases<Lease extends BridgeLease>({
  leases,
  now,
  leaseMs,
}: {
  leases: Lease[];
  now: number;
  leaseMs: number;
}): Lease[] {
  return leases.filter((lease) =>
    isBridgeLeaseWithinWindow(lease, now, leaseMs)
  );
}
