// ABOUTME: Decides when a room must skip hydration to avoid load-time OOM crash loops.
// ABOUTME: Keeps quarantine reasons, counters, and operator logs deterministic and testable.
export type QuarantineReason = "document-size" | "crash-loop";

export type QuarantineState = {
  reason: QuarantineReason;
  // Persisted document size in base64 bytes at the time quarantine was entered.
  // Null when the crash-loop breaker fired before the document was measured.
  documentBytes: number | null;
  loadAttempts: number;
  quarantinedAt: number;
};

// A room is quarantined before hydration when a previous load never reported
// success. The counter is written durably before hydration and cleared after,
// so an isolate that dies inside Y.applyUpdate leaves the increment behind.
export const DEFAULT_QUARANTINE_LOAD_ATTEMPTS = 3;

export function shouldQuarantineForLoadAttempts({
  loadAttempts,
  maxLoadAttempts,
}: {
  loadAttempts: number;
  maxLoadAttempts: number;
}): boolean {
  return loadAttempts >= maxLoadAttempts;
}

export function shouldQuarantineForDocumentSize({
  documentBytes,
  thresholdBytes,
}: {
  documentBytes: number;
  thresholdBytes: number;
}): boolean {
  return documentBytes > thresholdBytes;
}

export function formatQuarantineLog({
  roomName,
  reason,
  documentBytes,
  thresholdBytes,
  loadAttempts,
}: {
  roomName: string;
  reason: QuarantineReason;
  documentBytes: number | null;
  thresholdBytes: number;
  loadAttempts: number;
}): string {
  const cause =
    reason === "document-size"
      ? `persisted document is too large to hydrate (documentBytes=${documentBytes}, thresholdBytes=${thresholdBytes})`
      : `hydration failed ${loadAttempts} times without completing, so loading it again would keep crashing the isolate`;

  return [
    `[PartyServer] ROOM QUARANTINED: room=${roomName}`,
    `reason=${reason}`,
    `documentBytes=${documentBytes ?? "unknown"}`,
    `thresholdBytes=${thresholdBytes}`,
    `loadAttempts=${loadAttempts}`,
    `cause=${cause}.`,
    "The persisted document was NOT loaded and will NOT be overwritten.",
    "Entering TRANSIENT MODE: visitors sync live with each other, nothing persists, alarms are canceled.",
    `To recover: shrink or repair the persisted document, then POST admin/quarantine-clear for room=${roomName}.`,
  ].join(" ");
}

export function createQuarantineStatusBody({
  roomName,
  quarantine,
  thresholdBytes,
  maxLoadAttempts,
  loadAttempts,
}: {
  roomName: string;
  quarantine: QuarantineState | null;
  thresholdBytes: number;
  maxLoadAttempts: number;
  loadAttempts: number;
}) {
  return {
    roomId: roomName,
    quarantined: quarantine !== null,
    reason: quarantine?.reason ?? null,
    documentBytes: quarantine?.documentBytes ?? null,
    quarantinedAt:
      quarantine === null
        ? null
        : new Date(quarantine.quarantinedAt).toISOString(),
    loadAttempts,
    thresholdBytes,
    maxLoadAttempts,
  };
}
