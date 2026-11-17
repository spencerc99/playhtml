// ABOUTME: Tests that History API navigations reach the content script once per URL.
// ABOUTME: Covers the background relay (main frame only, missing receivers, no webNavigation) and the content-side de-dupe.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SAME_DOCUMENT_NAVIGATION_MESSAGE,
  onEachNewUrl,
  relaySameDocumentNavigations,
  type HistoryStateEvents,
} from "../utils/sameDocumentNavigation";

type Details = { tabId: number; frameId: number; url: string };

function fakeWebNavigation() {
  let listener: ((details: Details) => void) | null = null;
  const webNavigation: HistoryStateEvents = {
    onHistoryStateUpdated: {
      addListener: (callback) => {
        listener = callback;
      },
    },
  };
  return {
    webNavigation,
    fire: (details: Details) => {
      if (!listener) throw new Error("no listener registered");
      listener(details);
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("relaySameDocumentNavigations", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends main-frame History API navigations to that tab's top frame", async () => {
    const { webNavigation, fire } = fakeWebNavigation();
    const sendToTab = vi.fn().mockResolvedValue({ success: true });

    expect(relaySameDocumentNavigations(webNavigation, sendToTab)).toBe(true);
    fire({ tabId: 7, frameId: 0, url: "https://app.example/b" });
    fire({ tabId: 7, frameId: 3, url: "https://ads.example/frame" });
    await flush();

    expect(sendToTab).toHaveBeenCalledTimes(1);
    expect(sendToTab).toHaveBeenCalledWith(
      7,
      { type: SAME_DOCUMENT_NAVIGATION_MESSAGE, url: "https://app.example/b" },
      { frameId: 0 },
    );
  });

  it("stays quiet when the tab has no content script listening", async () => {
    const { webNavigation, fire } = fakeWebNavigation();
    const warn = vi.spyOn(console, "warn");
    const sendToTab = vi
      .fn()
      .mockRejectedValue(
        new Error("Could not establish connection. Receiving end does not exist."),
      );

    relaySameDocumentNavigations(webNavigation, sendToTab);
    fire({ tabId: 7, frameId: 0, url: "https://app.example/b" });
    await flush();

    expect(sendToTab).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs other send failures", async () => {
    const { webNavigation, fire } = fakeWebNavigation();
    const failure = new Error("No tab with id: 7.");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    relaySameDocumentNavigations(webNavigation, vi.fn().mockRejectedValue(failure));
    fire({ tabId: 7, frameId: 0, url: "https://app.example/b" });
    await flush();

    expect(warn).toHaveBeenCalledWith(
      "[Navigation] Could not tell the tab about a page change:",
      failure,
    );
  });

  it("does nothing in a browser without webNavigation history events", () => {
    const sendToTab = vi.fn();
    expect(relaySameDocumentNavigations(undefined, sendToTab)).toBe(false);
    expect(relaySameDocumentNavigations({}, sendToTab)).toBe(false);
  });
});

describe("onEachNewUrl", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/start");
  });

  it("handles a pushState URL once even when popstate and the relay both report it", () => {
    const handle = vi.fn();
    const handleNavigation = onEachNewUrl(handle);

    window.history.pushState({}, "", "/next");
    handleNavigation();
    handleNavigation();

    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("ignores a replaceState that keeps the URL and handles the next change", () => {
    const handle = vi.fn();
    const handleNavigation = onEachNewUrl(handle);

    window.history.replaceState({ scroll: 10 }, "", "/start");
    handleNavigation();
    expect(handle).not.toHaveBeenCalled();

    window.history.pushState({}, "", "/other");
    handleNavigation();
    expect(handle).toHaveBeenCalledTimes(1);
  });
});

describe("background wiring", () => {
  const originalDefineBackground = (globalThis as any).defineBackground;

  afterEach(() => {
    vi.resetModules();
    if (originalDefineBackground === undefined) {
      delete (globalThis as any).defineBackground;
    } else {
      (globalThis as any).defineBackground = originalDefineBackground;
    }
  });

  it("relays the page's pushState from the background entrypoint to the tab", async () => {
    vi.resetModules();
    const { webNavigation, fire } = fakeWebNavigation();
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    vi.doMock("../storage/LocalEventStore", () => ({
      LocalEventStore: vi.fn(() => ({
        getPendingEvents: vi.fn(),
        markEventsAsUploaded: vi.fn(),
        addEvents: vi.fn(),
        getGlobalStats: vi.fn(),
        getAllDomains: vi.fn(),
        getAllEvents: vi.fn(),
      })),
    }));
    vi.doMock("../storage/sync", () => ({ uploadEvents: vi.fn() }));
    vi.doMock("../storage/restore", () => ({ restoreEventsFromServer: vi.fn() }));
    vi.doMock("webextension-polyfill", () => ({
      default: {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
        runtime: {
          onInstalled: { addListener: vi.fn() },
          onMessage: { addListener: vi.fn() },
          getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
        },
        tabs: { create: vi.fn().mockResolvedValue(undefined), sendMessage },
        alarms: {
          get: vi.fn().mockResolvedValue(undefined),
          create: vi.fn(),
          onAlarm: { addListener: vi.fn() },
        },
        webNavigation: {
          ...webNavigation,
          onBeforeNavigate: { addListener: vi.fn() },
          onCommitted: { addListener: vi.fn() },
        },
      },
    }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    (globalThis as any).defineBackground = (setup: () => void) => {
      setup();
      return setup;
    };

    await import("../entrypoints/background");
    fire({ tabId: 4, frameId: 0, url: "https://app.example/route" });
    await flush();

    expect(sendMessage).toHaveBeenCalledWith(
      4,
      { type: SAME_DOCUMENT_NAVIGATION_MESSAGE, url: "https://app.example/route" },
      { frameId: 0 },
    );
    vi.unstubAllGlobals();
  });
});
