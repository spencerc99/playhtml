// ABOUTME: Verifies the new-tab internet-scraps launch card states, dismissal, and feature gate.
// ABOUTME: Covers the example pile, the reader's pile, the compact pile after dismissal, and the dark-feature case.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import browser from "webextension-polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PILE_CAPACITY, ScrapsLaunchCard, scrapSites } from "./ScrapsLaunchCard";
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

function mockScraps(scraps: unknown[], total = scraps.length) {
  vi.mocked(browser.runtime.sendMessage).mockImplementation(
    async (message: unknown) =>
      (message as { type: string }).type === "GET_SCRAP_COUNT"
        ? { total }
        : { scraps },
  );
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
      wwoFeatureAccess: { features: { SCRAPS: { stage: "beta", available: true } }, checkedAt: 1 },
      wwoFeatureOverrides: { SCRAPS: true },
    });
    vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("shows hosted examples when nothing has been collected yet", async () => {
    mockScraps([]);
    const { container, root } = await renderCard();

    try {
      expect(container.textContent).toContain("internet scraps");
      expect(container.textContent).toContain("WWO now collects images");
      expect(container.textContent).not.toContain("so far");
      expect(container.querySelector(".scraps-launch__pile")).not.toBeNull();
      expect(
        container.querySelector(".scraps-launch__strip-chip")?.textContent,
      ).toBe("examples");
      expect(
        container.querySelector<HTMLAnchorElement>(".scraps-launch__cta")?.href,
      ).toBe("chrome-extension://test/scraps.html");
    } finally {
      cleanup(root, container);
    }
  });

  it("asks for the newest scraps and shows the reader's own pile", async () => {
    const scraps = Array.from({ length: 12 }, (_unused, index) =>
      scrapImage(`scrap-${index}`),
    );
    mockScraps(scraps);
    const { container, root } = await renderCard();

    try {
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
        type: "GET_SCRAPS",
        options: { limit: PILE_CAPACITY },
      });
      expect(container.textContent).toContain("(12 scraps so far)");
      expect(container.querySelector(".scraps-launch__pile")).not.toBeNull();
      expect(container.querySelector(".scraps-launch__strip-chip")).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it("counts every collected scrap, not only the loaded page", async () => {
    mockScraps([scrapImage("only")], 431);
    const { container, root } = await renderCard();

    try {
      expect(container.textContent).toContain("(431 scraps so far)");
    } finally {
      cleanup(root, container);
    }
  });

  it("keeps the pile as a compact window once the text is dismissed", async () => {
    mockScraps([scrapImage("kept")], 7);
    const { container, root } = await renderCard();

    try {
      const dismiss = container.querySelector<HTMLButtonElement>(
        ".scraps-launch__dismiss",
      );
      expect(dismiss).not.toBeNull();

      await act(async () => {
        dismiss?.click();
      });

      expect(container.querySelector(".scraps-launch__text")).toBeNull();
      expect(container.querySelector("h2")?.textContent).toBe("internet scraps");
      expect(container.querySelector(".scraps-launch--compact")).not.toBeNull();
      expect(
        container.querySelector(".scraps-launch__sites")?.textContent,
      ).toBe("from 1 siteexample.com1");
      expect(container.querySelector(".scraps-launch__pile")).not.toBeNull();
      expect(
        container.querySelector(".scraps-launch__footer-link")?.textContent,
      ).toBe("view all 7 →");
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        "announcement_seen_scraps-2026-08-newtab": "dismissed",
      });
    } finally {
      cleanup(root, container);
    }
  });

  it("leaves nothing behind once dismissed with no scraps yet", async () => {
    mockScraps([]);
    const { container, root } = await renderCard();

    try {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(".scraps-launch__dismiss")
          ?.click();
      });

      expect(container.querySelector(".scraps-launch")).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it("does not render while the scraps feature is unreachable", async () => {
    expect(FLAGS.SCRAPS).toBe(false);
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      wwoFeatureAccess: { features: { SCRAPS: { stage: "beta", available: false } }, checkedAt: 1 },
      wwoFeatureOverrides: { SCRAPS: true },
    });
    mockScraps([]);
    const { container, root } = await renderCard();

    try {
      expect(container.querySelector(".scraps-launch")).toBeNull();
      expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    } finally {
      cleanup(root, container);
    }
  });

  it("lists the pile's sites with the most scraps first", () => {
    const at = (domain: string, ts: number, faviconUrl?: string) => ({
      ...scrapImage(`${domain}-${ts}`),
      domain,
      ts,
      faviconUrl,
    });
    expect(
      scrapSites([
        at("a.com", 1),
        at("b.com", 5),
        at("b.com", 2, "https://b.com/icon.png"),
        at("c.com", 9),
        at("a.com", 3),
      ]),
    ).toEqual([
      { domain: "b.com", count: 2, faviconUrl: "https://b.com/icon.png" },
      { domain: "a.com", count: 2, faviconUrl: undefined },
      { domain: "c.com", count: 1, faviconUrl: undefined },
    ]);
  });
});
