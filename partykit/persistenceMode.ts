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
  attempts: number;
  error: unknown;
};

export type PersistenceRetryDetails = {
  attempt: number;
  attempts: number;
  retryAfterMs: number;
  error: unknown;
};

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  {
    timeoutMs,
    errorMessage,
  }: {
    timeoutMs: number;
    errorMessage: string;
  }
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(errorMessage);
          reject(error);
          controller.abort(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export async function retryWithTimeout<T>(
  operation: (signal: AbortSignal, attempt: number) => PromiseLike<T>,
  {
    attempts,
    timeoutMs,
    retryDelayMs,
    errorMessage,
    onRetry,
  }: {
    attempts: number;
    timeoutMs: number;
    retryDelayMs: number;
    errorMessage: string;
    onRetry?: (details: PersistenceRetryDetails) => void;
  }
): Promise<T> {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("Persistence load attempts must be a positive integer");
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await withTimeout((signal) => operation(signal, attempt), {
        timeoutMs,
        errorMessage,
      });
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;

      const retryAfterMs = retryDelayMs * 2 ** (attempt - 1);
      onRetry?.({ attempt, attempts, retryAfterMs, error });
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    }
  }

  throw lastError;
}

export function formatPersistenceFailureLog({
  roomName,
  timeoutMs,
  attempts,
  error,
}: PersistenceFailureDetails): string {
  return [
    `[PartyServer] SUPABASE PERSISTENCE UNAVAILABLE: room=${roomName}`,
    `timeoutMs=${timeoutMs}`,
    `attempts=${attempts}`,
    `reason=${getErrorMessage(error)}`,
    "Entering RECOVERY MODE: connections closed with 1013, shared-data writes disabled, autosave disabled, admin writes disabled.",
  ].join(" ");
}

export function createPersistenceUnavailableResponse(
  mode: Extract<PersistenceMode, { kind: "transient" }> & { roomName: string }
): Response {
  return new Response(
    JSON.stringify({
      error: "persistence_unavailable",
      message:
        "Supabase persistence is unavailable for this room; clients reconnect after document recovery completes.",
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
