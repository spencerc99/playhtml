// ABOUTME: Regression tests for content-script internal development feature gates.
// ABOUTME: Verifies hidden inventory features do not run on every page.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageGet = vi.hoisted(() => vi.fn());
const storageSet = vi.hoisted(() => vi.fn());
const runtimeSendMessage = vi.hoisted(() => vi.fn());

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: storageGet,
        set: storageSet,
      },
      onChanged: {
        addListener: vi.fn(),
      },
    },
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      sendMessage: runtimeSendMessage,
      onMessage: {
        addListener: vi.fn(),
      },
    },
  },
}));

vi.mock("../flags", () => ({
  FLAGS: { COPRESENCE: true },
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

describe("content internal development features", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    document.body.innerHTML = '<div can-collect="true">collectable</div>';
    document.documentElement.dataset.playhtml = "true";

    storageGet.mockReset();
    storageGet.mockImplementation((keys: string | string[]) => {
      if (!Array.isArray(keys)) return Promise.resolve({});
      if (keys.includes("internalDevFeaturesEnabled")) {
        return Promise.resolve({ internalDevFeaturesEnabled: false });
      }
      if (keys.includes("gameInventory")) {
        return Promise.resolve({
          gameInventory: { items: [], totalItems: 0, lastUpdated: 0 },
        });
      }

      return Promise.resolve(
        Object.fromEntries(
          keys
            .filter((key) => key.startsWith("migration_v1_done_"))
            .map((key) => [key, true]),
        ),
      );
    });

    storageSet.mockReset();
    storageSet.mockResolvedValue(undefined);

    runtimeSendMessage.mockReset();
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

  it("does not initialize inventory discovery or collection observers when internal dev features are off", async () => {
    const observe = vi.fn();
    const mutationObserver = vi.fn(function () {
      return { observe, disconnect: vi.fn(), takeRecords: vi.fn(() => []) };
    });
    vi.stubGlobal("MutationObserver", mutationObserver);

    const contentScript = (await import("../entrypoints/content")).default as {
      main: () => void;
    };

    contentScript.main();

    await vi.waitFor(() => {
      expect(runtimeSendMessage).toHaveBeenCalledWith({
        type: "UPDATE_SITE_DISCOVERY",
        domain: window.location.hostname,
      });
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(storageGet).toHaveBeenCalledWith(["internalDevFeaturesEnabled"]);
    expect(storageGet).not.toHaveBeenCalledWith(["gameInventory"]);
    expect(mutationObserver).not.toHaveBeenCalled();
  });
});
