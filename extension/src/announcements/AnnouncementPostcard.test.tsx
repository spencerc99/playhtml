// ABOUTME: Verifies popup announcement cards expand and open their configured destination.
// ABOUTME: Covers extension-page CTAs without relying on a live browser-extension origin.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import browser from "webextension-polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementPostcard } from "./AnnouncementPostcard";
import type { Announcement } from "./announcements";

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

describe("AnnouncementPostcard", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves extension-page CTAs through the runtime URL", async () => {
    const announcement: Announcement = {
      id: "history",
      shippedAt: Date.parse("2026-08-06T00:00:00Z"),
      title: "Browsing history review",
      body: "Find it in every new tab or from the popup.",
      cta: {
        label: "open history →",
        extensionPath: "walking-record.html",
      },
    };
    const onCtaClick = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.appendChild(container);

    await act(async () => {
      root.render(
        <AnnouncementPostcard
          announcement={announcement}
          onDismiss={vi.fn()}
          onCtaClick={onCtaClick}
        />,
      );
    });

    try {
      const card = container.querySelector<HTMLElement>("article");
      expect(card).not.toBeNull();

      await act(async () => {
        card?.click();
      });

      const cta = container.querySelector<HTMLAnchorElement>(
        ".announcement-postcard__cta",
      );
      expect(cta?.href).toBe("chrome-extension://test/walking-record.html");

      await act(async () => {
        cta?.click();
      });

      expect(browser.runtime.getURL).toHaveBeenCalledWith("walking-record.html");
      expect(onCtaClick).toHaveBeenCalledWith(
        "history",
        "chrome-extension://test/walking-record.html",
      );
    } finally {
      cleanup(root, container);
    }
  });
});
