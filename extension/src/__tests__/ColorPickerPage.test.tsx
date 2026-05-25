// ABOUTME: Verifies the standalone cursor color editor persists native picker values.
// ABOUTME: Covers the extension-window color picker used when toolbar popups cannot host native dialogs.

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import type { PlayerIdentity } from "../types";
import { syncParticipantColor } from "../storage/sync";

vi.mock("../storage/sync", () => ({
  syncParticipantColor: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../components/ColorPickerPage.scss", () => ({}));

const storedIdentity: PlayerIdentity = {
  publicKey: "pk_test",
  playerStyle: {
    colorPalette: ["#4a9a8a"],
  },
  discoveredSites: [],
};

async function renderColorPickerPage() {
  const { ColorPickerPage } = await import("../components/ColorPickerPage");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<ColorPickerPage />);
  });

  return { container, root };
}

function cleanupRoot(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

describe("ColorPickerPage", () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      playerIdentity: structuredClone(storedIdentity),
    });
    vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
    vi.spyOn(window, "close").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("saves an arbitrary native color input value", async () => {
    const { container, root } = await renderColorPickerPage();

    try {
      const colorInput = container.querySelector(
        'input[type="color"]',
      ) as HTMLInputElement | null;
      expect(colorInput).toBeInstanceOf(HTMLInputElement);
      expect(colorInput?.value).toBe("#4a9a8a");

      await act(async () => {
        colorInput!.value = "#123456";
        colorInput!.dispatchEvent(
          new Event("input", { bubbles: true, cancelable: true }),
        );
      });

      const saveButton = container.querySelector(
        '[aria-label="Save cursor color"]',
      );
      await act(async () => {
        saveButton?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });

      expect(browser.storage.local.set).toHaveBeenCalledWith({
        playerIdentity: {
          ...storedIdentity,
          playerStyle: {
            colorPalette: ["#123456"],
          },
        },
      });
      expect(syncParticipantColor).toHaveBeenCalledWith("pk_test", "#123456");
    } finally {
      cleanupRoot(root, container);
    }
  });
});
