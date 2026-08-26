// ABOUTME: Regression tests for lazy milestone UI handling in the content script.
// ABOUTME: Verifies repeated milestone messages replace the visible injected UI.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: vi.fn().mockImplementation((keys: string | string[]) => {
          if (keys === "wwoFeatureAccess") {
            return Promise.resolve({
              wwoFeatureAccess: { features: { BOTTLES: { stage: "internal", available: true } }, checkedAt: 123 },
            });
          }
          if (keys === "wwoFeatureOverrides") {
            return Promise.resolve({
              wwoFeatureOverrides: {
                COPRESENCE: false,
                BOTTLES: false,
                INVENTORY: false,
              },
            });
          }
          if (!Array.isArray(keys)) return Promise.resolve({});

          return Promise.resolve(
            Object.fromEntries(
              keys
                .filter((key) => key.startsWith("migration_v1_done_"))
                .map((key) => [key, true]),
            ),
          );
        }),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: {
        addListener: vi.fn(),
      },
    },
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      sendMessage: vi.fn().mockResolvedValue({}),
      onMessage: {
        addListener: vi.fn(),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: "https://example.com" }]),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
    },
  },
}));

vi.mock("playhtml", () => ({
  playhtml: {
    init: vi.fn().mockResolvedValue(undefined),
    createPageData: vi.fn(),
    createPresenceRoom: vi.fn(),
    presence: {},
    cursorClient: {},
  },
}));

vi.mock("../collectors/CollectorManager", () => ({
  CollectorManager: class {
    registerCollector = vi.fn();
    init = vi.fn().mockResolvedValue(undefined);
    stopAll = vi.fn();
    pauseAll = vi.fn();
    resumeAll = vi.fn();
    getCollectorStatuses = vi.fn(() => []);
    disableCollector = vi.fn().mockResolvedValue(undefined);
    enableCollector = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock("../collectors/CursorCollector", () => ({
  CursorCollector: class {},
}));

vi.mock("../collectors/NavigationCollector", () => ({
  NavigationCollector: class {},
}));

vi.mock("../collectors/ViewportCollector", () => ({
  ViewportCollector: class {},
}));

vi.mock("../collectors/KeyboardCollector", () => ({
  KeyboardCollector: class {},
}));

const milestone = {
  type: "sitesExplored",
  threshold: 10,
  displayValue: "10",
  copy: "You crossed 10 sites.",
  ctaLabel: "see your portrait",
  ctaAction: "OPEN_PORTRAIT",
  period: "alltime",
} as const;

type RuntimeMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

describe("content milestone toasts", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
    vi.stubGlobal("defineUnlistedScript", (main: () => void) => ({ main }));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    globalThis.wwoContentPageUI = undefined;
    document.body.innerHTML = "";
  });

  it("replaces the existing milestone toast when another milestone arrives", async () => {
    const browser = (await import("webextension-polyfill")).default;
    const contentScript = (await import("../entrypoints/content")).default as {
      main: () => void;
    };
    expect(globalThis.wwoContentPageUI).toBeUndefined();

    const contentPageUIScript = (
      await import("../entrypoints/content-page-ui")
    ).default;
    contentPageUIScript.main();

    contentScript.main();

    const addListener = vi.mocked(browser.runtime.onMessage.addListener);
    const listener = addListener.mock.calls[0][0] as RuntimeMessageListener;

    const firstResponse = await new Promise((resolve) => {
      listener({ type: "SHOW_MILESTONE", milestone }, {}, (response) => {
        resolve(response);
      });
    });

    expect(firstResponse).toEqual({ success: true });
    await vi.waitFor(() => {
      expect(document.body.childElementCount).toBe(1);
    });

    const secondResponse = await new Promise((resolve) => {
      listener(
        {
          type: "SHOW_MILESTONE",
          milestone: { ...milestone, copy: "You crossed another milestone." },
        },
        {},
        (response) => {
          resolve(response);
        },
      );
    });

    expect(secondResponse).toEqual({ success: true });
    await vi.waitFor(() => {
      expect(document.body.childElementCount).toBe(1);
    });
  });
});
