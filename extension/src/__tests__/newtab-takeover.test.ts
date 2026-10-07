// ABOUTME: Covers the opt-in new tab redirect on both Chromium and Firefox.
// ABOUTME: The preference is read per new tab so a startup write is never missed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  initNewTabTakeover,
  NEWTAB_TAKEOVER_KEY,
} from "../features/newtab/takeover";

type TabListener = (tab: {
  id?: number;
  openerTabId?: number;
  pendingUrl?: string;
  url?: string;
}) => Promise<void> | void;

type TabUpdatedListener = (
  tabId: number,
  changeInfo: { url?: string },
) => Promise<void> | void;

type TabRemovedListener = (tabId: number) => void;

describe("initNewTabTakeover", () => {
  let onCreatedListener: TabListener;
  let onUpdatedListener: TabUpdatedListener;
  let onRemovedListener: TabRemovedListener;

  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(browser.storage.local.get).mockReset();
    vi.mocked(browser.tabs.update).mockReset();
    vi.mocked(browser.tabs.update).mockResolvedValue({ id: 1 } as never);
    (browser.tabs as unknown as Record<string, unknown>).onCreated = {
      addListener: vi.fn((fn: TabListener) => {
        onCreatedListener = fn;
      }),
    };
    (browser.tabs as unknown as Record<string, unknown>).onUpdated = {
      addListener: vi.fn((fn: TabUpdatedListener) => {
        onUpdatedListener = fn;
      }),
    };
    (browser.tabs as unknown as Record<string, unknown>).onRemoved = {
      addListener: vi.fn((fn: TabRemovedListener) => {
        onRemovedListener = fn;
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function enable(value: boolean) {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      [NEWTAB_TAKEOVER_KEY]: value,
    } as never);
  }

  it("redirects a Chromium new tab reported via pendingUrl", async () => {
    enable(true);
    initNewTabTakeover();

    await onCreatedListener({ id: 1, pendingUrl: "chrome://newtab/" });

    expect(browser.tabs.update).toHaveBeenCalledWith(1, {
      url: expect.stringContaining("walking-record.html"),
    });
  });

  // Firefox reports the new tab's final url on the created tab itself, with
  // status "complete" — verified against a real Firefox run via web-ext.
  it("redirects a Firefox new tab reported as about:newtab on the created tab", async () => {
    enable(true);
    initNewTabTakeover();

    await onCreatedListener({ id: 3, url: "about:newtab" });

    expect(browser.tabs.update).toHaveBeenCalledWith(3, {
      url: expect.stringContaining("walking-record.html"),
    });
  });

  it("redirects a Firefox new tab reported as about:home", async () => {
    enable(true);
    initNewTabTakeover();

    await onCreatedListener({ id: 4, url: "about:home" });

    expect(browser.tabs.update).toHaveBeenCalledTimes(1);
  });

  it("does not redirect when the preference is off", async () => {
    enable(false);
    initNewTabTakeover();

    await onCreatedListener({ id: 5, url: "about:newtab" });

    expect(browser.tabs.update).not.toHaveBeenCalled();
  });

  it("does not redirect ordinary navigations", async () => {
    enable(true);
    initNewTabTakeover();

    await onCreatedListener({ id: 6, url: "https://example.com/" });
    await onCreatedListener({ id: 7, url: "about:blank" });

    expect(browser.tabs.update).not.toHaveBeenCalled();
  });

  // Firefox is inconsistent: within one session it reports the new tab's url
  // on onCreated for some tabs, and reports about:blank for others with the
  // real url only arriving in a following onUpdated. Both were observed via
  // web-ext against a real Firefox, so both paths must work.
  it("redirects a Firefox new tab whose url only arrives via onUpdated", async () => {
    enable(true);
    initNewTabTakeover();

    await onCreatedListener({ id: 20, url: "about:blank" });
    expect(browser.tabs.update).not.toHaveBeenCalled();

    await onUpdatedListener(20, { url: "about:newtab" });

    expect(browser.tabs.update).toHaveBeenCalledWith(20, {
      url: expect.stringContaining("walking-record.html"),
    });
  });

  it("does not redirect when a blank tab navigates somewhere real", async () => {
    enable(true);
    initNewTabTakeover();

    await onCreatedListener({ id: 21, url: "about:blank" });
    await onUpdatedListener(21, { url: "https://example.com/" });
    // A later new-tab url must not resurrect the redirect.
    await onUpdatedListener(21, { url: "about:newtab" });

    expect(browser.tabs.update).not.toHaveBeenCalled();
  });

  it("ignores a blank tab that never settles into a new tab", async () => {
    vi.useFakeTimers();
    enable(true);
    initNewTabTakeover();

    await onCreatedListener({ id: 22, url: "about:blank" });
    await vi.advanceTimersByTimeAsync(2_001);
    await onUpdatedListener(22, { url: "about:newtab" });

    expect(browser.tabs.update).not.toHaveBeenCalled();
  });

  it("redirects only once when both events report the new tab", async () => {
    enable(true);
    initNewTabTakeover();

    await onCreatedListener({ id: 23, url: "about:newtab" });
    await onUpdatedListener(23, { url: "about:newtab" });

    expect(browser.tabs.update).toHaveBeenCalledTimes(1);
  });

  // The update path grandfathers the preference by writing it during background
  // startup. A cached flag read once at init would miss that write; reading per
  // tab picks it up.
  it("picks up a preference written after init", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({} as never);
    initNewTabTakeover();

    await onCreatedListener({ id: 8, url: "about:newtab" });
    expect(browser.tabs.update).not.toHaveBeenCalled();

    enable(true);
    await onCreatedListener({ id: 9, url: "about:newtab" });

    expect(browser.tabs.update).toHaveBeenCalledWith(9, {
      url: expect.stringContaining("walking-record.html"),
    });
  });

  it("redirects a given tab only once", async () => {
    enable(true);
    initNewTabTakeover();

    await onCreatedListener({ id: 10, url: "about:newtab" });
    await onCreatedListener({ id: 10, url: "about:newtab" });

    expect(browser.tabs.update).toHaveBeenCalledTimes(1);
  });

  it("stays opted out when storage is unavailable", async () => {
    vi.mocked(browser.storage.local.get).mockRejectedValue(
      new Error("storage gone") as never,
    );
    initNewTabTakeover();

    await onCreatedListener({ id: 11, url: "about:newtab" });

    expect(browser.tabs.update).not.toHaveBeenCalled();
  });

  it("releases the tab id once the tab closes", async () => {
    enable(true);
    initNewTabTakeover();

    await onCreatedListener({ id: 12, url: "about:newtab" });
    onRemovedListener(12);
    await onCreatedListener({ id: 12, url: "about:newtab" });

    expect(browser.tabs.update).toHaveBeenCalledTimes(2);
  });
});
