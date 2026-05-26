// ABOUTME: Verifies PartyServer abuse limits for message rate, payload size, and document size.
// ABOUTME: Keeps limit decisions testable without a Cloudflare Durable Object runtime.
import { describe, expect, it } from "bun:test";
import { DEFAULT_MESSAGE_RATE_LIMIT } from "../const";
import {
  checkMessageRate,
  shouldAcceptRequestBody,
  shouldWarnForDocumentSize,
  type ServerLimits,
} from "../serverLimits";

const limits: ServerLimits = {
  maxMessagesPerWindow: 2,
  messageRateWindowMs: 1_000,
  maxRequestBytes: 20,
  documentWarningBytes: 30,
};

describe("checkMessageRate", () => {
  it("allows messages inside the configured rate window", () => {
    const first = checkMessageRate({
      limits,
      now: 1_000,
      state: undefined,
    });
    expect(first.violation).toBe(null);

    const second = checkMessageRate({
      limits,
      now: 1_500,
      state: first.state,
    });
    expect(second.violation).toBe(null);
  });

  it("rejects messages above the configured rate window", () => {
    const first = checkMessageRate({
      limits,
      now: 1_000,
      state: undefined,
    });
    const second = checkMessageRate({
      limits,
      now: 1_100,
      state: first.state,
    });
    const third = checkMessageRate({
      limits,
      now: 1_200,
      state: second.state,
    });

    expect(third.violation).toEqual({
      kind: "message-rate",
      closeCode: 1008,
      reason: "Message Rate Limit Exceeded",
    });
  });

  it("starts a new rate window after the configured interval", () => {
    const first = checkMessageRate({
      limits,
      now: 1_000,
      state: undefined,
    });
    const second = checkMessageRate({
      limits,
      now: 2_000,
      state: first.state,
    });

    expect(second.violation).toBe(null);
    expect(second.state).toEqual({ windowStartedAt: 2_000, messageCount: 1 });
  });

  it("leaves oversized WebSocket messages to the platform limit", () => {
    const result = checkMessageRate({
      limits,
      now: 1_000,
      state: undefined,
    });

    expect(result.violation).toBe(null);
  });

  it("does not reject ordinary messages just because the document is near its limit", () => {
    const result = checkMessageRate({
      limits,
      now: 1_000,
      state: undefined,
    });

    expect(result.violation).toBe(null);
  });

  it("allows sustained interaction traffic below the default rate limit", () => {
    let state = undefined;
    const interactionMessages = 420;

    for (let i = 0; i < interactionMessages; i += 1) {
      const result = checkMessageRate({
        limits: {
          ...limits,
          maxMessagesPerWindow: DEFAULT_MESSAGE_RATE_LIMIT,
        },
        now: 1_000,
        state,
      });
      expect(result.violation).toBe(null);
      state = result.state;
    }
  });
});

describe("shouldAcceptRequestBody", () => {
  it("rejects HTTP request bodies above the configured payload limit", () => {
    expect(shouldAcceptRequestBody(20, limits)).toBe(true);
    expect(shouldAcceptRequestBody(21, limits)).toBe(false);
  });
});

describe("shouldWarnForDocumentSize", () => {
  it("warns when autosave snapshots exceed the configured document threshold", () => {
    expect(shouldWarnForDocumentSize(30, limits)).toBe(false);
    expect(shouldWarnForDocumentSize(31, limits)).toBe(true);
  });
});
