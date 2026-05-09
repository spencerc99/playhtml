// ABOUTME: Defines PartyServer abuse-limit decisions for inbound messages and stored room data.
// ABOUTME: Keeps rate, payload, and document-size checks separate from Durable Object plumbing.
export type ServerLimits = {
  maxMessagesPerWindow: number;
  messageRateWindowMs: number;
  maxMessageBytes: number;
  maxRequestBytes: number;
  maxDocumentBytes: number;
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
    }
  | {
      kind: "document-size";
      closeCode: 1009;
      reason: "Document Too Large";
    };

export function getMessageSizeBytes(message: unknown): number {
  if (typeof message === "string") {
    return new TextEncoder().encode(message).byteLength;
  }

  if (message instanceof ArrayBuffer) {
    return message.byteLength;
  }

  if (ArrayBuffer.isView(message)) {
    return message.byteLength;
  }

  return 0;
}

export function checkMessageLimits({
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
  const nextState =
    state && now - state.windowStartedAt < limits.messageRateWindowMs
      ? {
          windowStartedAt: state.windowStartedAt,
          messageCount: state.messageCount + 1,
        }
      : { windowStartedAt: now, messageCount: 1 };

  if (messageSizeBytes > limits.maxMessageBytes) {
    return {
      state: nextState,
      violation: {
        kind: "message-size",
        closeCode: 1009,
        reason: "Message Too Large",
      },
    };
  }

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

export function shouldPersistDocument(
  documentSizeBytes: number,
  limits: ServerLimits
): boolean {
  return documentSizeBytes <= limits.maxDocumentBytes;
}
