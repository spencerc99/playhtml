// ABOUTME: Verifies the data collection settings screen surfaces local storage size.
// ABOUTME: Covers popup stats copy for local event data.

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
            totalEvents: 3,
            estimatedSizeBytes: 1536,
            oldestEvent: Date.now(),
            countsByType: { cursor: 2, keyboard: 1 },
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

  it("shows local database size in the top stats card", async () => {
    const { container, root } = await renderCollections();

    try {
      const text = container.textContent ?? "";
      const eventsIndex = text.indexOf("3events");
      const sizeIndex = text.indexOf("1.5 KBstored");
      const exportIndex = text.indexOf("Export data");

      expect(eventsIndex).toBeGreaterThanOrEqual(0);
      expect(sizeIndex).toBeGreaterThanOrEqual(0);
      expect(exportIndex).toBeGreaterThan(sizeIndex);
      expect(text).not.toContain("Local database");
    } finally {
      cleanupRoot(root, container);
    }
  });
});
