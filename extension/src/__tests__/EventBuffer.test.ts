// ABOUTME: Tests local event buffering before events cross into the background worker.
// ABOUTME: Verifies batching, upload flushing, and cached event metadata lookups.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { EventBuffer } from "../storage/EventBuffer";
import { requestSessionId } from "../storage/participant";
import type { CollectionEvent } from "../collectors/types";

const participantMocks = vi.hoisted(() => ({
  requestSessionId: vi.fn().mockResolvedValue("test-session-id"),
  getTimezone: vi.fn().mockReturnValue("America/New_York"),
}));

vi.mock("../storage/participant", () => participantMocks);

function testEvent(id: string): CollectionEvent {
  return {
    id,
    type: "cursor",
    ts: Date.now(),
    data: { event: "move", x: 0.5, y: 0.5 },
    meta: {
      pid: "pid",
      sid: "sid",
      url: "https://example.com/",
      vw: 1024,
      vh: 768,
      tz: "America/New_York",
    },
  };
}

function clickEvent(id: string): CollectionEvent {
  return {
    ...testEvent(id),
    data: { event: "click", x: 0.5, y: 0.5, quantity: 1 },
  };
}

describe("EventBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(browser.runtime.sendMessage).mockImplementation((message) => {
      if ((message as { type?: string }).type === "GET_PUBLIC_PLAYER_IDENTITY") {
        return Promise.resolve({
          publicKey: "test-participant-id",
          playerStyle: { colorPalette: ["#4a9a8a"] },
        });
      }
      return Promise.resolve({ success: true });
    });
    vi.mocked(requestSessionId).mockResolvedValue("test-session-id");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("batches stored events before sending them to the background", async () => {
    const buffer = new EventBuffer();

    await buffer.addEvent(testEvent("one"));
    await buffer.addEvent(testEvent("two"));

    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: "STORE_EVENTS",
      events: [
        expect.objectContaining({ id: "one", uploaded: false }),
        expect.objectContaining({ id: "two", uploaded: false }),
      ],
    });
  });

  it("flushes queued events before asking the background to upload", async () => {
    const buffer = new EventBuffer();

    await buffer.addEvent(testEvent("queued"));
    await buffer.flushBatch();

    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      type: "STORE_EVENTS",
      events: [expect.objectContaining({ id: "queued", uploaded: false })],
    });
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      type: "FLUSH_PENDING_UPLOADS",
    });
  });

  it("stores cursor click events without waiting for the storage timer", async () => {
    const buffer = new EventBuffer();

    await buffer.addEvent(clickEvent("click"));

    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: "STORE_EVENTS",
      events: [expect.objectContaining({ id: "click", uploaded: false })],
    });
  });

  it("waits for an active storage write before asking the background to upload", async () => {
    const buffer = new EventBuffer();
    let resolveStoreMessage: (() => void) | undefined;

    vi.mocked(browser.runtime.sendMessage).mockImplementation((message) => {
      if ((message as { type?: string }).type === "STORE_EVENTS") {
        return new Promise((resolve) => {
          resolveStoreMessage = () => resolve({ success: true });
        });
      }
      return Promise.resolve({ success: true });
    });

    for (let i = 0; i < 25; i++) {
      await buffer.addEvent(testEvent(`event-${i}`));
    }

    const flushPromise = buffer.flushBatch();
    await Promise.resolve();

    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      type: "STORE_EVENTS",
      events: expect.arrayContaining([
        expect.objectContaining({ id: "event-0", uploaded: false }),
        expect.objectContaining({ id: "event-24", uploaded: false }),
      ]),
    });

    resolveStoreMessage?.();
    await flushPromise;

    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      type: "FLUSH_PENDING_UPLOADS",
    });
  });

  it("automatically retries failed storage writes with backoff", async () => {
    const buffer = new EventBuffer();
    let storeAttempts = 0;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    vi.mocked(browser.runtime.sendMessage).mockImplementation((message) => {
      if ((message as { type?: string }).type === "STORE_EVENTS") {
        storeAttempts++;
        return Promise.resolve({ success: storeAttempts > 2 });
      }
      return Promise.resolve({ success: true });
    });

    await buffer.addEvent(testEvent("retry"));
    await buffer.flushBatch();

    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "[EventBuffer] Background failed to store events",
    );

    await vi.advanceTimersByTimeAsync(999);
    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);

    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(3, {
      type: "STORE_EVENTS",
      events: [expect.objectContaining({ id: "retry", uploaded: false })],
    });
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(4, {
      type: "FLUSH_PENDING_UPLOADS",
    });
  });

  it("automatically retries rejected storage messages", async () => {
    const buffer = new EventBuffer();
    const storageError = new Error("background unavailable");
    let storeAttempts = 0;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    vi.mocked(browser.runtime.sendMessage).mockImplementation((message) => {
      if ((message as { type?: string }).type === "STORE_EVENTS") {
        storeAttempts++;
        return storeAttempts === 1
          ? Promise.reject(storageError)
          : Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: true });
    });

    await buffer.addEvent(testEvent("retry-rejection"));
    await buffer.flushBatch();

    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(storageError);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      type: "STORE_EVENTS",
      events: [
        expect.objectContaining({ id: "retry-rejection", uploaded: false }),
      ],
    });
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(3, {
      type: "FLUSH_PENDING_UPLOADS",
    });
  });

  it("caps storage retry backoff at 30 seconds", async () => {
    const buffer = new EventBuffer();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ success: false });

    await buffer.addEvent(testEvent("retry-cap"));
    await buffer.flushBatch();

    const retryDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const [index, retryDelay] of retryDelays.entries()) {
      await vi.advanceTimersByTimeAsync(retryDelay - 1);
      expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(index + 1);

      await vi.advanceTimersByTimeAsync(1);
      expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(index + 2);
    }

    expect(error).toHaveBeenCalledTimes(retryDelays.length + 1);
  });

  it("reuses participant and session lookups for event metadata", async () => {
    const buffer = new EventBuffer();

    const first = await buffer.createEvent("cursor", {
      event: "move",
      x: 0.1,
      y: 0.2,
    });
    await buffer.createEvent("viewport", { event: "scroll", scrollY: 0.3 });

    expect(first.meta.pid).toBe("test-participant-id");
    expect(browser.runtime.sendMessage).toHaveBeenCalledOnce();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: "GET_PUBLIC_PLAYER_IDENTITY",
    });
    expect(requestSessionId).toHaveBeenCalledTimes(1);
  });

  it("does not cache temporary participant IDs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const identities = [
      null,
      {
        publicKey: "pk_real",
        playerStyle: { colorPalette: ["#4a9a8a"] },
      },
    ];
    vi.mocked(browser.runtime.sendMessage).mockImplementation((message) => {
      if ((message as { type?: string }).type === "GET_PUBLIC_PLAYER_IDENTITY") {
        return Promise.resolve(identities.shift());
      }
      return Promise.resolve({});
    });
    const buffer = new EventBuffer();

    const first = await buffer.createEvent("cursor", { event: "move" });
    const second = await buffer.createEvent("cursor", { event: "move" });

    expect(first.meta.pid.startsWith("pk_temp_")).toBe(true);
    expect(second.meta.pid).toBe("pk_real");
    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      "[EventBuffer] playerIdentity not found, using temporary ID",
    );
  });
});
