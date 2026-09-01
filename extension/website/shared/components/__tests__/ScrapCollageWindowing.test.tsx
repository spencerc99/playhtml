// ABOUTME: Verifies that the full Internet Scraps archive is windowed to the scroll viewport.
// ABOUTME: Keeps archive layout work bounded and limits the visible stacking depth.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildArchiveWindow,
  ScrapCollage,
  curateScraps,
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

describe("buildArchiveWindow", () => {
  it("lays out only nearby rows and limits their stacking depth", () => {
    const items = buildItems(5_000);
    const initial = buildArchiveWindow(items, 900, 0, 600, 1);
    const scrolled = buildArchiveWindow(items, 900, 20_000, 600, 1);

    expect(initial.fieldHeight).toBeGreaterThan(600);
    expect(initial.layout.length).toBeLessThan(100);
    expect(scrolled.layout.length).toBeLessThan(100);
    expect(Math.max(...initial.layout.map((scrap) => scrap.zIndex))).toBe(3);
    expect(scrolled.layout[0]?.item.key).not.toBe(initial.layout[0]?.item.key);
  });

  it("renders nothing before the viewport has measurable dimensions", () => {
    expect(buildArchiveWindow(buildItems(10), 0, 0, 600, 1)).toEqual({
      fieldHeight: 0,
      layout: [],
    });
  });
});

describe("archive-mode identity", () => {
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

describe("ScrapCollage archive-mode windowing", () => {
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

    const archive = container.querySelector<HTMLButtonElement>(
      '[aria-label="Scrap view"] button:last-child',
    );
    expect(archive).not.toBeNull();
    act(() => {
      archive?.click();
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
    expect(initialKeys[0]).toBe("s4999");

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
