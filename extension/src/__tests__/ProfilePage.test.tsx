// ABOUTME: Verifies popup profile color controls avoid Firefox popup focus loss.
// ABOUTME: Covers the cursor color picker UI rendered inside the extension popup.

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import type { PlayerIdentity } from "../types";

vi.mock("../components/ProfilePage.scss", () => ({}));

const identity: PlayerIdentity = {
  publicKey: "pk_test",
  playerStyle: {
    colorPalette: ["#4a9a8a"],
  },
};

async function renderProfilePage() {
  const { ProfilePage } = await import("../components/ProfilePage");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <ProfilePage
        playerIdentity={identity}
        discoveredSites={[]}
        onBack={vi.fn()}
        onIdentityUpdated={vi.fn()}
      />,
    );
  });

  return { container, root };
}

function cleanupRoot(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

describe("ProfilePage", () => {
  let createWindow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("FIREFOX", "true");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    createWindow = vi.fn().mockResolvedValue({});
    Object.assign(browser, {
      windows: {
        create: createWindow,
      },
    });
    Object.assign(browser.runtime, {
      getURL: vi.fn((path: string) => `moz-extension://test/${path}`),
    });
    vi.spyOn(window, "close").mockImplementation(() => {});
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      success: true,
      stats: { totalEvents: 0, estimatedSizeBytes: 0 },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("opens a real extension window for Firefox native color picking", async () => {
    const { container, root } = await renderProfilePage();

    try {
      expect(container.querySelector('input[type="color"]')).toBeNull();
      expect(container.querySelector(".profile-section__swatch")).toBeNull();
      const pickerButton = container.querySelector(
        '[aria-label="Open native cursor color picker"]',
      );
      expect(pickerButton).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        pickerButton?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });

      expect(createWindow).toHaveBeenCalledWith({
        url: expect.stringContaining("color-picker.html"),
        type: "popup",
        width: 360,
        height: 260,
      });
    } finally {
      cleanupRoot(root, container);
    }
  });

  it("does not fetch or show local storage stats", async () => {
    const { container, root } = await renderProfilePage();

    try {
      expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith({
        type: "GET_STORAGE_STATS",
      });
      expect(container.textContent).not.toContain("events stored");
      expect(container.textContent).not.toContain("local data");
    } finally {
      cleanupRoot(root, container);
    }
  });
});
