// ABOUTME: Verifies responsive density and the compact internet-scraps control pane.
// ABOUTME: Covers amount, kind, shuffle, and collapse controls on the collage.

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
    expect(responsiveTargetCount(1_000, 800)).toBe(100);
    expect(responsiveTargetCount(1_600, 1_000)).toBe(200);
    expect(responsiveTargetCount(2_400, 1_600)).toBe(400);
  });
});

describe("ScrapCollage controls", () => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreRect: () => void;

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
      root.render(<ScrapCollage items={buildItems(500)} seed={1} showKindFilter />);
    });
  };

  const tiles = () =>
    container.querySelectorAll<HTMLElement>("[data-scrap-key]");

  it("fills the viewport by default and allows a fixed visible amount", () => {
    render();
    expect(tiles()).toHaveLength(200);

    const amount = container.querySelector<HTMLSelectElement>(
      '[aria-label="Number of scraps shown"]',
    );
    expect(amount).not.toBeNull();
    act(() => {
      if (!amount) return;
      amount.value = "100";
      amount.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(tiles()).toHaveLength(100);
  });

  it("filters by kind, shuffles positions, and collapses the pane", () => {
    render();
    const kinds = container.querySelector<HTMLSelectElement>(
      '[aria-label="Kinds of scraps shown"]',
    );
    act(() => {
      if (!kinds) return;
      kinds.value = "image";
      kinds.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(
      Array.from(tiles()).every((tile) => Number(tile.dataset.scrapKey?.slice(1)) % 2 === 0),
    ).toBe(true);

    const orderedKeys = () => Array.from(tiles(), (tile) => tile.dataset.scrapKey);
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
});
