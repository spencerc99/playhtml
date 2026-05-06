// ABOUTME: Provides pure policy helpers for PartyServer document compaction.
// ABOUTME: Keeps alarm selection and compaction commit decisions deterministic and testable.
export function shouldStoreCompactedDocument(
  beforeSize: number,
  afterSize: number
): boolean {
  return afterSize < beforeSize;
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
