// ABOUTME: Tests the internet-scraps examine view: provenance derivation and lift geometry.
// ABOUTME: Also covers opening from a collage tile, Escape closing, and arrow navigation.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrapCollage, type ScrapItem } from "../ScrapCollage";
import {
  collapseTransform,
  formatCollectedMoment,
  kindDetailRows,
  liftedSize,
  settledRotation,
} from "../ScrapLightbox";

const BASE = {
  id: "id",
  key: "key",
  pageTitle: "A page",
  domain: "example.com",
  pageUrl: "https://example.com/page",
  ts: 1_784_000_000_000,
};

describe("kindDetailRows", () => {
  it("reports natural dimensions and alt text for images", () => {
    expect(
      kindDetailRows({
        ...BASE,
        kind: "image",
        src: "https://example.com/a.png",
        alt: "a pear",
        naturalWidth: 480,
        naturalHeight: 640,
      }),
    ).toEqual([
      { label: "dimensions", value: "480 x 640" },
      { label: "alt text", value: "a pear" },
    ]);
  });

  it("omits the alt row when the image has no alt text", () => {
    const rows = kindDetailRows({
      ...BASE,
      kind: "image",
      src: "https://example.com/a.png",
      naturalWidth: 100,
      naturalHeight: 100,
    });
    expect(rows.map((row) => row.label)).toEqual(["dimensions"]);
  });

  it("reports the button label", () => {
    expect(
      kindDetailRows({
        ...BASE,
        kind: "button",
        text: "  Subscribe  ",
        styles: {},
      }),
    ).toEqual([{ label: "label", value: "Subscribe" }]);
  });

  it("omits the label row for an icon-only button", () => {
    expect(
      kindDetailRows({
        ...BASE,
        kind: "button",
        text: "   ",
        styles: {},
        innerSvg: "<svg />",
      }),
    ).toEqual([]);
  });

  it("reports svg icon dimensions", () => {
    expect(
      kindDetailRows({
        ...BASE,
        kind: "svg-icon",
        markup: "<svg />",
        width: 24,
        height: 20,
      }),
    ).toEqual([{ label: "dimensions", value: "24 x 20" }]);
  });

  it("reports a cursor hotspot only when both coordinates are stored", () => {
    expect(
      kindDetailRows({
        ...BASE,
        kind: "cursor",
        url: "https://example.com/c.png",
        hotspotX: 4,
        hotspotY: 7,
      }),
    ).toEqual([{ label: "hotspot", value: "4, 7" }]);
    expect(
      kindDetailRows({
        ...BASE,
        kind: "cursor",
        url: "https://example.com/c.png",
        hotspotX: 4,
      }),
    ).toEqual([]);
  });
});

describe("formatCollectedMoment", () => {
  it("includes a human date and time", () => {
    const formatted = formatCollectedMoment(Date.UTC(2026, 2, 14, 16, 7));
    expect(formatted).toMatch(/Mar 1[45], 2026 · \d{1,2}:\d{2} (AM|PM)/);
  });
});

describe("liftedSize", () => {
  it("fills 55% of the smaller viewport dimension on the long edge", () => {
    const size = liftedSize(
      { width: 200, height: 100 },
      { width: 1600, height: 800 },
    );
    expect(size.width).toBeCloseTo(440);
    expect(size.height).toBeCloseTo(220);
  });

  it("uses the height as the long edge for portrait scraps", () => {
    const size = liftedSize(
      { width: 100, height: 200 },
      { width: 1600, height: 800 },
    );
    expect(size.width).toBeCloseTo(220);
    expect(size.height).toBeCloseTo(440);
  });

  it("falls back to a square when the origin has no measurable size", () => {
    expect(liftedSize({ width: 0, height: 0 }, { width: 1000, height: 1000 })).toEqual({
      width: 550,
      height: 550,
    });
  });
});

describe("settledRotation", () => {
  it("clamps the collage tilt into the settled range", () => {
    expect(settledRotation(5.4)).toBe(2);
    expect(settledRotation(-5.4)).toBe(-2);
  });

  it("keeps a tilt already inside the range", () => {
    expect(settledRotation(1.25)).toBe(1.25);
  });
});

describe("collapseTransform", () => {
  it("translates the lifted centre onto the tile centre and scales down to it", () => {
    const transform = collapseTransform(
      { left: 100, top: 50, width: 80, height: 40, rotation: -6 },
      { width: 400, height: 200 },
      { x: 500, y: 300 },
    );
    expect(transform).toBe(
      "translate(-360px, -230px) scale(0.2000, 0.2000) rotate(-6deg)",
    );
  });
});

function buildItems(): ScrapItem[] {
  return [
    {
      id: "a",
      key: "a",
      kind: "button",
      text: "Alpha",
      styles: {},
      pageTitle: "Alpha page",
      domain: "alpha.example",
      pageUrl: "https://alpha.example/",
      ts: 3,
    },
    {
      id: "b",
      key: "b",
      kind: "button",
      text: "Beta",
      styles: {},
      pageTitle: "Beta page",
      domain: "beta.example",
      pageUrl: "https://beta.example/",
      ts: 2,
    },
    {
      id: "c",
      key: "c",
      kind: "button",
      text: "Gamma",
      styles: {},
      pageTitle: "Gamma page",
      domain: "gamma.example",
      pageUrl: "https://gamma.example/",
      ts: 1,
    },
  ];
}

