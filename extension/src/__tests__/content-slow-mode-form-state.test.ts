// ABOUTME: Verifies typing does not trigger Slow Mode form inference on host pages.
// ABOUTME: Exercises the real content-script entrypoint against a page with many controls.

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

describe("content Slow Mode form-state reachability", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
    document.documentElement.dataset.playhtml = "true";
    document.body.innerHTML = Array.from(
      { length: 5_000 },
      (_, index) => `<input id="field-${index}">`,
    ).join("");

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

  it("does not scan controls or message the background when a user types", async () => {
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

    runtimeSendMessage.mockClear();
    const querySelectorAll = vi.spyOn(document, "querySelectorAll");
    const input = document.querySelector<HTMLInputElement>("#field-2500");
    if (!input) throw new Error("Typing target was not created");
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "x" }));

    expect(querySelectorAll).not.toHaveBeenCalledWith(
      "input, textarea, select",
    );
    expect(runtimeSendMessage).not.toHaveBeenCalled();
  });
});
