// ABOUTME: Regression tests for milestone toast handling in the content script.
// ABOUTME: Verifies repeated milestone messages replace the visible injected UI.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: vi.fn().mockImplementation((keys: string | string[]) => {
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

vi.mock("../flags", () => ({
  FLAGS: { COPRESENCE: false },
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

describe("content milestone toasts", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    document.body.innerHTML = "";
  });

  it("replaces the existing milestone toast when another milestone arrives", async () => {
    const browser = (await import("webextension-polyfill")).default;
    const contentScript = (await import("../entrypoints/content")).default as {
      main: () => void;
    };

    contentScript.main();

    const addListener = vi.mocked(browser.runtime.onMessage.addListener);
    const listener = addListener.mock.calls[0][0];
    const sendResponse = vi.fn();

    listener({ type: "SHOW_MILESTONE", milestone }, {}, sendResponse);

    expect(document.body.childElementCount).toBe(1);

    listener(
      {
        type: "SHOW_MILESTONE",
        milestone: { ...milestone, copy: "You crossed another milestone." },
      },
      {},
      sendResponse,
    );

    expect(document.body.childElementCount).toBe(1);
  });
});
