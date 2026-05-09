// ABOUTME: Verifies PartyServer abuse limits for message rate, payload size, and document size.
// ABOUTME: Keeps limit decisions testable without a Cloudflare Durable Object runtime.
import { describe, expect, it } from "bun:test";
import {
  checkMessageLimits,
  getMessageSizeBytes,
  shouldAcceptRequestBody,
  shouldPersistDocument,
  type ServerLimits,
} from "../serverLimits";

const limits: ServerLimits = {
  maxMessagesPerWindow: 2,
  messageRateWindowMs: 1_000,
  maxMessageBytes: 10,
  maxRequestBytes: 20,
  maxDocumentBytes: 30,
};

describe("getMessageSizeBytes", () => {
  it("counts string and binary WebSocket payload bytes", () => {
    expect(getMessageSizeBytes("hello")).toBe(5);
    expect(getMessageSizeBytes("é")).toBe(2);
    expect(getMessageSizeBytes(new Uint8Array([1, 2, 3]))).toBe(3);
    expect(getMessageSizeBytes(new ArrayBuffer(4))).toBe(4);
  });
});

describe("checkMessageLimits", () => {
  it("allows messages inside the configured rate window", () => {
    const first = checkMessageLimits({
      limits,
      messageSizeBytes: 5,
      now: 1_000,
      state: undefined,
    });
    expect(first.violation).toBe(null);

    const second = checkMessageLimits({
      limits,
      messageSizeBytes: 5,
      now: 1_500,
      state: first.state,
    });
    expect(second.violation).toBe(null);
  });

  it("rejects messages above the configured rate window", () => {
    const first = checkMessageLimits({
      limits,
      messageSizeBytes: 5,
      now: 1_000,
      state: undefined,
    });
    const second = checkMessageLimits({
      limits,
      messageSizeBytes: 5,
      now: 1_100,
      state: first.state,
    });
    const third = checkMessageLimits({
      limits,
      messageSizeBytes: 5,
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
    const first = checkMessageLimits({
      limits,
      messageSizeBytes: 5,
      now: 1_000,
      state: undefined,
    });
    const second = checkMessageLimits({
      limits,
      messageSizeBytes: 5,
      now: 2_000,
      state: first.state,
    });

    expect(second.violation).toBe(null);
    expect(second.state).toEqual({ windowStartedAt: 2_000, messageCount: 1 });
  });

  it("rejects individual messages above the payload limit", () => {
    const result = checkMessageLimits({
      limits,
      messageSizeBytes: 11,
      now: 1_000,
      state: undefined,
    });

    expect(result.violation).toEqual({
      kind: "message-size",
      closeCode: 1009,
      reason: "Message Too Large",
    });
  });

  it("does not reject ordinary messages just because the document is near its limit", () => {
    const result = checkMessageLimits({
      limits,
      messageSizeBytes: 6,
      now: 1_000,
      state: undefined,
    });

    expect(result.violation).toBe(null);
  });
});

describe("shouldAcceptRequestBody", () => {
  it("rejects HTTP request bodies above the configured payload limit", () => {
    expect(shouldAcceptRequestBody(20, limits)).toBe(true);
    expect(shouldAcceptRequestBody(21, limits)).toBe(false);
  });
});

describe("shouldPersistDocument", () => {
  it("rejects autosave snapshots above the configured document limit", () => {
    expect(shouldPersistDocument(30, limits)).toBe(true);
    expect(shouldPersistDocument(31, limits)).toBe(false);
  });
});
