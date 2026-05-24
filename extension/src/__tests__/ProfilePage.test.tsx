// ABOUTME: Verifies popup profile color controls avoid Firefox popup focus loss.
// ABOUTME: Covers the cursor color picker UI rendered inside the extension popup.

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import type { PlayerIdentity } from "../types";

vi.mock("../storage/sync", () => ({
  syncParticipantColor: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../components/ProfilePage.scss", () => ({}));

const identity: PlayerIdentity = {
  publicKey: "pk_test",
  playerStyle: {
    colorPalette: ["#4a9a8a"],
  },
  discoveredSites: [],
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
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("FIREFOX", "true");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
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

  it("uses an inline color picker in Firefox popup builds", async () => {
    const { container, root } = await renderProfilePage();

    try {
      expect(container.querySelector('input[type="color"]')).toBeNull();
      expect(
        container.querySelector('[aria-label="Custom cursor color hex value"]'),
      ).toBeInstanceOf(HTMLInputElement);
      expect(
        container.querySelector('[aria-label="Use #ef4444 as cursor color"]'),
      ).toBeInstanceOf(HTMLButtonElement);
    } finally {
      cleanupRoot(root, container);
    }
  });
});
