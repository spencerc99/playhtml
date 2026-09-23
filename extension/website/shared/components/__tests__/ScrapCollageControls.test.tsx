// ABOUTME: Verifies responsive density and the compact internet-scraps control pane.
// ABOUTME: Covers browsing modes, layouts, filters, search, popover counts, shuffle, and collapse.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  responsiveTargetCount,
  ScrapCollage,
  type ScrapItem,
} from "../ScrapCollage";

function buildItems(count: number): ScrapItem[] {
  return Array.from({ length: count }, (_, index) => {
    const base = {
      id: `s${index}`,
      key: `s${index}`,
      pageTitle: `Page ${index}`,
      domain: `d${index}.example`,
      pageUrl: `https://d${index}.example/`,
      ts: index,
    };
    return index % 2 === 0
      ? {
          ...base,
          kind: "image" as const,
          src: `https://cdn.example/s${index}.jpg`,
          naturalWidth: 400,
          naturalHeight: 300,
        }
      : { ...base, kind: "button" as const, text: `Scrap ${index}`, styles: {} };
  });
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
            '[aria-label="Clear search"]',
          )!
          .click(),
      );
      act(() =>
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent?.startsWith("from"))!
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
      (button) => button.textContent?.endsWith("shuffle"),
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
        .find((button) => button.textContent?.startsWith("type"))
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
      (button) => button.textContent?.endsWith("shuffle"),
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
        (button) => button.textContent?.endsWith("shuffle"),
      ),
    ).toBe(false);
  });

  const typeInto = (input: HTMLInputElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

  const fewItems = (): ScrapItem[] => {
    const base = (id: string, pageUrl: string, pageTitle: string, ts: number) => ({
      id,
      key: id,
      pageUrl,
      pageTitle,
      domain: new URL(pageUrl).hostname,
      ts,
    });
    return [
      {
        ...base("a", "https://are.na/garden", "Garden", 1),
        kind: "image",
        src: "https://cdn.example/a.jpg",
        naturalWidth: 400,
        naturalHeight: 300,
      },
      {
        ...base("b", "https://are.na/shop", "Shop", 2),
        kind: "button",
        text: "Buy",
        styles: {},
      },
      {
        ...base("c", "https://spencer.place/notes", "Notes", 3),
        kind: "image",
        src: "https://cdn.example/c.jpg",
        naturalWidth: 400,
        naturalHeight: 300,
      },
      {
        ...base("d", "https://example.com/", "Garden shop", 4),
        kind: "button",
        text: "Enter",
        styles: {},
      },
    ];
  };

  const chip = (label: string) =>
    Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.startsWith(label),
    )!;

  const optionRow = (name: string) =>
    Array.from(
      container.querySelectorAll<HTMLButtonElement>(".scrap-filters__option"),
    ).find(
      (row) => row.querySelector(".scrap-filters__name")?.textContent === name,
    )!;

  it("keeps search visible, shows the match count, and clears in place", () => {
    act(() =>
      root.render(<ScrapCollage items={fewItems()} seed={1} showKindFilter />),
    );
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search scraps"]',
    )!;
    expect(search).not.toBeNull();
    expect(container.querySelector('[aria-label="Clear search"]')).toBeNull();

    act(() => search.focus());
    typeInto(search, "garden");
    expect(
      container.querySelector(".scrap-filters__matches")?.textContent,
    ).toBe("2");
    expect(tiles()).toHaveLength(2);

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!
        .click(),
    );
    expect(search.value).toBe("");
    expect(document.activeElement).toBe(search);
    expect(container.querySelector('[aria-label="Clear search"]')).toBeNull();
    expect(tiles()).toHaveLength(4);

    typeInto(search, "notes");
    act(() => {
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(search.value).toBe("");
    expect(
      container.querySelector('input[aria-label="Search scraps"]'),
    ).toBe(search);
  });

  it("summarises picked sites on the from chip and pins them in the popover", () => {
    act(() =>
      root.render(<ScrapCollage items={fewItems()} seed={1} showKindFilter />),
    );
    expect(chip("from").textContent).toContain("anywhere");
    expect(chip("from").hasAttribute("data-on")).toBe(false);
    act(() => chip("from").click());
    expect(chip("from").getAttribute("aria-expanded")).toBe("true");

    act(() => optionRow("are.na").focus());
    act(() => optionRow("are.na").click());
    expect(chip("from").textContent).toContain("are.na");
    // The picked row moves to the top and keeps focus, so Escape still closes.
    expect(document.activeElement).toBe(optionRow("are.na"));
    act(() => optionRow("spencer.place").click());
    expect(chip("from").textContent).toContain("2 sites");
    expect(chip("from").hasAttribute("data-on")).toBe(true);
    expect(
      container.querySelectorAll(".scrap-filters__row > button"),
    ).toHaveLength(0);

    const names = Array.from(
      container.querySelectorAll(".scrap-filters__option .scrap-filters__name"),
    ).map((name) => name.textContent);
    expect(names).toEqual(["are.na", "spencer.place", "example.com"]);
    expect(
      container.querySelector(".scrap-filters__options hr"),
    ).not.toBeNull();
    expect(tiles()).toHaveLength(3);
  });

  it("counts scraps per site and per type in the popovers", () => {
    act(() =>
      root.render(<ScrapCollage items={fewItems()} seed={1} showKindFilter />),
    );
    act(() => chip("from").click());
    const count = (name: string) =>
      optionRow(name).querySelector(".scrap-filters__count")?.textContent;
    expect(count("are.na")).toBe("2");
    expect(count("spencer.place")).toBe("1");
    expect(count("example.com")).toBe("1");

    act(() => chip("type").click());
    expect(container.querySelector(".scrap-filters__popover--places")).toBeNull();
    const kindCount = (kind: string) =>
      container.querySelector(
        `[data-scrap-kind="${kind}"] .scrap-filters__count`,
      )?.textContent;
    expect(kindCount("all")).toBe("4");
    expect(kindCount("image")).toBe("2");
    expect(kindCount("button")).toBe("2");
    expect(kindCount("cursor")).toBe("0");

    const typeChip = chip("type");
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-scrap-kind="image"]')!
        .click(),
    );
    expect(container.querySelector(".scrap-filters__popover")).toBeNull();
    expect(document.activeElement).toBe(typeChip);
    expect(typeChip.hasAttribute("data-on")).toBe(true);

    act(() => chip("from").click());
    expect(count("are.na")).toBe("1");
    expect(count("example.com")).toBe("0");
  });
});
