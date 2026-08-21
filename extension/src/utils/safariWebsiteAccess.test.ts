// ABOUTME: Covers Safari website-access checks and user-initiated requests.
// ABOUTME: Verifies both operations use the extension's declared HTTP origins.

import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  hasSafariWebsiteAccess,
  requestSafariWebsiteAccess,
  SAFARI_WEBSITE_ORIGINS,
} from "./safariWebsiteAccess";

describe("Safari website access", () => {
  beforeEach(() => {
    vi.mocked(browser.permissions.contains).mockReset();
    vi.mocked(browser.permissions.request).mockReset();
  });

  it("checks access for all declared website origins", async () => {
    vi.mocked(browser.permissions.contains).mockResolvedValue(true);

    await expect(hasSafariWebsiteAccess()).resolves.toBe(true);
    expect(browser.permissions.contains).toHaveBeenCalledWith({
      origins: SAFARI_WEBSITE_ORIGINS,
    });
  });

  it("requests access for all declared website origins", async () => {
    vi.mocked(browser.permissions.request).mockResolvedValue(true);

    await expect(requestSafariWebsiteAccess()).resolves.toBe(true);
    expect(browser.permissions.request).toHaveBeenCalledWith({
      origins: SAFARI_WEBSITE_ORIGINS,
    });
  });
});
