// ABOUTME: Covers opening and returning to the hosted Internet Commute.
// ABOUTME: Ensures the popup focuses one carriage tab instead of duplicating it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  findOpenCommuteTab,
  openOrFocusCommute,
  PUBLIC_COMMUTE_URL,
} from "./commuteNavigation";

const tabs = browser.tabs as typeof browser.tabs & {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
const windows = browser.windows as typeof browser.windows & {
  update: ReturnType<typeof vi.fn>;
};

describe("commute navigation", () => {
  beforeEach(() => {
    vi.mocked(browser.tabs.query).mockReset();
    tabs.create.mockReset();
    tabs.update.mockReset();
    windows.update.mockReset();
  });

  it("reports an existing commute tab", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 12, windowId: 4, url: PUBLIC_COMMUTE_URL },
    ]);

    await expect(findOpenCommuteTab()).resolves.toEqual(
      expect.objectContaining({ id: 12 }),
    );
  });

  it("focuses an existing commute tab and window", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 12, windowId: 4, url: PUBLIC_COMMUTE_URL },
    ]);

    await openOrFocusCommute();

    expect(tabs.update).toHaveBeenCalledWith(12, { active: true });
    expect(windows.update).toHaveBeenCalledWith(4, { focused: true });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it("opens the public commute when no carriage tab exists", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([]);

    await openOrFocusCommute();

    expect(tabs.create).toHaveBeenCalledWith({ url: PUBLIC_COMMUTE_URL });
    expect(tabs.update).not.toHaveBeenCalled();
  });
});
