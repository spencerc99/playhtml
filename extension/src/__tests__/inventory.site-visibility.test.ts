// ABOUTME: Verifies saved per-site visibility preferences for the satchel and its page objects.
// ABOUTME: Uses extension storage so hidden defaults survive navigation and browser restarts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  hidePageObjectsOnSite,
  pageObjectsAreHiddenOnSite,
  showPageObjectsOnSite,
  siteOriginFromUrl,
  siteVisibilityStorageKey,
} from "../features/inventory/siteVisibility";

describe("site visibility", () => {
  beforeEach(() => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
    vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
    Object.assign(browser.storage.local, {
      remove: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("stores each web origin independently", async () => {
    const siteOrigin = "https://mail.google.com";

    await hidePageObjectsOnSite(siteOrigin);

    expect(browser.storage.local.set).toHaveBeenCalledWith({
      [siteVisibilityStorageKey(siteOrigin)]: true,
    });
  });

  it("reads and clears a saved preference", async () => {
    const siteOrigin = "https://example.com";
    const key = siteVisibilityStorageKey(siteOrigin);
    vi.mocked(browser.storage.local.get).mockResolvedValue({ [key]: true });

    await expect(pageObjectsAreHiddenOnSite(siteOrigin)).resolves.toBe(true);
    await showPageObjectsOnSite(siteOrigin);

    expect(browser.storage.local.remove).toHaveBeenCalledWith(key);
  });

  it("accepts web pages and rejects browser-owned URLs", () => {
    expect(siteOriginFromUrl("https://example.com/an-essay")).toBe(
      "https://example.com",
    );
    expect(siteOriginFromUrl("chrome://extensions")).toBeNull();
  });
});
