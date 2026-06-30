// ABOUTME: Defines PartyServer abuse-limit decisions for inbound messages and room data warnings.
// ABOUTME: Keeps rate, payload, and document-size checks separate from Durable Object plumbing.
export type ServerLimits = {
  maxMessagesPerWindow: number;
  messageRateWindowMs: number;
  maxRequestBytes: number;
  maxWebSocketMessageBytes: number;
  documentWarningBytes: number;
};

export type MessageLimitState = {
  windowStartedAt: number;
  messageCount: number;
};

export type LimitViolation =
  | {
      kind: "message-rate";
      closeCode: 1008;
      reason: "Message Rate Limit Exceeded";
    }
  | {
      kind: "message-size";
      closeCode: 1009;
      reason: "Message Too Large";
    };

export type WebSocketMessagePayload = string | ArrayBuffer | ArrayBufferView;

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

function getInitialMessageLimitState(now: number): MessageLimitState {
  return { windowStartedAt: now, messageCount: 0 };
}

function getUtf8ByteLength(value: string): number {
  let size = 0;

  for (let i = 0; i < value.length; i += 1) {
    const codePoint = value.codePointAt(i);
    if (codePoint === undefined) continue;

    if (codePoint > 0xffff) {
      i += 1;
    }

    if (codePoint <= 0x7f) {
      size += 1;
    } else if (codePoint <= 0x7ff) {
      size += 2;
    } else if (codePoint <= 0xffff) {
      size += 3;
    } else {
      size += 4;
    }
  }

  return size;
}

export function getWebSocketMessageSizeBytes(
  message: WebSocketMessagePayload
): number {
  if (typeof message === "string") {
    return getUtf8ByteLength(message);
  }

  return message.byteLength;
}

export function checkWebSocketMessage({
  limits,
  messageSizeBytes,
  now,
  state,
}: {
  limits: ServerLimits;
  messageSizeBytes: number;
  now: number;
  state: MessageLimitState | undefined;
}): { state: MessageLimitState; violation: LimitViolation | null } {
  if (messageSizeBytes > limits.maxWebSocketMessageBytes) {
    return {
      state: state ?? getInitialMessageLimitState(now),
      violation: {
        kind: "message-size",
        closeCode: 1009,
        reason: "Message Too Large",
      },
    };
  }

  return checkMessageRate({ limits, now, state });
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
