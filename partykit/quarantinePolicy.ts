// ABOUTME: Decides how a room reacts to repeated load, alarm, and compaction failures.
// ABOUTME: Owns retry backoff and last-resort failure thresholds.
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

export function getCompactionRetryDelayMs({
  failureCount,
  retryDelaysMs,
}: {
  failureCount: number;
  retryDelaysMs: readonly number[];
}): number | null {
  return retryDelaysMs[failureCount - 1] ?? null;
}

export function shouldDisableCompaction({
  failureCount,
  disableAfter,
}: {
  failureCount: number;
  disableAfter: number;
}): boolean {
  return failureCount >= disableAfter;
}

export function formatCompactionBackoffLog({
  roomName,
  failureCount,
  retryAt,
}: {
  roomName: string;
  failureCount: number;
  retryAt: number;
}): string {
  return [
    `[PartyServer] AUTOMATIC COMPACTION BACKOFF: room=${roomName}`,
    `vanishedAttempts=${failureCount}`,
    `retryAt=${new Date(retryAt).toISOString()}`,
    "The previous compaction started but never completed, most likely because the isolate ran out of memory.",
    "The room continues loading, syncing, and persisting normally while compaction waits.",
  ].join(" ");
}

export function formatCompactionDisabledLog({
  roomName,
  failureCount,
}: {
  roomName: string;
  failureCount: number;
}): string {
  return [
    `[PartyServer] AUTOMATIC COMPACTION DISABLED: room=${roomName}`,
    `vanishedAttempts=${failureCount}`,
    "Compaction vanished three times in a row, so automatic compaction is disabled without affecting room service or persistence.",
    `To retry: POST admin/compaction-retry for room=${roomName}.`,
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
    "The room runs in TRANSIENT MODE: awareness continues, shared-data writes are blocked, nothing persists, alarms are parked.",
    `To recover: repair or shrink the document (GET admin/raw-data, compact offline, POST admin/restore-raw-document), then POST admin/quarantine-clear for room=${roomName}.`,
  ].join(" ");
}

export function createQuarantineStatusBody({
  roomName,
  quarantine,
  documentWarningBytes,
  failureThreshold,
  loadFailures,
  alarmFailures,
  loadRetryAfter,
  alarmRetryAfter,
  compactionFailures,
  compactionRetryAfter,
  compactionDisabledAt,
  compactionDisableAfter,
  loadDeferredUntil = null,
  externalFlag = { available: false },
}: {
  roomName: string;
  quarantine: QuarantineState | null;
  documentWarningBytes: number;
  failureThreshold: number;
  loadFailures: number;
  alarmFailures: number;
  loadRetryAfter: number | null;
  alarmRetryAfter: number | null;
  compactionFailures: number;
  compactionRetryAfter: number | null;
  compactionDisabledAt: number | null;
  compactionDisableAfter: number;
  loadDeferredUntil?: number | null;
  externalFlag?: { available: true; value: string | null } | { available: false };
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
      disabled: compactionDisabledAt !== null,
      disabledAt:
        compactionDisabledAt === null
          ? null
          : new Date(compactionDisabledAt).toISOString(),
      failures: compactionFailures,
      disableAfter: compactionDisableAfter,
      retryAfter:
        compactionRetryAfter === null
          ? null
          : new Date(compactionRetryAfter).toISOString(),
    },
    // Whether this isolate is currently refusing requests, which can differ from
    // the stored deadline after an in-place recovery.
    loadDeferred: {
      active: loadDeferredUntil !== null,
      until:
        loadDeferredUntil === null
          ? null
          : new Date(loadDeferredUntil).toISOString(),
    },
    // The pre-hydration flag. "kvUnavailable" means it could not be checked,
    // which is not the same as no flag being set.
    externalQuarantineFlag: externalFlag.available
      ? externalFlag.value
      : "kvUnavailable",
    documentWarningBytes,
  };
}
