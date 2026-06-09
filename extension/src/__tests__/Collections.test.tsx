// ABOUTME: Verifies the data collection settings screen surfaces local storage size.
// ABOUTME: Covers popup copy around import/export controls for local event data.

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";

vi.mock("../components/Collections.scss", () => ({}));

async function renderCollections() {
  const { Collections } = await import("../components/Collections");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<Collections onBack={vi.fn()} />);
  });

  await act(async () => {
    await Promise.resolve();
  });

  return { container, root };
}

function cleanupRoot(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

describe("Collections", () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
      if (message?.type === "GET_STORAGE_STATS") {
        return {
          success: true,
          stats: {
            totalEvents: 0,
            estimatedSizeBytes: 1536,
            oldestEvent: 0,
            countsByType: {},
          },
        };
      }
      return { success: true };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("shows local database size above import and export controls", async () => {
    const { container, root } = await renderCollections();

    try {
      const text = container.textContent ?? "";
      const sizeIndex = text.indexOf("Local database");
      const exportIndex = text.indexOf("Export data");

      expect(sizeIndex).toBeGreaterThanOrEqual(0);
      expect(text).toContain("1.5 KB");
      expect(exportIndex).toBeGreaterThan(sizeIndex);
    } finally {
      cleanupRoot(root, container);
    }
  });
});
