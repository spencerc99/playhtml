// ABOUTME: Defines PartyServer abuse-limit decisions for inbound messages and room data warnings.
// ABOUTME: Keeps rate, payload, room-size, per-IP and document-size checks separate from Durable Object plumbing.
export type ServerLimits = {
  maxMessagesPerWindow: number;
  messageRateWindowMs: number;
  maxRequestBytes: number;
  documentWarningBytes: number;
};

export type MessageLimitState = {
  windowStartedAt: number;
  messageCount: number;
};

export type LimitViolation = {
  kind: "message-rate";
  closeCode: 1008;
  reason: "Message Rate Limit Exceeded";
};

// 1013 is "Try Again Later": the client may reconnect once the room has room.
export const ROOM_FULL_CLOSE_CODE = 1013;
export const ROOM_FULL_CLOSE_REASON = "Room Full";

// The subset of Cloudflare's Workers Rate Limiting binding this module uses.
export type ConnectionRateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

// Blocked IPs already logged in this isolate, so a flood from one IP logs once
// a minute instead of once per request. Bounded so it can't grow without end.
const EDGE_RATE_LIMIT_LOG_INTERVAL_MS = 60_000;
const MAX_TRACKED_BLOCKED_IPS = 1_000;
const lastBlockLoggedAt = new Map<string, number>();

function logEdgeRateLimitBlock(ip: string, pathname: string): void {
  const now = Date.now();
  const last = lastBlockLoggedAt.get(ip);
  if (last !== undefined && now - last < EDGE_RATE_LIMIT_LOG_INTERVAL_MS) return;
  if (lastBlockLoggedAt.size >= MAX_TRACKED_BLOCKED_IPS) lastBlockLoggedAt.clear();
  lastBlockLoggedAt.set(ip, now);
  console.warn(
    `[ServerLimits] Edge rate limit: blocking ip=${ip} path=${pathname}`
  );
}
const EDGE_RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

const DURABLE_OBJECT_OVERLOAD_MESSAGE =
  "Durable Object is overloaded.";

type DurableObjectError = Error & {
  overloaded?: unknown;
};

export function checkMessageRate({
  limits,
  now,
  state,
}: {
  limits: ServerLimits;
  now: number;
  state: MessageLimitState | undefined;
}): { state: MessageLimitState; violation: LimitViolation | null } {
  const nextState =
    state && now - state.windowStartedAt < limits.messageRateWindowMs
      ? {
          windowStartedAt: state.windowStartedAt,
          messageCount: state.messageCount + 1,
        }
      : { windowStartedAt: now, messageCount: 1 };

  if (nextState.messageCount > limits.maxMessagesPerWindow) {
    return {
      state: nextState,
      violation: {
        kind: "message-rate",
        closeCode: 1008,
        reason: "Message Rate Limit Exceeded",
      },
    };
  }

  return { state: nextState, violation: null };
}

export function shouldAcceptRequestBody(
  bodySizeBytes: number,
  limits: ServerLimits
): boolean {
  return bodySizeBytes <= limits.maxRequestBytes;
}

export function shouldWarnForDocumentSize(
  documentSizeBytes: number,
  limits: ServerLimits
): boolean {
  return documentSizeBytes > limits.documentWarningBytes;
}

export function isDurableObjectOverloadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    ((error as DurableObjectError).overloaded === true ||
      error.message.startsWith(DURABLE_OBJECT_OVERLOAD_MESSAGE))
  );
}

/**
 * True when a room is already at its socket limit, so the socket connecting
 * now must be refused. `otherOpenConnections` leaves that socket out: during
 * onConnect it may or may not be listed as open yet, depending on the runtime.
 */
export function isRoomAtConnectionLimit(
  otherOpenConnections: number,
  maxConnectionsPerRoom: number
): boolean {
  return otherOpenConnections >= maxConnectionsPerRoom;
}

/** Counts open sockets other than `connection`. */
export function countOtherConnections<T>(
  connections: Iterable<T>,
  connection: T
): number {
  let count = 0;
  for (const other of connections) {
    if (other !== connection) count += 1;
  }
  return count;
}

/** True when a raw presence frame is too large to be worth parsing. */
export function isPresenceMessageTooLarge(
  message: string,
  maxChars: number
): boolean {
  return message.length > maxChars;
}

/** Reads a positive numeric limit override, falling back when it is unset or invalid. */
export function parsePositiveLimit(
  value: string | undefined,
  fallback: number
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Per-IP limit on requests to rooms (WebSocket upgrades and HTTP), checked at
 * the Worker before a Durable Object is woken. Returns the 429 to send, or null
 * to let the request through. Requests without a client IP (local tools, tests)
 * and deployments without the binding are never limited, and a limiter error
 * fails open so an outage of the limiter never takes rooms down.
 */
export async function checkEdgeRateLimit(
  request: Request,
  limiter: ConnectionRateLimiter | undefined
): Promise<Response | null> {
  if (!limiter) return null;
  if (!new URL(request.url).pathname.startsWith("/parties/")) return null;
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;

  let success: boolean;
  try {
    ({ success } = await limiter.limit({ key: ip }));
  } catch (error) {
    console.warn("[ServerLimits] Edge rate limiter failed; allowing request:", error);
    return null;
  }
  if (success) return null;

  logEdgeRateLimitBlock(ip, new URL(request.url).pathname);
  return new Response("Too Many Requests", {
    status: 429,
    headers: { "Retry-After": String(EDGE_RATE_LIMIT_RETRY_AFTER_SECONDS) },
  });
}
