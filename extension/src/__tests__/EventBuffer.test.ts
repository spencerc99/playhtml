// ABOUTME: Tests local event buffering before events cross into the background worker.
// ABOUTME: Verifies batching, upload flushing, and cached event metadata lookups.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { EventBuffer } from "../storage/EventBuffer";
import { getParticipantId, getSessionId } from "../storage/participant";
import type { CollectionEvent } from "../collectors/types";

const participantMocks = vi.hoisted(() => ({
  getParticipantId: vi.fn().mockResolvedValue("test-participant-id"),
  getSessionId: vi.fn().mockResolvedValue("test-session-id"),
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
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({});
    vi.mocked(getParticipantId).mockResolvedValue("test-participant-id");
    vi.mocked(getSessionId).mockResolvedValue("test-session-id");
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
          resolveStoreMessage = () => resolve({});
        });
      }
      return Promise.resolve({});
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

  it("reuses participant and session lookups for event metadata", async () => {
    const buffer = new EventBuffer();

    await buffer.createEvent("cursor", { event: "move", x: 0.1, y: 0.2 });
    await buffer.createEvent("viewport", { event: "scroll", scrollY: 0.3 });

    expect(getParticipantId).toHaveBeenCalledTimes(1);
    expect(getSessionId).toHaveBeenCalledTimes(1);
  });

  it("does not cache temporary participant IDs", async () => {
    vi.mocked(getParticipantId)
      .mockResolvedValueOnce("pk_temp_race")
      .mockResolvedValueOnce("pk_real");
    const buffer = new EventBuffer();

    const first = await buffer.createEvent("cursor", { event: "move" });
    const second = await buffer.createEvent("cursor", { event: "move" });

    expect(first.meta.pid).toBe("pk_temp_race");
    expect(second.meta.pid).toBe("pk_real");
    expect(getParticipantId).toHaveBeenCalledTimes(2);
  });
});
