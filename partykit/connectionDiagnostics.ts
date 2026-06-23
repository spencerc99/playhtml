// ABOUTME: Formats PartyServer connection lifecycle diagnostics for production logs.
// ABOUTME: Keeps WebSocket close logging policy small, testable, and reusable.

export interface ConnectionCloseDetails {
  roomName: string;
  connectionId: string;
  code: number;
  reason: string;
  wasClean: boolean;
  openedAt?: number;
  now?: number;
}

const QUIET_CLOSE_CODES = new Set([1000, 1001, 4000]);

export function getConnectionCloseDiagnostic(
  details: ConnectionCloseDetails
): string | null {
  if (details.wasClean && QUIET_CLOSE_CODES.has(details.code)) {
    return null;
  }

  const now = details.now ?? Date.now();
  const durationMs =
    details.openedAt === undefined
      ? "unknown"
      : String(Math.max(0, now - details.openedAt));

  return (
    `[PartyServer] WebSocket closed abnormally: room=${details.roomName} ` +
    `connection=${details.connectionId} code=${details.code} ` +
    `reason=${JSON.stringify(details.reason)} wasClean=${details.wasClean} ` +
    `durationMs=${durationMs}`
  );
}
