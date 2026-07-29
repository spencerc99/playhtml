// ABOUTME: Decides how a room reacts to oversized documents and repeated OOM failures.
// ABOUTME: Owns retry backoff, compaction skips, and the last-resort quarantine threshold.
export type QuarantineReason = "manual" | "repeated-failures";

// Which risky operation a failure counter tracks. Load and alarm failures are
// counted separately because they fail for different reasons, and only the
// alarm path can be rescheduled.
export type FailureKind = "load" | "alarm";

export type QuarantineState = {
  reason: QuarantineReason;
  // Operator-supplied note for a manual quarantine, or the failing operation
  // for an automatic one.
  detail: string;
  failureKind: FailureKind | null;
  failureCount: number;
  quarantinedAt: number;
};

// Size alone never blocks a load or quarantines a room: healthy production rooms
// live in the same size band as rooms that have OOMed. Oversized documents are
// only reported, so they can be compacted before they become a problem.
export function isDocumentOversized({
  documentBytes,
  thresholdBytes,
}: {
  documentBytes: number;
  thresholdBytes: number;
}): boolean {
  return documentBytes > thresholdBytes;
}

// In-DO compaction holds the live doc, its JSON projection, and the rebuilt copy
// at once, so its ceiling is far below the load ceiling. Above it, compaction is
// doomed work: it would crash the isolate without producing a smaller document.
export function isTooLargeToCompactInDurableObject({
  documentBytes,
  maxBytes,
}: {
  documentBytes: number;
  maxBytes: number;
}): boolean {
  return documentBytes > maxBytes;
}

export function shouldQuarantineForFailures({
  failureCount,
  failureThreshold,
}: {
  failureCount: number;
  failureThreshold: number;
}): boolean {
  return failureCount >= failureThreshold;
}

/**
 * Exponential backoff for work that keeps failing. Cloudflare retries a failed
 * alarm within seconds, which is what turns a single OOM into a permanent crash
 * loop, so the alarm is rescheduled onto this ladder instead. A room whose
 * failure was environmental (isolate co-tenancy, memory pressure) gets room to
 * recover on its own.
 */
export function getFailureBackoffMs({
  failureCount,
  baseMs,
  maxMs,
}: {
  failureCount: number;
  baseMs: number;
  maxMs: number;
}): number {
  if (failureCount <= 0) return 0;
  // 1min, 5min, 20min, 1h, 6h against the default base, then doubling to the cap.
  const ladder = [1, 5, 20, 60, 360];
  const multiplier =
    failureCount <= ladder.length
      ? ladder[failureCount - 1]
      : ladder[ladder.length - 1] * 2 ** (failureCount - ladder.length);
  return Math.min(baseMs * multiplier, maxMs);
}

export function getFailureRetryAt({
  failureCount,
  baseMs,
  maxMs,
  now,
}: {
  failureCount: number;
  baseMs: number;
  maxMs: number;
  now: number;
}): number {
  return now + getFailureBackoffMs({ failureCount, baseMs, maxMs });
}

export function isRetryDue({
  retryAfter,
  now,
}: {
  retryAfter: number | null;
  now: number;
}): boolean {
  return retryAfter === null || retryAfter <= now;
}

export function formatCompactionSkipLog({
  roomName,
  documentBytes,
  maxBytes,
}: {
  roomName: string;
  documentBytes: number;
  maxBytes: number;
}): string {
  return [
    `[PartyServer] ROOM REQUIRES EXTERNAL COMPACTION: room=${roomName}`,
    `documentBytes=${documentBytes}`,
    `maxInDurableObjectBytes=${maxBytes}`,
    "Compacting this document inside the room would rebuild it in memory and crash the room, so in-DO compaction is disabled for it and the compaction schedule is parked.",
    "The room still loads and runs normally; only automatic shrinking is off.",
    `To recover: GET admin/raw-data for room=${roomName}, compact the document offline, then POST admin/restore-raw-document.`,
  ].join(" ");
}

export function formatFailureBackoffLog({
  roomName,
  failureKind,
  failureCount,
  retryAt,
  failureThreshold,
}: {
  roomName: string;
  failureKind: FailureKind;
  failureCount: number;
  retryAt: number;
  failureThreshold: number;
}): string {
  return [
    `[PartyServer] ROOM WORK FAILING: room=${roomName}`,
    `operation=${failureKind}`,
    `consecutiveFailures=${failureCount}`,
    `retryAt=${new Date(retryAt).toISOString()}`,
    `quarantineAfter=${failureThreshold}`,
    "The previous attempt started and never completed, most likely an out-of-memory crash. Retries are backing off instead of looping.",
    "This clears itself if the next attempt succeeds.",
  ].join(" ");
}

export function formatQuarantineLog({
  roomName,
  reason,
  detail,
  failureKind,
  failureCount,
}: {
  roomName: string;
  reason: QuarantineReason;
  detail: string;
  failureKind: FailureKind | null;
  failureCount: number;
}): string {
  const cause =
    reason === "manual"
      ? `an operator quarantined it (${detail})`
      : `${failureKind} work failed ${failureCount} times in a row and exhausted the retry backoff, so the room cannot recover on its own`;

  return [
    `[PartyServer] ROOM QUARANTINED: room=${roomName}`,
    `reason=${reason}`,
    `operation=${failureKind ?? "none"}`,
    `consecutiveFailures=${failureCount}`,
    `cause=${cause}.`,
    "The persisted document is NOT loaded and will NOT be overwritten.",
    "The room runs in TRANSIENT MODE: visitors sync live with each other, nothing persists, alarms are parked.",
    `To recover: repair or shrink the document (GET admin/raw-data, compact offline, POST admin/restore-raw-document), then POST admin/quarantine-clear for room=${roomName}.`,
  ].join(" ");
}

export function createQuarantineStatusBody({
  roomName,
  quarantine,
  documentWarningBytes,
  maxInDurableObjectBytes,
  failureThreshold,
  loadFailures,
  alarmFailures,
  loadRetryAfter,
  alarmRetryAfter,
  compactionParkedBytes,
}: {
  roomName: string;
  quarantine: QuarantineState | null;
  documentWarningBytes: number;
  maxInDurableObjectBytes: number;
  failureThreshold: number;
  loadFailures: number;
  alarmFailures: number;
  loadRetryAfter: number | null;
  alarmRetryAfter: number | null;
  compactionParkedBytes: number | null;
}) {
  return {
    roomId: roomName,
    quarantined: quarantine !== null,
    reason: quarantine?.reason ?? null,
    detail: quarantine?.detail ?? null,
    quarantinedAt:
      quarantine === null
        ? null
        : new Date(quarantine.quarantinedAt).toISOString(),
    failures: {
      load: loadFailures,
      alarm: alarmFailures,
      quarantineAfter: failureThreshold,
      // Separate deadlines: a healthy load must not imply the alarm is healthy.
      loadRetryAfter:
        loadRetryAfter === null ? null : new Date(loadRetryAfter).toISOString(),
      alarmRetryAfter:
        alarmRetryAfter === null
          ? null
          : new Date(alarmRetryAfter).toISOString(),
    },
    compaction: {
      parked: compactionParkedBytes !== null,
      documentBytes: compactionParkedBytes,
      maxInDurableObjectBytes,
    },
    documentWarningBytes,
  };
}
