// ABOUTME: Defines PartyServer abuse-limit decisions for inbound messages and room data warnings.
// ABOUTME: Keeps rate, payload, and document-size checks separate from Durable Object plumbing.
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
