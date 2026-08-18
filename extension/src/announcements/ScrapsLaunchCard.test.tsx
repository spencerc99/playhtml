// ABOUTME: Verifies the new-tab internet-scraps launch card states, dismissal, and feature gate.
// ABOUTME: Covers the example strip, the collected-scraps strip, and the dark-feature no-render case.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import browser from "webextension-polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrapsLaunchCard } from "./ScrapsLaunchCard";
import { FLAGS } from "../flags";

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

async function renderCard() {
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.appendChild(container);
  await act(async () => {
    root.render(<ScrapsLaunchCard />);
  });
  return { container, root };
}

function scrapImage(key: string) {
  return {
    id: key,
    key,
    domain: "example.com",
    pageUrl: "https://example.com/page",
    ts: 1,
    pageTitle: "example",
    kind: "image" as const,
    src: `https://example.com/${key}.png`,
    alt: `${key} alt`,
    naturalWidth: 60,
    naturalHeight: 60,
  };
}

describe("ScrapsLaunchCard", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.assign(browser.runtime, {
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    });
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      wwoInternalAccess: { enabled: true, checkedAt: 1 },
    });
    vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("shows hosted examples when nothing has washed up yet", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ scraps: [] });
    const { container, root } = await renderCard();

    try {
      expect(container.textContent).toContain("internet scraps");
      expect(container.textContent).toContain("wash up on a shore of your own");
      expect(
        container.querySelector(".scraps-launch__strip-chip")?.textContent,
      ).toBe("examples");
      const images = container.querySelectorAll<HTMLImageElement>(
        ".scraps-launch__piece--image",
      );
      expect(images.length).toBeGreaterThan(0);
      for (const image of images) {
        expect(image.src).toMatch(
          /^https:\/\/(playhtml\.fun|wewere\.online)\//,
        );
      }
      expect(
        container.querySelector<HTMLAnchorElement>(".scraps-launch__cta")?.href,
      ).toBe("chrome-extension://test/scraps.html");
    } finally {
      cleanup(root, container);
    }
  });

  it("renders the reader's own scraps and caps the strip at eight", async () => {
    const scraps = Array.from({ length: 12 }, (_unused, index) =>
      scrapImage(`scrap-${index}`),
    );
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ scraps });
    const { container, root } = await renderCard();

    try {
      expect(container.textContent).toContain("12 scraps have washed up");
      expect(container.querySelector(".scraps-launch__strip-chip")).toBeNull();
      const images = container.querySelectorAll<HTMLImageElement>(
        ".scraps-launch__piece--image",
      );
      expect(images.length).toBe(8);
      expect(images[0].src).toBe("https://example.com/scrap-0.png");
    } finally {
      cleanup(root, container);
    }
  });

  it("hides the card once dismissed and records the dismissal", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ scraps: [] });
    const { container, root } = await renderCard();

    try {
      const dismiss = container.querySelector<HTMLButtonElement>(
        ".scraps-launch__dismiss",
      );
      expect(dismiss).not.toBeNull();

      await act(async () => {
        dismiss?.click();
      });

      expect(container.querySelector(".scraps-launch")).toBeNull();
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        "announcement_seen_scraps-2026-08-newtab": "dismissed",
      });
    } finally {
      cleanup(root, container);
    }
  });

  it("does not render while the scraps feature is unreachable", async () => {
    expect(FLAGS.SCRAPS).toBe(false);
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      wwoInternalAccess: { enabled: false, checkedAt: 1 },
    });
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ scraps: [] });
    const { container, root } = await renderCard();

    try {
      expect(container.querySelector(".scraps-launch")).toBeNull();
      expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });
});
