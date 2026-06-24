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
  label?: string;
  quietCloseCodes?: Iterable<number>;
}

const QUIET_CLOSE_CODES = new Set([1000, 1001, 4000]);

export function getConnectionCloseDiagnostic(
  details: ConnectionCloseDetails
): string | null {
  const quietCloseCodes = details.quietCloseCodes ?? QUIET_CLOSE_CODES;
  if (details.wasClean && hasCloseCode(quietCloseCodes, details.code)) {
    return null;
  }

  const now = details.now ?? Date.now();
  const label = details.label ?? "PartyServer";
  const durationMs =
    details.openedAt === undefined
      ? "unknown"
      : String(Math.max(0, now - details.openedAt));

  return (
    `[${label}] WebSocket closed abnormally: room=${details.roomName} ` +
    `connection=${details.connectionId} code=${details.code} ` +
    `reason=${JSON.stringify(details.reason)} wasClean=${details.wasClean} ` +
    `durationMs=${durationMs}`
  );
}

function hasCloseCode(codes: Iterable<number>, code: number): boolean {
  for (const candidate of codes) {
    if (candidate === code) return true;
  }
  return false;
}
