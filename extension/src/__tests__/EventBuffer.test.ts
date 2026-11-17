// ABOUTME: Tests local event buffering before events cross into the background worker.
// ABOUTME: Verifies batching, upload flushing, disposal, metadata lookups, and holding events until identity resolves.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { EventBuffer, MAX_HELD_EVENTS } from "../storage/EventBuffer";
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

    await vi.advanceTimersByTimeAsync(999);

    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

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

  it("stops sending and retrying once disposed", async () => {
    const buffer = new EventBuffer();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let storeAttempts = 0;
    vi.mocked(browser.runtime.sendMessage).mockImplementation((message) => {
      if ((message as { type?: string }).type === "STORE_EVENTS") {
        storeAttempts++;
        return Promise.reject(new Error("Extension context invalidated."));
      }
      return Promise.resolve({ success: true });
    });

    await buffer.addEvent(testEvent("failed"));
    await buffer.flushBatch();
    expect(storeAttempts).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);

    // A retry is scheduled; disposing cancels it and drops the event.
    await buffer.addEvent(testEvent("buffered"));
    buffer.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(storeAttempts).toBe(1);

    await buffer.addEvent(testEvent("after-dispose"));
    await buffer.flushBatch();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("drops a store retry that fails after disposal", async () => {
    const buffer = new EventBuffer();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let rejectStore: (reason: Error) => void = () => {};
    vi.mocked(browser.runtime.sendMessage).mockImplementation((message) => {
      if ((message as { type?: string }).type === "STORE_EVENTS") {
        return new Promise((_, reject) => {
          rejectStore = reject;
        });
      }
      return Promise.resolve({ success: true });
    });

    await buffer.addEvent(clickEvent("in-flight"));
    buffer.dispose();
    rejectStore(new Error("Extension context invalidated."));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("reuses the session lookup and leaves the participant ID for storage time", async () => {
    const buffer = new EventBuffer();

    const first = await buffer.createEvent("cursor", {
      event: "move",
      x: 0.1,
      y: 0.2,
    });
    await buffer.createEvent("viewport", { event: "scroll", scrollY: 0.3 });

    expect(first.meta.sid).toBe("test-session-id");
    expect(first.meta.pid).toBeUndefined();
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    expect(requestSessionId).toHaveBeenCalledTimes(1);
  });

  it("stamps the participant's identity on stored events and asks for it once", async () => {
    const buffer = new EventBuffer();

    await buffer.addEvent(await buffer.createEvent("cursor", { event: "move" }));
    await buffer.flushBatch();
    await buffer.addEvent(await buffer.createEvent("cursor", { event: "move" }));
    await buffer.flushBatch();

    const calls = vi.mocked(browser.runtime.sendMessage).mock.calls.map(
      ([message]) => message as { type: string; events?: CollectionEvent[] },
    );
    expect(
      calls.filter((message) => message.type === "GET_PUBLIC_PLAYER_IDENTITY"),
    ).toHaveLength(1);
    const stored = calls
      .filter((message) => message.type === "STORE_EVENTS")
      .flatMap((message) => message.events ?? []);
    expect(stored).toHaveLength(2);
    expect(stored.every((event) => event.meta.pid === "test-participant-id")).toBe(true);
  });

  it("holds events without an identity and stores them once it resolves", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let identity: unknown = null;
    vi.mocked(browser.runtime.sendMessage).mockImplementation((message) => {
      if ((message as { type?: string }).type === "GET_PUBLIC_PLAYER_IDENTITY") {
        return Promise.resolve(identity);
      }
      return Promise.resolve({ success: true });
    });
    const buffer = new EventBuffer();
    const storedEvents = () =>
      vi
        .mocked(browser.runtime.sendMessage)
        .mock.calls.map(([message]) => message as { type: string; events?: CollectionEvent[] })
        .filter((message) => message.type === "STORE_EVENTS")
        .flatMap((message) => message.events ?? []);

    await buffer.addEvent(await buffer.createEvent("cursor", { event: "move" }));
    await buffer.addEvent(await buffer.createEvent("cursor", { event: "click" }));
    await buffer.flushBatch();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(storedEvents()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[EventBuffer] No player identity yet; holding events until there is one",
    );

    identity = {
      publicKey: "pk_real",
      playerStyle: { colorPalette: ["#4a9a8a"] },
    };
    await vi.advanceTimersByTimeAsync(30_000);

    const stored = storedEvents();
    expect(stored).toHaveLength(2);
    expect(stored.map((event) => event.meta.pid)).toEqual(["pk_real", "pk_real"]);
    expect(
      stored.some((event) => event.meta.pid.startsWith("pk_temp_")),
    ).toBe(false);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: "FLUSH_PENDING_UPLOADS",
    });
  });

  it("drops the oldest held events past the cap with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let identity: unknown = null;
    vi.mocked(browser.runtime.sendMessage).mockImplementation((message) => {
      if ((message as { type?: string }).type === "GET_PUBLIC_PLAYER_IDENTITY") {
        return Promise.resolve(identity);
      }
      return Promise.resolve({ success: true });
    });
    const buffer = new EventBuffer();
    const ids: string[] = [];

    for (let i = 0; i < MAX_HELD_EVENTS + 10; i++) {
      const event = await buffer.createEvent("cursor", { event: "move" });
      ids.push(event.id);
      await buffer.addEvent(event);
    }

    expect(warn).toHaveBeenCalledWith(
      `[EventBuffer] Holding more than ${MAX_HELD_EVENTS} unsaved events; dropping the oldest`,
    );
    expect(
      warn.mock.calls.filter(([message]) =>
        String(message).includes("dropping the oldest"),
      ),
    ).toHaveLength(1);

    // Waiting on identity is paced by the retry timer, not by each new event.
    expect(
      vi
        .mocked(browser.runtime.sendMessage)
        .mock.calls.filter(
          ([message]) =>
            (message as { type: string }).type === "GET_PUBLIC_PLAYER_IDENTITY",
        ).length,
    ).toBeLessThanOrEqual(2);

    identity = { publicKey: "pk_real", playerStyle: { colorPalette: [] } };
    await buffer.flushBatch();

    const stored = vi
      .mocked(browser.runtime.sendMessage)
      .mock.calls.map(([message]) => message as { type: string; events?: CollectionEvent[] })
      .filter((message) => message.type === "STORE_EVENTS")
      .flatMap((message) => message.events ?? []);
    expect(stored.map((event) => event.id)).toEqual(ids.slice(10));
  });
});
