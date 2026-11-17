// ABOUTME: Regression tests for content-script page-lifecycle teardown/restore wiring.
// ABOUTME: Verifies bfcache restore, listeners that are not one-shot, and the same-document navigation message.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTENSION_INSTALL_ATTRIBUTE } from "../utils/extensionInstallMarker";

const storageGet = vi.hoisted(() => vi.fn());
const storageSet = vi.hoisted(() => vi.fn());
const runtimeSendMessage = vi.hoisted(() => vi.fn());
const onMessageAddListener = vi.hoisted(() => vi.fn());

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
        addListener: onMessageAddListener,
      },
    },
  },
}));

vi.mock("../collectors/CollectorManager", () => ({
  CollectorManager: class {
    registerCollector = vi.fn();
    setSiteOff = vi.fn().mockResolvedValue(undefined);
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

describe("content page-lifecycle wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    document.body.innerHTML = "";
    document.documentElement.removeAttribute(EXTENSION_INSTALL_ATTRIBUTE);
    // Present native playhtml so setupPresence takes the identity-injection
    // branch, which re-dispatches "playhtml:configure-identity" every time
    // presence setup runs — the observable signal we assert on.
    document.documentElement.dataset.playhtml = "true";

    storageGet.mockReset();
    storageGet.mockImplementation((keys: string | string[]) => {
      if (keys === "wwoFeatureAccess") {
        return Promise.resolve({
          wwoFeatureAccess: {
            features: { COPRESENCE: { stage: "internal", available: true } },
            checkedAt: 1,
          },
        });
      }
      if (keys === "wwoFeatureOverrides") {
        return Promise.resolve({ wwoFeatureOverrides: { COPRESENCE: true } });
      }
      return Promise.resolve({});
    });

    storageSet.mockReset();
    storageSet.mockResolvedValue(undefined);

    onMessageAddListener.mockReset();
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

  it("re-establishes collaboration on bfcache restore and stays wired across round trips", async () => {
    const injected = vi.fn();
    document.addEventListener("playhtml:configure-identity", injected);

    try {
      const contentScript = (await import("../entrypoints/content"))
        .default as { main: () => void };

      contentScript.main();
      expect(
        document.documentElement.getAttribute(EXTENSION_INSTALL_ATTRIBUTE),
      ).toBe("installed");

      // Initial presence setup dispatches identity once.
      await vi.waitFor(() => {
        expect(injected).toHaveBeenCalledTimes(1);
      });

      // Simulate a back/forward-cache round trip: pagehide freezes the page
      // (teardown), pageshow with persisted restores it (reinit).
      window.dispatchEvent(new PageTransitionEvent("pagehide", {
        persisted: true,
      }));
      window.dispatchEvent(new PageTransitionEvent("pageshow", {
        persisted: true,
      }));

      await vi.waitFor(() => {
        expect(injected).toHaveBeenCalledTimes(2);
      });

      // A second round trip must also restore — the listeners are not one-shot.
      window.dispatchEvent(new PageTransitionEvent("pagehide", {
        persisted: true,
      }));
      window.dispatchEvent(new PageTransitionEvent("pageshow", {
        persisted: true,
      }));

      await vi.waitFor(() => {
        expect(injected).toHaveBeenCalledTimes(3);
      });
    } finally {
      document.removeEventListener("playhtml:configure-identity", injected);
    }
  });

  it("does not re-establish collaboration on a fresh (non-persisted) pageshow", async () => {
    const injected = vi.fn();
    document.addEventListener("playhtml:configure-identity", injected);

    try {
      const contentScript = (await import("../entrypoints/content"))
        .default as { main: () => void };

      contentScript.main();

      await vi.waitFor(() => {
        expect(injected).toHaveBeenCalledTimes(1);
      });

      window.dispatchEvent(new PageTransitionEvent("pageshow", {
        persisted: false,
      }));

      // Give any errant async reinit a chance to run before asserting no-op.
      await Promise.resolve();
      await Promise.resolve();
      expect(injected).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("playhtml:configure-identity", injected);
    }
  });

  it("answers the background's same-document navigation message", async () => {
    const contentScript = (await import("../entrypoints/content"))
      .default as { main: () => void };
    const { SAME_DOCUMENT_NAVIGATION_MESSAGE } = await import(
      "../utils/sameDocumentNavigation"
    );

    contentScript.main();
    await vi.waitFor(() => {
      expect(onMessageAddListener).toHaveBeenCalled();
    });
    const listener = onMessageAddListener.mock.calls[0][0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => unknown;

    window.history.pushState({}, "", "/spa-route");
    const sendResponse = vi.fn();
    const keepsChannelOpen = listener(
      { type: SAME_DOCUMENT_NAVIGATION_MESSAGE, url: window.location.href },
      {},
      sendResponse,
    );

    expect(keepsChannelOpen).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });
});
