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
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
    vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 1, url: "https://example.com" } as any,
    ]);
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ statuses: [] });
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
      if (message?.type === "GET_STORAGE_STATS") {
        return {
          success: true,
          stats: {
            totalEvents: 128430,
            estimatedSizeBytes: 1536,
            localUsageBytes: 3145728,
            oldestEvent: Date.now(),
            countsByType: { cursor: 88210, keyboard: 8108 },
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

  it("shows local storage size and stored event counts below collector choices", async () => {
    const { container, root } = await renderCollections();

    try {
      const text = container.textContent ?? "";
      const keyboardIndex = text.indexOf("Keyboard");
      const titleIndex = text.indexOf("Local database");
      const storageIndex = text.indexOf("3.0 MBlocal storage");
      const eventsIndex = text.indexOf("128Kevents");
      const sizeIndex = text.indexOf("1.5 KBevent data");
      const exportIndex = text.indexOf("Export data");

      expect(keyboardIndex).toBeGreaterThanOrEqual(0);
      expect(titleIndex).toBeGreaterThan(keyboardIndex);
      expect(storageIndex).toBeGreaterThanOrEqual(0);
      expect(eventsIndex).toBeGreaterThanOrEqual(0);
      expect(sizeIndex).toBeGreaterThanOrEqual(0);
      expect(storageIndex).toBeGreaterThan(titleIndex);
      expect(storageIndex).toBeGreaterThan(keyboardIndex);
      expect(exportIndex).toBeGreaterThan(sizeIndex);
      expect(
        container.querySelector('[aria-label="cursor events: 88K"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[aria-label="keyboard events: 8.1K"]'),
      ).not.toBeNull();
    } finally {
      cleanupRoot(root, container);
    }
  });

  it("shows local storage size even when no collection events are stored", async () => {
    vi.mocked(browser.runtime.sendMessage).mockImplementation(async (message) => {
      if (message?.type === "GET_STORAGE_STATS") {
        return {
          success: true,
          stats: {
            totalEvents: 0,
            estimatedSizeBytes: 0,
            localUsageBytes: 2048,
            oldestEvent: 0,
            countsByType: {},
          },
        };
      }
      return { success: true };
    });

    const { container, root } = await renderCollections();

    try {
      const text = container.textContent ?? "";

      expect(text).toContain("Local database");
      expect(text).toContain("2.0 KBlocal storage");
      expect(text).toContain("0events");
      expect(text).toContain("0 Bevent data");
    } finally {
      cleanupRoot(root, container);
    }
  });

  it("hides local storage stats when all collectors are off", async () => {
    vi.mocked(browser.storage.local.get).mockImplementation(async (keys) => {
      if (
        Array.isArray(keys) &&
        keys.every((key) => key.startsWith("collection_mode_"))
      ) {
        return Object.fromEntries(keys.map((key) => [key, "off"]));
      }
      return {};
    });

    const { container, root } = await renderCollections();

    try {
      const text = container.textContent ?? "";

      expect(text).not.toContain("local storage");
      expect(text).not.toContain("event data");
      expect(text).not.toContain("Local database");
      expect(text).toContain("Export data");
    } finally {
      cleanupRoot(root, container);
    }
  });
});
