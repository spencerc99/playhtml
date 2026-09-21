// ABOUTME: Verifies responsive density and the compact internet-scraps control pane.
// ABOUTME: Covers browsing modes, layouts, kind filters, selection shuffle, and collapse controls.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  responsiveTargetCount,
  ScrapCollage,
  type ScrapItem,
} from "../ScrapCollage";

function buildItems(count: number): ScrapItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    key: `s${index}`,
    kind: index % 2 === 0 ? ("image" as const) : ("button" as const),
    ...(index % 2 === 0
      ? {
          src: `https://cdn.example/s${index}.jpg`,
          naturalWidth: 400,
          naturalHeight: 300,
        }
      : { text: `Scrap ${index}`, styles: {} }),
    pageTitle: `Page ${index}`,
    domain: `d${index}.example`,
    pageUrl: `https://d${index}.example/`,
    ts: index,
  }));
}

describe("responsiveTargetCount", () => {
  it("scales with viewport area inside a bounded range", () => {
    expect(responsiveTargetCount(0, 0)).toBe(200);
    expect(responsiveTargetCount(1_000, 800)).toBe(143);
    expect(responsiveTargetCount(1_600, 1_000)).toBe(286);
    expect(responsiveTargetCount(2_400, 1_600)).toBe(500);
  });
});

