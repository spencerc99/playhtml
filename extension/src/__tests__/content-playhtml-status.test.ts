// ABOUTME: Verifies PlayHTML capability scans run only for explicit status requests.
// ABOUTME: Exercises content-script initialization and status messaging against the real DOM.

import { beforeEach, describe, expect, it, vi } from "vitest";

const storageGet = vi.hoisted(() => vi.fn());
const runtimeSendMessage = vi.hoisted(() => vi.fn());

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

const capabilitySelector =
  "[can-move], [can-spin], [can-toggle], [can-grow], [can-duplicate], [can-mirror], [can-play]";

type RuntimeMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

describe("content PlayHTML status scans", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
    document.documentElement.dataset.playhtml = "true";
    document.body.innerHTML = '<div id="initial" can-move></div>';

    storageGet.mockReset();
    storageGet.mockImplementation((keys: string | string[]) => {
      if (!Array.isArray(keys)) return Promise.resolve({});
      return Promise.resolve(
        Object.fromEntries(
          keys
            .filter((key) => key.startsWith("migration_v1_done_"))
            .map((key) => [key, true]),
        ),
      );
    });
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

  it("skips the startup scan and returns the live count on demand", async () => {
    const querySelectorAll = vi.spyOn(document, "querySelectorAll");
    const browser = (await import("webextension-polyfill")).default;
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
    expect(querySelectorAll).not.toHaveBeenCalledWith(capabilitySelector);

    document.body.insertAdjacentHTML(
      "beforeend",
      '<button id="added" can-toggle></button>',
    );

    const addListener = vi.mocked(browser.runtime.onMessage.addListener);
    const listener = addListener.mock.calls[0][0] as RuntimeMessageListener;
    const sendResponse = vi.fn();

    expect(listener({ type: "CHECK_PLAYHTML_STATUS" }, {}, sendResponse)).toBe(
      true,
    );
    expect(querySelectorAll).toHaveBeenCalledTimes(1);
    expect(querySelectorAll).toHaveBeenCalledWith(capabilitySelector);
    expect(sendResponse).toHaveBeenCalledWith({
      elementCount: 2,
      detected: true,
    });
  });
});