describe("ScrapCollage examine view", () => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreRect: (() => void) | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    // jsdom reports every element as zero-sized and ships no ResizeObserver,
    // so the collage would lay out nothing. Give elements a real box.
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
        width: 900,
        height: 600,
        right: 900,
        bottom: 600,
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
    restoreRect?.();
    restoreRect = null;
    vi.unstubAllGlobals();
  });

  const render = () => {
    act(() => {
      root.render(<ScrapCollage items={buildItems()} seed={1} targetCount={3} />);
    });
  };

  const tiles = () =>
    Array.from(container.querySelectorAll<HTMLElement>("[data-scrap-key]"));

  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  const clickTile = (index: number) => {
    act(() => {
      tiles()[index].dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  };

  const pressKey = (key: string, init: KeyboardEventInit = {}) => {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
      );
    });
  };

  it("opens the examine dialog when a scrap is clicked", () => {
    render();
    expect(dialog()).toBeNull();
    clickTile(0);
    const opened = dialog();
    expect(opened).not.toBeNull();
    expect(opened?.getAttribute("aria-modal")).toBe("true");
  });

  const panelHeading = () =>
    document.querySelector(".scrap-lightbox__heading")?.textContent;

  it("keeps Tab focus cycling inside the dialog", () => {
    render();
    clickTile(0);
    const overlay = document.querySelector<HTMLElement>(".scrap-lightbox");
    expect(overlay).not.toBeNull();

    // Enough presses to run past the dialog's own focusable count, so a leak
    // out to the collage tiles behind the overlay would show up.
    for (let press = 0; press < 8; press += 1) {
      pressKey("Tab");
      expect(overlay?.contains(document.activeElement)).toBe(true);
    }
    pressKey("Tab", { shiftKey: true });
    expect(overlay?.contains(document.activeElement)).toBe(true);
  });

  it("returns focus to the tile it was opened from when it closes", () => {
    vi.useFakeTimers();
    try {
      render();
      const trigger = tiles()[0];
      clickTile(0);
      expect(document.activeElement).not.toBe(trigger);

      pressKey("Escape");
      // The put-down animation runs before the dialog unmounts and focus goes
      // back to the tile.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the clicked scrap's provenance in the panel", () => {
    render();
    const key = tiles()[0].dataset.scrapKey;
    const item = buildItems().find((entry) => entry.key === key);
    clickTile(0);
    expect(panelHeading()).toBe(item?.pageTitle);
    const panel = document.querySelector(".scrap-lightbox__panel");
    expect(panel?.textContent).toContain(item?.domain);
    expect(panel?.textContent).toContain("collected");
    expect(panel?.textContent).toContain("visit page");
  });

  it("links to the source page it was found at", () => {
    render();
    const key = tiles()[0].dataset.scrapKey;
    const expectedUrl = buildItems().find((item) => item.key === key)?.pageUrl;
    clickTile(0);
    const action = document.querySelector<HTMLAnchorElement>(
      ".scrap-lightbox__action",
    );
    expect(action?.getAttribute("href")).toBe(expectedUrl);
    expect(action?.getAttribute("target")).toBe("_blank");
  });

  it("closes on Escape", () => {
    render();
    clickTile(0);
    expect(dialog()).not.toBeNull();
    pressKey("Escape");
    act(() => {});
    // The put-down animation runs before unmount, so the dialog is on its way
    // out rather than gone the same tick; the lifted class is dropped at once.
    expect(
      document
        .querySelector(".scrap-lightbox")
        ?.classList.contains("scrap-lightbox--visible"),
    ).toBe(false);
  });

  it("steps to the next and previous scrap with the arrow keys", () => {
    render();
    const keys = tiles().map((tile) => tile.dataset.scrapKey);
    const titleOf = (key: string | undefined) =>
      buildItems().find((item) => item.key === key)?.pageTitle ?? "";

    clickTile(0);
    expect(panelHeading()).toBe(titleOf(keys[0]));

    pressKey("ArrowRight");
    expect(panelHeading()).toBe(titleOf(keys[1]));

    pressKey("ArrowLeft");
    expect(panelHeading()).toBe(titleOf(keys[0]));
  });

  it("does not step past the ends of the visible order", () => {
    render();
    const keys = tiles().map((tile) => tile.dataset.scrapKey);
    const titleOf = (key: string | undefined) =>
      buildItems().find((item) => item.key === key)?.pageTitle ?? "";

    clickTile(0);
    pressKey("ArrowLeft");
    expect(panelHeading()).toBe(titleOf(keys[0]));

    pressKey("ArrowRight");
    pressKey("ArrowRight");
    pressKey("ArrowRight");
    expect(panelHeading()).toBe(titleOf(keys[2]));
  });
});
