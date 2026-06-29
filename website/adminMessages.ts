// ABOUTME: Formats admin console warnings and results for room reset operations.
// ABOUTME: Keeps client-disconnect copy consistent across database edit routes.
export interface AdminResetWarningOptions {
  action: string;
  activeConnections: number;
  detail?: string;
}

export interface AdminResetSuccessOptions {
  action: string;
  closedConnections?: number | null;
  documentSize?: number | null;
}

function formatActiveClients(count: number): string {
  return `${count} active ${count === 1 ? "client" : "clients"}`;
}

function formatDocumentSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

export function formatAdminResetWarning({
  action,
  activeConnections,
  detail,
}: AdminResetWarningOptions): string {
  return [
    action,
    detail,
    `This will reset the room and briefly disconnect ${formatActiveClients(
      activeConnections
    )}. Connected clients should reconnect automatically with the saved data.`,
    "Continue?",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function formatAdminResetSuccess({
  action,
  closedConnections,
  documentSize,
}: AdminResetSuccessOptions): string {
  const lines = [action];

  if (typeof closedConnections === "number") {
    lines.push(`Reset ${formatActiveClients(closedConnections)}.`);
  }

  if (typeof documentSize === "number") {
    lines.push(`Document size: ${formatDocumentSize(documentSize)}.`);
  }

  return lines.join("\n\n");
}
