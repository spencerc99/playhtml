// ABOUTME: Verifies beta feature visibility in the extension popup.
// ABOUTME: Ensures internal development mode cannot bypass the commute flag.

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
      if (requestedKeys.includes("internalDevFeaturesEnabled")) {
        return {
          internalDevFeaturesEnabled: true,
          onboarding_complete: true,
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("keeps the commute entry hidden when only development mode is enabled", async () => {
    const { container, root } = await renderPopup();

    try {
      expect(container.querySelector(".portrait-home")).not.toBeNull();
      expect(container.querySelector(".commute-entry")).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });
});
