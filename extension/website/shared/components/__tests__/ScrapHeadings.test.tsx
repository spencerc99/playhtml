// ABOUTME: Tests how heading scraps identify, size, and render inside the collage.
// ABOUTME: Covers the level-insensitive canonical key, font-size clamping, and the kind filter.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildArchiveWindow,
  canonicalScrapKey,
  headingDisplayFontSize,
  ScrapCollage,
  type ScrapItem,
} from "../ScrapCollage";
import { canonicalHeadingKey } from "../../utils/scrapIdentity";

const BASE = {
  pageTitle: "Low tide inventory",
  domain: "tidepool.example",
  pageUrl: "https://tidepool.example/",
  ts: 1_784_000_000_000,
};

type HeadingScrap = Extract<ScrapItem, { kind: "heading" }>;

function heading(
  id: string,
  text: string,
  level: 1 | 2 | 3 = 2,
  styles: Record<string, string> = {},
): HeadingScrap {
  return { ...BASE, id, key: id, kind: "heading", text, level, styles };
}

describe("heading scrap identity", () => {
  it("treats the same wording as one heading whatever its level or case", () => {
    expect(canonicalScrapKey(heading("a", "What the tide left behind", 1))).toBe(
      canonicalScrapKey(heading("b", "WHAT THE TIDE LEFT BEHIND", 3)),
    );
  });

  it("collapses runs of whitespace before comparing wording", () => {
    expect(canonicalHeadingKey("tidepool.example", "  Low   tide\n\ninventory ")).toBe(
      canonicalHeadingKey("tidepool.example", "Low tide inventory"),
    );
  });

  it("keeps the same wording on different domains apart", () => {
    expect(canonicalHeadingKey("tidepool.example", "Low tide")).not.toBe(
      canonicalHeadingKey("orchard.example", "Low tide"),
    );
  });

  it("ignores position when identifying a heading", () => {
    const placed: ScrapItem = {
      ...heading("a", "Low tide inventory"),
      position: { pageX: 10, pageY: 20, pageWidth: 1024, pageHeight: 4000 },
    };
    const elsewhere: ScrapItem = {
      ...heading("b", "Low tide inventory"),
      position: { pageX: 900, pageY: 3200, pageWidth: 1024, pageHeight: 4000 },
    };
    expect(canonicalScrapKey(placed)).toBe(canonicalScrapKey(elsewhere));
  });
});

describe("headingDisplayFontSize", () => {
  it("clamps captured sizes into the collage's readable band", () => {
    expect(headingDisplayFontSize({ fontSize: "96px" }, "Short")).toBe(34);
    expect(headingDisplayFontSize({ fontSize: "4px" }, "Short")).toBe(11);
    expect(headingDisplayFontSize({ fontSize: "22px" }, "Short")).toBe(22);
  });

  it("falls back to the smallest display size when no size was captured", () => {
    expect(headingDisplayFontSize({}, "Short")).toBe(11);
    expect(headingDisplayFontSize({ fontSize: "inherit" }, "Short")).toBe(11);
  });

  it("shrinks long wording so it fits a tile instead of being clipped", () => {
    const long = "y".repeat(120);
    const size = headingDisplayFontSize({ fontSize: "96px" }, long);
    expect(size).toBeLessThan(34);
    expect(size).toBeGreaterThanOrEqual(11);
  });

  it("never shrinks below the readable floor for the longest wording", () => {
    expect(headingDisplayFontSize({ fontSize: "96px" }, "y".repeat(400))).toBe(11);
  });
});

describe("heading tiles in the archive", () => {
  const long = heading("h-long", "Heirloom pears, ranked by sweetness", 1, {
    fontSize: "96px",
  });

  it("keeps room for the lines the wording wraps onto in the pile", () => {
    const { layout } = buildArchiveWindow(
      [long],
      1200,
      0,
      850,
      1,
      undefined,
      "pile",
    );
    const tile = layout[0];
    const fontSize = headingDisplayFontSize(
      long.styles,
      long.text,
      tile.width,
    );
    const lines = Math.ceil(
      (long.text.length * fontSize * 0.68) / Math.max(1, tile.width - 16),
    );
    expect(tile.height).toBeGreaterThanOrEqual(lines * fontSize * 1.15);
  });

  it("never gives a heading a tile taller than its archive cell", () => {
    for (const display of ["pile", "grid"] as const) {
      const { layout } = buildArchiveWindow(
        [long],
        1200,
        0,
        850,
        1,
        undefined,
        display,
      );
      expect(layout[0].height).toBeLessThanOrEqual(
        display === "pile" ? 74 : 112,
      );
    }
  });
});

describe("heading scraps in the collage", () => {
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

  const items: ScrapItem[] = [
    heading("h-serif", "Heirloom pears, ranked", 1, {
      fontFamily: "Georgia, serif",
      fontSize: "96px",
      fontWeight: "700",
      color: "rgb(61, 56, 51)",
    }),
    {
      ...BASE,
      id: "img",
      key: "img",
      kind: "image",
      src: "https://cdn.example/a.jpg",
      naturalWidth: 400,
      naturalHeight: 300,
    },
  ];

  const render = () => {
    act(() => {
      root.render(<ScrapCollage items={items} seed={1} showKindFilter />);
    });
  };

  it("renders the heading's text in its captured styles at a clamped size", () => {
    render();
    const rendered = container.querySelector<HTMLElement>(
      ".scrap-collage__heading",
    );
    expect(rendered).not.toBeNull();
    expect(rendered?.textContent).toBe("Heirloom pears, ranked");
    expect(rendered?.style.fontFamily).toBe("Georgia, serif");
    expect(rendered?.style.fontWeight).toBe("700");
    expect(rendered?.style.color).toBe("rgb(61, 56, 51)");
    expect(rendered?.style.fontSize).toBe("22px");
  });

  it("renders heading text as text rather than markup", () => {
    act(() => {
      root.render(
        <ScrapCollage
          items={[heading("h-markup", "<img src=x onerror=alert(1)>")]}
          seed={1}
        />,
      );
    });
    const rendered = container.querySelector<HTMLElement>(
      ".scrap-collage__heading",
    );
    expect(rendered?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img[src='x']")).toBeNull();
  });

  it("renders a heading as bare text, with its own color and no patch", () => {
    act(() => {
      root.render(
        <ScrapCollage
          items={[
            heading("h-pale", "Pale type from a dark page", 2, {
              color: "rgb(245, 240, 232)",
            }),
          ]}
          seed={1}
        />,
      );
    });
    expect(container.querySelector(".scrap-collage__backdrop")).toBeNull();
    const rendered = container.querySelector<HTMLElement>(
      ".scrap-collage__heading",
    );
    expect(rendered?.textContent).toBe("Pale type from a dark page");
    expect(rendered?.style.color).toBe("rgb(245, 240, 232)");
    expect(rendered?.style.background).toBe("");
  });

  it("offers a headings type filter that narrows the collage to headings", () => {
    render();
    act(() =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.startsWith("Type"))
        ?.click(),
    );
    const headings = container.querySelector<HTMLButtonElement>(
      '[data-scrap-kind="heading"]',
    );
    expect(headings?.textContent).toBe("headings");
    act(() => headings?.click());
    expect(container.querySelectorAll(".scrap-collage__heading").length).toBe(1);
    expect(
      container.querySelector("img[src='https://cdn.example/a.jpg']"),
    ).toBeNull();
  });
});
