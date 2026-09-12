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

  it("keeps varied image sizes inside their archive cells, including rotation", () => {
    const items: ScrapItem[] = Array.from({ length: 100 }, (_, index) => ({
      id: `image${index}`,
      key: `image${index}`,
      kind: "image",
      src: `https://images.example/${index}.png`,
      naturalWidth: 200 + (index % 10) * 180,
      naturalHeight: 200 + (index % 7) * 240,
      pageTitle: "Images",
      domain: "images.example",
      pageUrl: "https://images.example/",
      ts: index,
    }));
    for (const width of [320, 900, 1200]) {
      const columns = Math.floor(width / 160);
      const cellWidth = width / columns;
      for (const scrap of buildArchiveWindow(items, width, 0, 600, 1).layout) {
        const angle = Math.abs(scrap.rotation) * Math.PI / 180;
        const rotatedWidth = scrap.width * Math.cos(angle) + scrap.height * Math.sin(angle);
        const rotatedHeight = scrap.height * Math.cos(angle) + scrap.width * Math.sin(angle);
        const centerX = scrap.x + scrap.width / 2;
        const centerY = scrap.y + scrap.height / 2;
        const column = scrap.slotIndex % columns;
        const row = Math.floor(scrap.slotIndex / columns);
        expect(centerX - rotatedWidth / 2).toBeGreaterThanOrEqual(column * cellWidth);
        expect(centerX + rotatedWidth / 2).toBeLessThanOrEqual((column + 1) * cellWidth);
        expect(centerY - rotatedHeight / 2).toBeGreaterThanOrEqual(row * 112);
        expect(centerY + rotatedHeight / 2).toBeLessThanOrEqual((row + 1) * 112);
        expect(scrap.width / scrap.height).toBeCloseTo(
          (scrap.item as Extract<ScrapItem, { kind: "image" }>).naturalWidth /
          (scrap.item as Extract<ScrapItem, { kind: "image" }>).naturalHeight,
        );
      }
    }
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

  it("starts filtered archives at the newest scrap after scrolling", () => {
    const images: ScrapItem[] = Array.from({ length: 10 }, (_, index) => ({
      id: `image${index}`,
      key: `image${index}`,
      kind: "image",
      src: `https://images.example/${index}.png`,
      naturalWidth: 400,
      naturalHeight: 300,
      pageTitle: "Images",
      domain: "images.example",
      pageUrl: "https://images.example/",
      ts: 5_000 + index,
    }));
    act(() => {
      root.render(
        <ScrapCollage items={[...buildItems(5_000), ...images]} seed={1} showKindFilter />,
      );
    });
    act(() => {
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Scrap view"] button:last-child',
      )!.click();
    });
    const scroll = container.querySelector<HTMLDivElement>(".scrap-collage__scroll")!;
    act(() => {
      scroll.scrollTop = 20_000;
      scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const kinds = container.querySelector<HTMLSelectElement>(
      '[aria-label="Kinds of scraps shown"]',
    )!;
    for (const kind of ["image", "button", "all"]) {
      act(() => {
        kinds.value = kind;
        kinds.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(scroll.scrollTop).toBe(0);
      const tiles = container.querySelectorAll<HTMLElement>("[data-scrap-key]");
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles[0].dataset.scrapKey).toBe(kind === "button" ? "s4999" : "image9");
      if (kind === "image") expect(tiles).toHaveLength(10);
    }
  });
});
