// ABOUTME: Covers the opt-in new tab redirect, including the service worker wake-up race.
// ABOUTME: The tab that wakes a suspended worker must wait for preference hydration.

import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  initNewTabTakeover,
  NEWTAB_TAKEOVER_KEY,
} from "../features/newtab/takeover";

type TabListener = (tab: {
  id?: number;
  pendingUrl?: string;
  url?: string;
}) => Promise<void> | void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("initNewTabTakeover", () => {
  let onCreatedListener: TabListener;

  beforeEach(() => {
    vi.mocked(browser.storage.local.get).mockReset();
    vi.mocked(browser.tabs.update).mockReset();
    vi.mocked(browser.tabs.update).mockResolvedValue({ id: 1 } as never);
    (browser.tabs as unknown as Record<string, unknown>).onCreated = {
      addListener: vi.fn((fn: TabListener) => {
        onCreatedListener = fn;
      }),
    };
  });

  it("redirects the wake-up tab once hydration resolves enabled", async () => {
    const storage = deferred<Record<string, unknown>>();
    vi.mocked(browser.storage.local.get).mockReturnValue(
      storage.promise as never,
    );

    initNewTabTakeover();
    // The event that woke the worker fires before storage hydration completes.
    const handled = onCreatedListener({
      id: 5,
      pendingUrl: "chrome://newtab/",
    });
    expect(browser.tabs.update).not.toHaveBeenCalled();

    storage.resolve({ [NEWTAB_TAKEOVER_KEY]: true });
    await handled;

    expect(browser.tabs.update).toHaveBeenCalledWith(5, {
      url: expect.stringContaining("walking-record.html"),
    });
  });

  it("leaves the wake-up tab alone when the user is opted out", async () => {
    const storage = deferred<Record<string, unknown>>();
    vi.mocked(browser.storage.local.get).mockReturnValue(
      storage.promise as never,
    );

    initNewTabTakeover();
    const handled = onCreatedListener({
      id: 5,
      pendingUrl: "chrome://newtab/",
    });
    storage.resolve({ [NEWTAB_TAKEOVER_KEY]: false });
    await handled;

    expect(browser.tabs.update).not.toHaveBeenCalled();
  });

  it("uses the cached preference without re-reading storage once hydrated", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      [NEWTAB_TAKEOVER_KEY]: true,
    } as never);

    initNewTabTakeover();
    await Promise.resolve();
    await Promise.resolve();

    await onCreatedListener({ id: 7, pendingUrl: "chrome://newtab/" });
    await onCreatedListener({ id: 8, pendingUrl: "chrome://newtab/" });

    expect(browser.storage.local.get).toHaveBeenCalledTimes(1);
    expect(browser.tabs.update).toHaveBeenCalledTimes(2);
  });

  it("ignores tabs that are not new tab pages", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      [NEWTAB_TAKEOVER_KEY]: true,
    } as never);

    initNewTabTakeover();
    await Promise.resolve();

    await onCreatedListener({ id: 9, pendingUrl: "https://example.com/" });

    expect(browser.tabs.update).not.toHaveBeenCalled();
  });
});
