// ABOUTME: Covers storage-time dedup for internet scraps in the STORE_EVENTS handler.
// ABOUTME: Verifies canonical-key dedup across batches, lazy init, and concurrency.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "@playhtml/extension-types";

const originalDefineBackground = (globalThis as any).defineBackground;

function makeElementEvent(
  id: string,
  data: Record<string, unknown>,
  url = "https://example.com/",
): CollectionEvent {
  return {
    id,
    type: "element",
    ts: 1,
    data,
    meta: {
      pid: "pid",
      sid: "sid",
      url,
      vw: 1024,
      vh: 768,
      tz: "America/Los_Angeles",
    },
  } as CollectionEvent;
}

function makeNavigationEvent(id: string): CollectionEvent {
  return {
    id,
    type: "navigation",
    ts: 1,
    data: { event: "focus" },
    meta: {
      pid: "pid",
      sid: "sid",
      url: "https://example.com/",
      vw: 1024,
      vh: 768,
      tz: "America/Los_Angeles",
    },
  } as CollectionEvent;
}

const buttonData = (text: string, backgroundColor = "rgb(1, 2, 3)") => ({
  kind: "button",
  text,
  styles: { backgroundColor },
  pageTitle: "A page",
});

interface Setup {
  store: {
    addEvents: ReturnType<typeof vi.fn>;
    queryByType: ReturnType<typeof vi.fn>;
  };
  listener: (message: any, sender: any, sendResponse: (r?: any) => void) => boolean;
}

async function setupBackground(existingElementEvents: CollectionEvent[] = []): Promise<Setup> {
  vi.resetModules();
  vi.restoreAllMocks();

  const addEvents = vi.fn().mockResolvedValue(undefined);
  const queryByType = vi.fn().mockResolvedValue(existingElementEvents);
  const onMessageAddListener = vi.fn();

  vi.doMock("../storage/LocalEventStore", () => ({
    LocalEventStore: vi.fn(() => ({ addEvents, queryByType })),
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
      },
      tabs: {
        create: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
      alarms: {
        create: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      },
    },
  }));

  (globalThis as any).defineBackground = (setup: () => void) => {
    setup();
    return setup;
  };

  await import("../entrypoints/background");
  const listener = onMessageAddListener.mock.calls[0][0];
  return { store: { addEvents, queryByType }, listener };
}

function storeEvents(
  listener: Setup["listener"],
  events: CollectionEvent[],
): Promise<unknown> {
  return new Promise((resolve) => {
    const handled = listener({ type: "STORE_EVENTS", events }, {}, resolve);
    expect(handled).toBe(true);
  });
}

describe("background scrap storage dedup", () => {
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

  it("persists only the first of two events sharing a canonical key", async () => {
    const { store, listener } = await setupBackground();

    const first = makeElementEvent("a", buttonData("Subscribe"));
    const second = makeElementEvent("b", buttonData("Subscribe"));

    const response = await storeEvents(listener, [first, second]);

    expect(response).toEqual({ success: true });
    expect(store.addEvents).toHaveBeenCalledTimes(1);
    const persisted = store.addEvents.mock.calls[0][0] as CollectionEvent[];
    expect(persisted.map((e) => e.id)).toEqual(["a"]);
  });

  it("persists both events when canonical keys differ", async () => {
    const { store, listener } = await setupBackground();

    const first = makeElementEvent("a", buttonData("Subscribe"));
    const second = makeElementEvent("b", buttonData("Unsubscribe"));

    await storeEvents(listener, [first, second]);

    const persisted = store.addEvents.mock.calls[0][0] as CollectionEvent[];
    expect(persisted.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("scans the store once across sequential batches", async () => {
    const { store, listener } = await setupBackground();

    await storeEvents(listener, [makeElementEvent("a", buttonData("Subscribe"))]);
    await storeEvents(listener, [makeElementEvent("b", buttonData("Unsubscribe"))]);
    await storeEvents(listener, [makeElementEvent("c", buttonData("Follow"))]);

    expect(store.queryByType).toHaveBeenCalledTimes(1);
  });

  it("drops a duplicate arriving in a later batch", async () => {
    const { store, listener } = await setupBackground();

    const first = makeElementEvent("a", buttonData("Subscribe"));
    await storeEvents(listener, [first]);

    const duplicateLater = makeElementEvent("c", buttonData("Subscribe"));
    await storeEvents(listener, [duplicateLater]);

    expect(store.addEvents).toHaveBeenCalledTimes(2);
    const secondBatchPersisted = store.addEvents.mock.calls[1][0] as CollectionEvent[];
    expect(secondBatchPersisted).toEqual([]);
  });

  it("picks up canonical keys from events already in the store on lazy init", async () => {
    const alreadyStored = makeElementEvent("existing", buttonData("Subscribe"));
    const { store, listener } = await setupBackground([alreadyStored]);

    const duplicate = makeElementEvent("new", buttonData("Subscribe"));
    await storeEvents(listener, [duplicate]);

    expect(store.queryByType).toHaveBeenCalledWith("element");
    const persisted = store.addEvents.mock.calls[0][0] as CollectionEvent[];
    expect(persisted).toEqual([]);
  });

  it("leaves non-element events unaffected", async () => {
    const { store, listener } = await setupBackground();

    const nav1 = makeNavigationEvent("nav-1");
    const nav2 = makeNavigationEvent("nav-2");
    await storeEvents(listener, [nav1, nav2]);

    const persisted = store.addEvents.mock.calls[0][0] as CollectionEvent[];
    expect(persisted.map((e) => e.id)).toEqual(["nav-1", "nav-2"]);
    // No element events in the batch, so the store is never scanned.
    expect(store.queryByType).not.toHaveBeenCalled();
  });

  it("collapses duplicates within a single batch", async () => {
    const { store, listener } = await setupBackground();

    const first = makeElementEvent("a", buttonData("Subscribe"));
    const second = makeElementEvent("b", buttonData("Subscribe"));
    const third = makeElementEvent("c", buttonData("Different"));

    await storeEvents(listener, [first, second, third]);

    const persisted = store.addEvents.mock.calls[0][0] as CollectionEvent[];
    expect(persisted.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("does not race two concurrent batches into duplicate scans or duplicate persistence", async () => {
    const { store, listener } = await setupBackground();

    const first = makeElementEvent("a", buttonData("Subscribe"));
    const second = makeElementEvent("b", buttonData("Subscribe"));

    // Fire both batches without awaiting the first, so their lazy-init
    // scans would race if not guarded by a single in-flight promise.
    const [firstResponse, secondResponse] = await Promise.all([
      storeEvents(listener, [first]),
      storeEvents(listener, [second]),
    ]);

    expect(firstResponse).toEqual({ success: true });
    expect(secondResponse).toEqual({ success: true });
    expect(store.queryByType).toHaveBeenCalledTimes(1);

    const allPersistedIds = store.addEvents.mock.calls.flatMap((call) =>
      (call[0] as CollectionEvent[]).map((e) => e.id),
    );
    expect(allPersistedIds).toEqual(["a"]);
  });
});
