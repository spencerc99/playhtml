// ABOUTME: Verifies that the full Internet Scraps archive is windowed to the scroll viewport.
// ABOUTME: Keeps everything-mode DOM work bounded while preserving the complete layout.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScrapCollage,
  curateScraps,
  scrapsNearViewport,
  type ScrapItem,
} from "../ScrapCollage";

function buildItems(count: number): ScrapItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    key: `s${index}`,
    kind: "button" as const,
    text: `Scrap ${index}`,
    styles: {},
    pageTitle: `Page ${index}`,
    domain: `d${index}.example`,
    pageUrl: `https://d${index}.example/`,
    ts: index,
  }));
}

describe("scrapsNearViewport", () => {
  const scraps = [
    { key: "above", y: 0, height: 20 },
    { key: "overscan-above", y: 70, height: 20 },
    { key: "visible", y: 120, height: 20 },
    { key: "overscan-below", y: 210, height: 20 },
    { key: "below", y: 240, height: 20 },
  ];

  it("keeps visible scraps plus a quarter viewport of overscan", () => {
    expect(scrapsNearViewport(scraps, 100, 100).map((scrap) => scrap.key)).toEqual([
      "overscan-above",
      "visible",
      "overscan-below",
    ]);
  });

  it("renders nothing before the viewport has a measurable height", () => {
    expect(scrapsNearViewport(scraps, 0, 0)).toEqual([]);
  });
});

describe("everything-mode identity", () => {
  it("keeps the newest scrap when archive records reuse a render key", () => {
    const [older, newer] = buildItems(2);
    older.key = "shared-key";
    older.ts = 1;
    newer.key = "shared-key";
    newer.ts = 2;

    expect(
      curateScraps([older, newer], {
        seed: 1,
        perDomainCap: Infinity,
        targetCount: Infinity,
      }).map((item) => item.id),
    ).toEqual([newer.id]);
  });
});

describe("ScrapCollage everything-mode windowing", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalRect: typeof Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function measured(this: Element) {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 900,
        height: 600,
        right: 900,
        bottom: 600,
        toJSON: () => ({}),
      } as DOMRect;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Element.prototype.getBoundingClientRect = originalRect;
    vi.unstubAllGlobals();
  });

  it("mounts only the viewport neighborhood and swaps tiles while scrolling", () => {
    act(() => {
      root.render(
        <ScrapCollage items={buildItems(5_000)} seed={1} showKindFilter />,
      );
    });

    const amount = container.querySelector<HTMLSelectElement>(
      '[aria-label="Number of scraps shown"]',
    );
    expect(amount).not.toBeNull();
    act(() => {
      if (!amount) return;
      amount.value = "everything";
      amount.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const scroll = container.querySelector<HTMLDivElement>(
      ".scrap-collage__scroll",
    );
    const initialKeys = Array.from(
      container.querySelectorAll<HTMLElement>("[data-scrap-key]"),
      (tile) => tile.dataset.scrapKey,
    );
    expect(initialKeys.length).toBeGreaterThan(0);
    expect(initialKeys.length).toBeLessThan(5_000);

    act(() => {
      if (!scroll) return;
      scroll.scrollTop = 1_500;
      scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    const scrolledKeys = Array.from(
      container.querySelectorAll<HTMLElement>("[data-scrap-key]"),
      (tile) => tile.dataset.scrapKey,
    );
    expect(scrolledKeys.length).toBeGreaterThan(0);
    expect(scrolledKeys.length).toBeLessThan(5_000);
    expect(scrolledKeys).not.toEqual(initialKeys);
  });
});
