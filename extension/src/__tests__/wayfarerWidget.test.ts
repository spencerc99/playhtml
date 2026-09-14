// ABOUTME: Covers the corner map widget injected into host pages and the visits it records.
// ABOUTME: The shadow host is mocked open so the test can see the extension iframe inside it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { WAYFARER_WIDGET_KEY } from "../features/wayfarer/journey";

const { MAP_URL } = vi.hoisted(() => ({
  MAP_URL: "http://localhost:3000/internet-map/",
}));

vi.mock("@movement/config", () => ({ INTERNET_MAP_URL: MAP_URL }));

vi.mock("../entrypoints/content/inject-ui", () => ({
  injectShadow: (options: {
    hostId?: string;
    hostStyle?: string;
    css?: string;
  }) => {
    const host = document.createElement("div");
    if (options.hostId) host.id = options.hostId;
    if (options.hostStyle) host.style.cssText = options.hostStyle;
    // Open, unlike the real helper, so assertions can reach inside.
    const shadow = host.attachShadow({ mode: "open" });
    if (options.css) {
      const style = document.createElement("style");
      style.textContent = options.css;
      shadow.appendChild(style);
    }
    document.body.appendChild(host);
    return { host, shadow };
  },
}));

import { initWayfarerWidget } from "../features/wayfarer/widget";

type StorageListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void;

function hostElement(): HTMLElement | null {
  return document.getElementById("wwo-wayfarer-root");
}

function visitMessages() {
  return vi
    .mocked(browser.runtime.sendMessage)
    .mock.calls.map(([message]) => message as Record<string, unknown>)
    .filter((message) => message?.type === "WAYFARER_VISIT");
}

function storageListeners(): StorageListener[] {
  return vi
    .mocked(browser.storage.onChanged.addListener)
    .mock.calls.map(([listener]) => listener as unknown as StorageListener);
}

describe("initWayfarerWidget", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    window.history.pushState({}, "", "/start");
    document.title = "Start page";
    vi.mocked(browser.runtime.sendMessage).mockClear();
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({} as never);
    vi.mocked(browser.storage.local.get).mockClear();
    vi.mocked(browser.storage.local.get).mockResolvedValue({} as never);
    vi.mocked(browser.storage.onChanged.addListener).mockClear();
    vi.mocked(browser.storage.onChanged.removeListener).mockClear();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.useRealTimers();
  });

  it("frames the extension shell page in a fixed corner host", () => {
    cleanup = initWayfarerWidget();

    const host = hostElement();
    expect(host).not.toBeNull();
    expect(host!.style.position).toBe("fixed");
    expect(host!.style.zIndex).toBe("2147483646");

    const frame = host!.shadowRoot!.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("src")).toBe("chrome-extension://test/wayfarer.html");
    expect(frame!.getAttribute("title")).toBe("we were online map");
  });

  it("records the current page immediately", () => {
    cleanup = initWayfarerWidget();

    expect(visitMessages()).toEqual([
      {
        type: "WAYFARER_VISIT",
        url: "http://localhost:3000/start",
        title: "Start page",
      },
    ]);
  });

  it("records a soft navigation on the next poll tick", () => {
    cleanup = initWayfarerWidget();
    expect(visitMessages()).toHaveLength(1);

    window.history.pushState({}, "", "/next");
    document.title = "Next page";
    expect(visitMessages()).toHaveLength(1);

    vi.advanceTimersByTime(750);

    const messages = visitMessages();
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({
      type: "WAYFARER_VISIT",
      url: "http://localhost:3000/next",
      title: "Next page",
    });

    // Standing still does not add stops.
    vi.advanceTimersByTime(3000);
    expect(visitMessages()).toHaveLength(2);
  });

  it("resizes the host when the widget is collapsed and expanded", () => {
    cleanup = initWayfarerWidget();
    const host = hostElement()!;
    expect(host.style.height).toBe("184px");

    const listeners = storageListeners();
    expect(listeners.length).toBeGreaterThan(0);
    const notify = (collapsed: boolean, areaName = "local") => {
      for (const listener of listeners) {
        listener({ [WAYFARER_WIDGET_KEY]: { newValue: { collapsed } } }, areaName);
      }
    };

    notify(true);
    expect(host.style.height).toBe("28px");

    notify(false);
    expect(host.style.height).toBe("184px");

    notify(true, "sync");
    expect(host.style.height).toBe("184px");
  });

  it("frames nothing on the map page itself, and tells it the cursor colour instead", async () => {
    window.history.pushState({}, "", "/internet-map/");
    delete document.documentElement.dataset.wwoCursorColor;
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message: unknown) => {
      if ((message as { type?: string }).type === "GET_PUBLIC_PLAYER_IDENTITY") {
        return {
          publicKey: `pk_${"ab".repeat(65)}`,
          playerStyle: { colorPalette: ["hsl(120, 70%, 60%)"] },
        } as never;
      }
      return {} as never;
    });
    const heard: unknown[] = [];
    document.addEventListener("wwo:cursor-color", (e) => heard.push((e as CustomEvent).detail));

    cleanup = initWayfarerWidget();
    await vi.runAllTimersAsync();

    expect(hostElement()).toBeNull();
    expect(visitMessages()).toHaveLength(0);
    expect(document.documentElement.dataset.wwoCursorColor).toBe("hsl(120, 70%, 60%)");
    expect(heard).toEqual([{ color: "hsl(120, 70%, 60%)" }]);
  });

  it("removes the host and stops recording on cleanup", () => {
    const dispose = initWayfarerWidget();
    expect(hostElement()).not.toBeNull();

    dispose();

    expect(hostElement()).toBeNull();
    expect(browser.storage.onChanged.removeListener).toHaveBeenCalled();

    window.history.pushState({}, "", "/after-cleanup");
    vi.advanceTimersByTime(3000);
    expect(visitMessages()).toHaveLength(1);
  });
});
