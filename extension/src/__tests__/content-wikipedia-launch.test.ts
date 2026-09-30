// ABOUTME: Verifies launched Wikipedia collaboration survives unavailable experiment access.
// ABOUTME: Exercises the content-script gate through PlayHTML and Wikipedia initialization.
// @vitest-environment-options {"url":"https://en.wikipedia.org/wiki/Main_Page"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageGet = vi.hoisted(() => vi.fn());
const runtimeSendMessage = vi.hoisted(() => vi.fn());
const playhtml = vi.hoisted(() => ({
  createPageData: vi.fn(),
  createPresenceRoom: vi.fn(),
  cursorClient: {},
  init: vi.fn().mockResolvedValue(undefined),
  presence: {},
}));
const initWikipedia = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const maybeInjectAnnouncementToast = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: storageGet,
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      sendMessage: runtimeSendMessage,
      onMessage: { addListener: vi.fn() },
    },
  },
}));

vi.mock("playhtml", () => ({ playhtml }));

vi.mock("../custom-sites/wikipedia", () => ({ initWikipedia }));

vi.mock("../announcements/inject-toast", () => ({
  maybeInjectAnnouncementToast,
}));

vi.mock("../features/global", () => ({
  anyGlobalFeatureActive: vi.fn().mockResolvedValue(false),
  initGlobalFeatures: vi.fn(),
}));

vi.mock("../collectors/CollectorManager", () => ({
  CollectorManager: class {
    registerCollector = vi.fn();
    init = vi.fn().mockResolvedValue(undefined);
    stopAll = vi.fn();
    pauseAll = vi.fn();
    resumeAll = vi.fn();
    getCollectorStatuses = vi.fn(() => []);
  },
}));

vi.mock("../collectors/CursorCollector", () => ({ CursorCollector: class {} }));
vi.mock("../collectors/NavigationCollector", () => ({
  NavigationCollector: class {},
}));
vi.mock("../collectors/ViewportCollector", () => ({
  ViewportCollector: class {},
}));
vi.mock("../collectors/KeyboardCollector", () => ({
  KeyboardCollector: class {},
}));

describe("Wikipedia launch contract", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
    document.documentElement.removeAttribute("data-playhtml");
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    playhtml.init.mockClear();
    initWikipedia.mockClear();
    maybeInjectAnnouncementToast.mockClear();

    storageGet.mockImplementation((keys: string | string[]) => {
      if (keys === "wwoFeatureAccess") {
        return Promise.resolve({
          wwoFeatureAccess: {
            features: {
              COPRESENCE: { stage: "internal", available: false },
            },
            checkedAt: 1,
          },
        });
      }
      if (keys === "wwoFeatureOverrides") {
        return Promise.resolve({ wwoFeatureOverrides: {} });
      }
      return Promise.resolve({});
    });

    runtimeSendMessage.mockImplementation((message: { type?: string }) => {
      if (message.type === "GET_PUBLIC_PLAYER_IDENTITY") {
        return Promise.resolve({
          publicKey: "pk_test",
          playerStyle: { colorPalette: ["#4a9a8a"] },
        });
      }
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("initializes Wikipedia when COPRESENCE experiment access is unavailable", async () => {
    expect(window.location.hostname).toBe("en.wikipedia.org");

    const contentScript = (await import("../entrypoints/content")).default as {
      main: () => void;
    };

    contentScript.main();
    await vi.waitFor(() => {
      expect(storageGet).toHaveBeenCalledWith("wwoFeatureAccess");
    });

    await vi.waitFor(
      () => {
        expect(playhtml.init).toHaveBeenCalledWith(
          expect.objectContaining({
            cursors: expect.objectContaining({ enabled: true }),
          }),
        );
        expect(initWikipedia).toHaveBeenCalledOnce();
        expect(maybeInjectAnnouncementToast).toHaveBeenCalledOnce();
      },
      { timeout: 3_000 },
    );
  });
});
