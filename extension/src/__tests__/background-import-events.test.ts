// ABOUTME: Verifies the background import handlers report what they actually stored.
// ABOUTME: Guards skipped-record counting, the single stats rebuild, and the scraps refresh broadcast.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "@playhtml/extension-types";

const originalDefineBackground = (globalThis as any).defineBackground;

function elementEvent(id: string): CollectionEvent {
  return {
    id,
    type: "element",
    ts: 1787288971906,
    data: {
      kind: "image",
      src: `https://cdn.example.com/${id}.jpg`,
      naturalWidth: 1280,
      naturalHeight: 720,
      pageTitle: "A page",
    },
    meta: {
      pid: "pk_importer",
      sid: "sid_importer",
      url: "https://example.com/page",
      vw: 1440,
      vh: 900,
      tz: "America/Los_Angeles",
    },
    domain: "example.com",
  } as CollectionEvent;
}

async function loadBackground(
  addImportedEventBatch: ReturnType<typeof vi.fn>,
  rebuildStatsAfterImport = vi.fn().mockResolvedValue(undefined),
) {
  const onMessageAddListener = vi.fn();
  const sendMessage = vi.fn().mockResolvedValue(undefined);

  vi.doMock("../storage/LocalEventStore", () => ({
    LocalEventStore: vi.fn(() => ({
      addImportedEventBatch,
      rebuildStatsAfterImport,
    })),
  }));
  vi.doMock("../storage/sync", () => ({ uploadEvents: vi.fn() }));
  vi.doMock("../storage/restore", () => ({ fetchEventsByPid: vi.fn() }));
  vi.doMock("webextension-polyfill", () => ({
    default: {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: onMessageAddListener },
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
        sendMessage,
      },
      tabs: {
        create: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
    },
  }));

  (globalThis as any).defineBackground = (setup: () => void) => {
    setup();
    return setup;
  };

  await import("../entrypoints/background");
  return { listener: onMessageAddListener.mock.calls[0][0], sendMessage };
}

function send<T>(
  listener: (message: unknown, sender: unknown, reply: unknown) => boolean,
  message: unknown,
) {
  return new Promise<T>((resolve) => {
    listener(message, {}, resolve);
  });
}

function importBatch(
  listener: (message: unknown, sender: unknown, reply: unknown) => boolean,
  events: CollectionEvent[],
) {
  return send<{
    success: boolean;
    imported: number;
    alreadyHeld: number;
    scrapsAdded: boolean;
  }>(listener, { type: "IMPORT_EVENT_BATCH", events });
}

describe("background event import", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalDefineBackground === undefined) {
      delete (globalThis as any).defineBackground;
    } else {
      (globalThis as any).defineBackground = originalDefineBackground;
    }
  });

  it("counts stored records apart from ones the store already held", async () => {
    const submitted = [
      elementEvent("kept"),
      elementEvent("already-a"),
      elementEvent("already-b"),
    ];
    const addImportedEventBatch = vi.fn().mockResolvedValue([submitted[0]]);
    const { listener } = await loadBackground(addImportedEventBatch);

    const response = await importBatch(listener, submitted);

    expect(addImportedEventBatch).toHaveBeenCalledTimes(1);
    expect(addImportedEventBatch.mock.calls[0][0]).toHaveLength(3);
    expect(response).toEqual({
      success: true,
      imported: 1,
      alreadyHeld: 2,
      scrapsAdded: true,
    });
  });

  it("reports nothing imported when every record was already held", async () => {
    const submitted = [elementEvent("already-a"), elementEvent("already-b")];
    const addImportedEventBatch = vi.fn().mockResolvedValue([]);
    const { listener } = await loadBackground(addImportedEventBatch);

    const response = await importBatch(listener, submitted);

    expect(response).toEqual({
      success: true,
      imported: 0,
      alreadyHeld: 2,
      scrapsAdded: false,
    });
  });

  it("preserves each event's timestamp through the batch message", async () => {
    const addImportedEventBatch = vi.fn().mockResolvedValue([]);
    const { listener } = await loadBackground(addImportedEventBatch);

    await importBatch(listener, [elementEvent("kept")]);

    expect(addImportedEventBatch.mock.calls[0][0][0].ts).toBe(1787288971906);
  });

  it("rebuilds stats once when the import finishes and refreshes scraps", async () => {
    const rebuildStatsAfterImport = vi.fn().mockResolvedValue(undefined);
    const { listener, sendMessage } = await loadBackground(
      vi.fn(),
      rebuildStatsAfterImport,
    );

    const response = await send(listener, {
      type: "FINISH_IMPORT",
      scrapsAdded: true,
    });

    expect(response).toEqual({ success: true });
    expect(rebuildStatsAfterImport).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: "SCRAP_PHOTOS_UPDATED" });
  });

  it("skips the scraps refresh when the import added no scraps", async () => {
    const { listener, sendMessage } = await loadBackground(vi.fn());

    await send(listener, { type: "FINISH_IMPORT", scrapsAdded: false });

    expect(sendMessage).not.toHaveBeenCalledWith({
      type: "SCRAP_PHOTOS_UPDATED",
    });
  });
});
