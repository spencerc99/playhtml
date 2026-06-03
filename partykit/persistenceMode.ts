// ABOUTME: Defines persistence availability helpers for PartyServer degradation.
// ABOUTME: Formats operator-facing outage logs and admin responses.
export type PersistenceMode =
  | { kind: "available" }
  | {
      kind: "transient";
      reason: string;
      failedAt: number;
    };

export type PersistenceFailureDetails = {
  roomName: string;
  timeoutMs: number;
  error: unknown;
};

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function withTimeout<T>(
  operation: PromiseLike<T>,
  {
    timeoutMs,
    errorMessage,
  }: {
    timeoutMs: number;
    errorMessage: string;
  }
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export function formatPersistenceFailureLog({
  roomName,
  timeoutMs,
  error,
}: PersistenceFailureDetails): string {
  return [
    `[PartyServer] SUPABASE PERSISTENCE UNAVAILABLE: room=${roomName}`,
    `timeoutMs=${timeoutMs}`,
    `reason=${getErrorMessage(error)}`,
    "Entering TRANSIENT MODE: realtime sync and awareness may continue, autosave disabled, admin writes disabled.",
  ].join(" ");
}

export function createPersistenceUnavailableResponse(
  mode: Extract<PersistenceMode, { kind: "transient" }> & { roomName: string }
): Response {
  return new Response(
    JSON.stringify({
      error: "persistence_unavailable",
      message:
        "Supabase persistence is unavailable for this room; admin writes are disabled while realtime runs in transient mode.",
      roomId: mode.roomName,
      failedAt: new Date(mode.failedAt).toISOString(),
      reason: mode.reason,
    }),
    {
      status: 503,
      headers: { "content-type": "application/json" },
    }
  );
}