describe("ScrapCollage controls", () => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreRect: () => void;

  beforeEach(() => {
    localStorage.clear();
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
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function measured(this: Element) {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 1_600,
        height: 1_000,
        right: 1_600,
        bottom: 1_000,
        toJSON: () => ({}),
      } as DOMRect;
    };
    restoreRect = () => {
      Element.prototype.getBoundingClientRect = originalRect;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    restoreRect();
    vi.unstubAllGlobals();
  });

  const render = () => {
    act(() => {
      root.render(
        <ScrapCollage items={buildItems(500)} seed={1} showKindFilter />,
      );
    });
  };

  const tiles = () =>
    container.querySelectorAll<HTMLElement>("[data-scrap-key]");

  it.each(["button", "svg-icon", "cursor"] as const)(
    "finds earlier %s occurrences before deduplication",
    (kind) => {
      const content =
        kind === "button"
          ? { kind, text: "Visit", styles: {} }
          : kind === "svg-icon"
            ? {
                kind,
                markup: '<svg><circle r="4" /></svg>',
                width: 20,
                height: 20,
              }
            : { kind, url: "https://cdn.example/cursor.png" };
      const base = { domain: "shop.example", ...content };
      const earlier = {
        ...base,
        id: "earlier",
        key: "earlier",
        ts: 1,
        pageTitle: "Catalog",
        pageUrl: "https://shop.example/shop",
      } as ScrapItem;
      const later = {
        ...earlier,
        id: "later",
        key: "later",
        ts: 2,
        pageTitle: "Welcome",
        pageUrl: "https://shop.example/home",
      };
      act(() =>
        root.render(
          <ScrapCollage items={[earlier, later]} seed={1} showKindFilter />,
        ),
      );
      act(() =>
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Scrap view"] button:last-child',
          )!
          .click(),
      );
      expect(tiles()).toHaveLength(1);
      expect(tiles()[0].dataset.scrapKey).toBe("later");
      act(() =>
        container
          .querySelector<HTMLButtonElement>('[aria-label="Search scraps"]')!
          .click(),
      );
      const search = container.querySelector<HTMLInputElement>(
        'input[aria-label="Search scraps"]',
      )!;
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(search, "Catalog");
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(tiles()).toHaveLength(1);
      expect(tiles()[0].dataset.scrapKey).toBe("earlier");
      act(() =>
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Clear and close search"]',
          )!
          .click(),
      );
      act(() =>
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent?.startsWith("Found on"))!
          .click(),
      );
      const source = container.querySelector<HTMLInputElement>(
        '[aria-label="Find a domain or page"]',
      )!;
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(source, "shop.example/shop");
        source.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act(() =>
        source
          .closest("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
      );
      expect(tiles()).toHaveLength(1);
      expect(tiles()[0].dataset.scrapKey).toBe("earlier");
    },
  );

  it("fills the viewport and shuffles in another selection", () => {
    render();
    expect(tiles()).toHaveLength(286);
    expect(
      container.querySelector('[aria-label="Number of scraps shown"]'),
    ).toBeNull();
    const before = new Set(
      Array.from(tiles(), (tile) => tile.dataset.scrapKey),
    );
    const shuffle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "shuffle",
    );
    act(() => shuffle?.click());
    expect(
      Array.from(tiles()).some((tile) => !before.has(tile.dataset.scrapKey)),
    ).toBe(true);
  });

  it("filters by kind, shuffles positions, and collapses the pane", () => {
    render();
    act(() =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.startsWith("Type"))
        ?.click(),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-scrap-kind="image"]')
        ?.click(),
    );
    expect(
      Array.from(tiles()).every(
        (tile) => Number(tile.dataset.scrapKey?.slice(1)) % 2 === 0,
      ),
    ).toBe(true);

    const orderedKeys = () =>
      Array.from(tiles(), (tile) => tile.dataset.scrapKey);
    const beforeShuffle = orderedKeys();
    const shuffle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "shuffle",
    );
    act(() => shuffle?.click());
    expect(orderedKeys()).not.toEqual(beforeShuffle);

    const collapse = container.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse scrap controls"]',
    );
    act(() => collapse?.click());
    expect(container.textContent).toContain("controls ↑");
    expect(
      container.querySelector('[aria-label="Number of scraps shown"]'),
    ).toBeNull();
  });

  it("switches pile and grid independently of browsing mode and remembers the layout", () => {
    render();
    const layout = container.querySelector('[aria-label="Scrap layout"]');
    const grid = layout?.querySelector<HTMLButtonElement>("button:last-child");
    act(() => grid?.click());
    expect(grid?.getAttribute("aria-pressed")).toBe("true");
    expect(
      Array.from(tiles()).every(
        (tile) => tile.style.getPropertyValue("--scrap-rotation") === "0deg",
      ),
    ).toBe(true);
    expect(localStorage.getItem("scraps-display")).toBe("grid");
    expect(container.querySelector(".scrap-collage__filter--cycle")).toBeNull();
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Scrap view"] button:last-child',
        )
        ?.click(),
    );
    expect(grid?.getAttribute("aria-pressed")).toBe("true");
    const scroller = container.querySelector<HTMLDivElement>(
      ".scrap-collage__scroll",
    )!;
    act(() => {
      scroller.scrollTop = 1120;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const beforeKeys = new Set(
      Array.from(tiles(), (tile) => tile.dataset.scrapKey),
    );
    act(() =>
      layout?.querySelector<HTMLButtonElement>("button:first-child")?.click(),
    );
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(
      Array.from(tiles()).some((tile) => beforeKeys.has(tile.dataset.scrapKey)),
    ).toBe(true);
  });

  it("separates drift controls from the chronological archive", () => {
    render();
    const view = container.querySelector('[aria-label="Scrap view"]');
    const drift = view?.querySelector<HTMLButtonElement>("button:first-child");
    const archive = view?.querySelector<HTMLButtonElement>("button:last-child");

    expect(drift?.getAttribute("aria-pressed")).toBe("true");
    expect(archive?.getAttribute("aria-pressed")).toBe("false");

    act(() => archive?.click());

    expect(drift?.getAttribute("aria-pressed")).toBe("false");
    expect(archive?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("newest first · 500");
    expect(
      container.querySelector('[aria-label="Number of scraps shown"]'),
    ).toBeNull();
    expect(container.querySelector(".scrap-collage__filter--cycle")).toBeNull();
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "shuffle",
      ),
    ).toBe(false);
  });
});
