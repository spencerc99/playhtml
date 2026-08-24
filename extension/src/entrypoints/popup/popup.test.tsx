// ABOUTME: Verifies experimental feature visibility and navigation in the extension popup.
// ABOUTME: Ensures the popup remains a glance-and-jump surface.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import PlayHTMLPopup from "./popup";

vi.mock("../../styles/popup.scss", () => ({}));
vi.mock("../../components/Inventory", () => ({
  Inventory: () => null,
}));
vi.mock("../../components/PlayerIdentityCard", () => ({
  PlayerIdentityCard: () => null,
}));
vi.mock("../../components/SiteStatus", () => ({
  SiteStatus: () => null,
}));
vi.mock("../../components/QuickActions", () => ({
  QuickActions: () => null,
}));
vi.mock("../../components/Collections", () => ({
  Collections: () => null,
}));
vi.mock("../../components/ProfilePage", () => ({
  ProfilePage: () => null,
}));
vi.mock("../../components/InternetPortraitHome.scss", () => ({}));
vi.mock("../../components/TinyMovementPreview", () => ({
  TinyMovementPreview: () => null,
}));
vi.mock("../../components/PortraitCard", () => ({
  PortraitCard: () => null,
}));
vi.mock("../../announcements/PostcardStack", () => ({
  PostcardStack: () => null,
}));
vi.mock("../../components/FeedbackForm", () => ({
  FeedbackForm: () => null,
}));

vi.mock("../../features/inventory/siteVisibility", () => ({
  pageObjectsAreHiddenOnSite: vi.fn().mockResolvedValue(false),
  showPageObjectsOnSite: vi.fn().mockResolvedValue(undefined),
  siteOriginFromUrl: vi.fn().mockReturnValue("https://example.com"),
}));

async function renderPopup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<PlayHTMLPopup />);
  });
  await act(async () => {
    await Promise.resolve();
  });

  return { container, root };
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

describe("PlayHTMLPopup", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(browser.storage.local.get).mockImplementation(async (keys) => {
      const requestedKeys = Array.isArray(keys) ? keys : [keys];
      if (requestedKeys.includes("onboarding_complete")) {
        return { onboarding_complete: true };
      }
      if (requestedKeys.includes("wwoFeatureAccess")) {
        return {
          wwoFeatureAccess: {
            features: {
              COMMUTE: { stage: "beta", available: true },
              SCRAPS: { stage: "beta", available: true },
              BAG_SETTINGS: { stage: "internal", available: true },
            },
            checkedAt: 123,
          },
        };
      }
      if (requestedKeys.includes("wwoFeatureOverrides")) {
        return {
          wwoFeatureOverrides: {
            COMMUTE: true,
            SCRAPS: true,
            BAG_SETTINGS: true,
          },
        };
      }
      if (requestedKeys.includes("gameInventory")) {
        return {
          gameInventory: {
            items: [],
            totalItems: 0,
            lastUpdated: 0,
          },
        };
      }
      return {};
    });
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      identity: null,
      discoveredSites: [],
    });
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({
      elementCount: 0,
    });
    vi.mocked(browser.tabs.query).mockResolvedValue([
      {
        id: 1,
        url: "https://example.com",
        index: 0,
        highlighted: true,
        active: true,
        pinned: false,
        incognito: false,
      },
    ]);
    Object.assign(browser.runtime, {
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      openOptionsPage: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(window, "close").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("shows enabled feature entries without nesting settings", async () => {
    const { container, root } = await renderPopup();

    try {
      expect(container.querySelector(".portrait-home")).not.toBeNull();
      expect(container.querySelector(".commute-entry")).not.toBeNull();
      expect(container.textContent).toContain("scraps");
      expect(container.textContent).toContain("bag settings");
      expect(container.textContent).not.toContain("experiments");
      expect(container.textContent).toContain("settings");
    } finally {
      cleanup(root, container);
    }
  });

  it("opens the options page from settings", async () => {
    const { container, root } = await renderPopup();

    try {
      const settingsButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "settings");
      expect(settingsButton).toBeDefined();

      await act(async () => settingsButton?.click());

      expect(browser.runtime.openOptionsPage).toHaveBeenCalledOnce();
    } finally {
      cleanup(root, container);
    }
  });

  it("opens browsing history from the popup navigation", async () => {
    const { container, root } = await renderPopup();

    try {
      const historyButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.startsWith("history"));
      expect(historyButton).toBeDefined();

      await act(async () => {
        historyButton?.click();
      });

      expect(browser.runtime.getURL).toHaveBeenCalledWith(
        "walking-record.html",
      );
      expect(browser.tabs.create).toHaveBeenCalledWith({
        url: "chrome-extension://test/walking-record.html",
      });
    } finally {
      cleanup(root, container);
    }
  });

  it("puts the page navigation in the header instead of a subtitle", async () => {
    const { container, root } = await renderPopup();

    try {
      const header = container.querySelector(".portrait-home__header");
      expect(header?.querySelector(".popup-nav")).not.toBeNull();
      expect(container.querySelector(".portrait-home__subtitle")).toBeNull();
      expect(container.textContent).not.toContain(
        "An evolving portrait from your time on the internet",
      );
    } finally {
      cleanup(root, container);
    }
  });

  it("shows the portrait preview above the collection status", async () => {
    const { container, root } = await renderPopup();

    try {
      const main = container.querySelector(".portrait-home__main");
      const preview = main?.querySelector(".preview-card");
      const collection = main?.querySelector(".collection-status");
      expect(preview).not.toBeNull();
      expect(collection).not.toBeNull();
      expect(
        preview!.compareDocumentPosition(collection!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    } finally {
      cleanup(root, container);
    }
  });
});
