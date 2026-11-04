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
  /**
   * When set, a 1006 (abnormal, no close frame) close is only reported if the
   * connection lived less than this many ms. Long-lived sockets routinely end
   * with 1006 when a laptop sleeps or a network drops; short-lived ones point
   * to handshake failures or crash loops worth investigating.
   */
  abnormalCloseReportWindowMs?: number;
}

const ABNORMAL_CLOSE_CODE = 1006;

const QUIET_CLOSE_CODES = new Set([1000, 1001, 4000]);

/**
 * Close logging policy for presence sockets: normal navigation (1000/1001),
 * clean no-code closes (1005), and intentional replacement (4000) stay quiet,
 * and 1006 is only reported for connections that died within a few seconds.
 */
export const PRESENCE_CLOSE_DIAGNOSTIC_POLICY = {
  quietCloseCodes: [1000, 1001, 1005, 4000],
  abnormalCloseReportWindowMs: 5_000,
} as const satisfies Pick<
  ConnectionCloseDetails,
  "quietCloseCodes" | "abnormalCloseReportWindowMs"
>;

export function getConnectionCloseDiagnostic(
  details: ConnectionCloseDetails
): string | null {
  const quietCloseCodes = details.quietCloseCodes ?? QUIET_CLOSE_CODES;
  if (details.wasClean && hasCloseCode(quietCloseCodes, details.code)) {
    return null;
  }

  const now = details.now ?? Date.now();
  const label = details.label ?? "PartyServer";
  const elapsedMs =
    details.openedAt === undefined
      ? undefined
      : Math.max(0, now - details.openedAt);
  if (
    details.code === ABNORMAL_CLOSE_CODE &&
    details.abnormalCloseReportWindowMs !== undefined &&
    (elapsedMs === undefined || elapsedMs >= details.abnormalCloseReportWindowMs)
  ) {
    return null;
  }
  const durationMs = elapsedMs === undefined ? "unknown" : String(elapsedMs);

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
