// ABOUTME: Verifies the background import handler reports what it actually stored.
// ABOUTME: Guards skipped-record counting and the scraps refresh broadcast.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "@playhtml/extension-types";
import { gzipEventExport } from "../utils/dataTransfer";

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

async function loadBackground(addImportedEvents: ReturnType<typeof vi.fn>) {
  const onMessageAddListener = vi.fn();
  const sendMessage = vi.fn().mockResolvedValue(undefined);

  vi.doMock("../storage/LocalEventStore", () => ({
    LocalEventStore: vi.fn(() => ({ addImportedEvents })),
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

async function importEvents(
  listener: (message: unknown, sender: unknown, reply: unknown) => boolean,
  events: CollectionEvent[],
) {
  const compressed = await gzipEventExport(events, null, Date.now());
  return new Promise<{
    success: boolean;
    imported: number;
    alreadyHeld: number;
  }>((resolve) => {
    listener(
      { type: "IMPORT_EVENTS", data: Array.from(compressed) },
      {},
      resolve,
    );
  });
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
    const addImportedEvents = vi.fn().mockResolvedValue([submitted[0]]);
    const { listener, sendMessage } = await loadBackground(addImportedEvents);

    const response = await importEvents(listener, submitted);

    expect(addImportedEvents).toHaveBeenCalledTimes(1);
    expect(addImportedEvents.mock.calls[0][0]).toHaveLength(3);
    expect(response).toEqual({
      success: true,
      imported: 1,
      alreadyHeld: 2,
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: "SCRAP_PHOTOS_UPDATED" });
  });

  it("reports nothing imported when every record was already held", async () => {
    const submitted = [elementEvent("already-a"), elementEvent("already-b")];
    const addImportedEvents = vi.fn().mockResolvedValue([]);
    const { listener, sendMessage } = await loadBackground(addImportedEvents);

    const response = await importEvents(listener, submitted);

    expect(response).toEqual({
      success: true,
      imported: 0,
      alreadyHeld: 2,
    });
    expect(sendMessage).not.toHaveBeenCalledWith({
      type: "SCRAP_PHOTOS_UPDATED",
    });
  });

  it("preserves each event's timestamp through the import message", async () => {
    const addImportedEvents = vi.fn().mockResolvedValue([]);
    const { listener } = await loadBackground(addImportedEvents);

    await importEvents(listener, [elementEvent("kept")]);

    expect(addImportedEvents.mock.calls[0][0][0].ts).toBe(1787288971906);
  });
});
