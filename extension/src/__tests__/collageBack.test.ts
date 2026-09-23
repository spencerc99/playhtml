// ABOUTME: Tests the back of a collage: its layout math, its source lines, and its markup.
// ABOUTME: Guards that the writing always fits the frame and that nothing on it is a link.

import { describe, expect, it } from "vitest";
import {
  SOURCE_HEADER,
  SOURCE_LINE_HEIGHT,
  SOURCE_TYPE_STEPS,
  backDate,
  backDetailLines,
  backInk,
  backLayout,
  collageBackDocument,
  collageBackMarkup,
  morePagesLine,
  sourceLineWords,
  type BackFavicon,
  type CollageBackContent,
} from "../entrypoints/scraps/collageBack";
import type { CollageProvenance } from "../entrypoints/scraps/collageRecord";
import { COLLAGE_FORMATS } from "../entrypoints/scraps/collageFormats";

const POSTCARD = COLLAGE_FORMATS.postcard;
const PALE = { color: "#fffdf9", grain: true };
const MARK = "data:image/png;base64,TUFSSw==";
const TALL = COLLAGE_FORMATS["postcard-tall"];

function source(index: number, overrides: Partial<CollageProvenance> = {}) {
  return {
    pageUrl: `https://site${index}.test/page`,
    domain: `site${index}.test`,
    pageTitle: `Page number ${index}`,
    firstSeenAt: Date.UTC(2026, 2, 3) + index * 60_000,
    pieceCount: 1,
    ...overrides,
  } satisfies CollageProvenance;
}

function content(
  sources: CollageProvenance[],
  overrides: Partial<CollageBackContent> = {},
): CollageBackContent {
  return {
    title: "a walk through march",
    createdAt: Date.UTC(2026, 2, 3, 12),
    changedAt: Date.UTC(2026, 2, 9, 12),
    pieceCount: 7,
    formatLabel: "postcard · 1500 × 1000",
    sources,
    ...overrides,
  };
}

/** Lines one column of a layout can hold at the type size it chose. */
function rowsAvailable(layout: ReturnType<typeof backLayout>): number {
  return Math.floor(
    (layout.sources.height - SOURCE_HEADER) / layout.lineHeight,
  );
}

describe("backLayout", () => {
  it("divides a landscape back left and right and a tall one top and bottom", () => {
    const across = backLayout(POSTCARD, 3);
    expect(across.orientation).toBe("across");
    expect(across.rule.x1).toBe(across.rule.x2);
    expect(across.sources.x + across.sources.width).toBeLessThan(across.rule.x1);
    expect(across.details.x).toBeGreaterThan(across.rule.x1);

    const down = backLayout(TALL, 3);
    expect(down.orientation).toBe("down");
    expect(down.rule.y1).toBe(down.rule.y2);
    expect(down.details.y + down.details.height).toBeLessThan(down.rule.y1);
    expect(down.sources.y).toBeGreaterThan(down.rule.y1);
  });

  it("writes a short list at the largest type step", () => {
    const layout = backLayout(POSTCARD, 1);
    expect(layout.fontSize).toBe(SOURCE_TYPE_STEPS[0]);
    expect(layout.columns).toBe(1);
    expect(layout.shown).toBe(1);
    expect(layout.more).toBe(0);
  });

  it("steps the type down as the list grows, never getting larger", () => {
    let previous = Infinity;
    const seen = new Set<number>();
    for (let count = 1; count <= 40; count += 1) {
      const layout = backLayout(POSTCARD, count);
      expect(layout.fontSize).toBeLessThanOrEqual(previous);
      previous = layout.fontSize;
      seen.add(layout.fontSize);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it("keeps every line inside the frame for any count", () => {
    for (const format of Object.values(COLLAGE_FORMATS)) {
      for (let count = 0; count <= 200; count += 1) {
        const layout = backLayout(format, count);
        const lines = layout.shown + (layout.more > 0 ? 1 : 0);
        expect(lines).toBeLessThanOrEqual(layout.rows * layout.columns);
        expect(layout.rows).toBeLessThanOrEqual(rowsAvailable(layout));
        const listBottom =
          layout.sources.y + SOURCE_HEADER + layout.rows * layout.lineHeight;
        expect(listBottom).toBeLessThanOrEqual(format.height);
        expect(layout.shown + layout.more).toBe(count);
      }
    }
  });

  it("continues in a second column at the smallest step once one column is full", () => {
    const smallest = SOURCE_TYPE_STEPS[SOURCE_TYPE_STEPS.length - 1];
    const oneColumn = Math.floor(
      (backLayout(POSTCARD, 0).sources.height - SOURCE_HEADER) /
        (smallest * SOURCE_LINE_HEIGHT),
    );
    const full = backLayout(POSTCARD, oneColumn);
    expect(full.columns).toBe(1);
    expect(full.fontSize).toBe(smallest);

    const spilling = backLayout(POSTCARD, oneColumn + 1);
    expect(spilling.columns).toBe(2);
    expect(spilling.fontSize).toBe(smallest);
    expect(spilling.shown).toBe(oneColumn + 1);
    expect(spilling.more).toBe(0);
  });

  it("folds what cannot fit into a closing line of its own", () => {
    const capacity = backLayout(POSTCARD, 0);
    const smallest = SOURCE_TYPE_STEPS[SOURCE_TYPE_STEPS.length - 1];
    const rows = Math.floor(
      (capacity.sources.height - SOURCE_HEADER) /
        (smallest * SOURCE_LINE_HEIGHT),
    );
    const exactlyFull = backLayout(POSTCARD, rows * 2);
    expect(exactlyFull.more).toBe(0);

    const over = backLayout(POSTCARD, rows * 2 + 5);
    expect(over.columns).toBe(2);
    expect(over.shown).toBe(rows * 2 - 1);
    expect(over.more).toBe(6);
  });

  it("refuses a count that is not a whole number of pages", () => {
    expect(() => backLayout(POSTCARD, -1)).toThrow();
    expect(() => backLayout(POSTCARD, 1.5)).toThrow();
  });
});

describe("the words on the back", () => {
  it("writes a source line as domain, page title, and when and how much", () => {
    const words = sourceLineWords(
      source(2, { pieceCount: 3, pageTitle: "  A long read  " }),
    );
    expect(words.domain).toBe("site2.test");
    expect(words.title).toBe("A long read");
    expect(words.seen).toBe(
      `first seen ${backDate(source(2).firstSeenAt)} · 3 pieces`,
    );
    expect(sourceLineWords(source(1)).seen.endsWith("1 piece")).toBe(true);
  });

  it("dates the collage, counts its pieces, and names its format", () => {
    expect(backDetailLines(content([]))).toEqual([
      `made ${backDate(Date.UTC(2026, 2, 3, 12))}`,
      `changed ${backDate(Date.UTC(2026, 2, 9, 12))}`,
      "7 pieces",
      "postcard · 1500 × 1000",
    ]);
  });

  it("leaves out the changed date before a save or on the day it was made", () => {
    expect(
      backDetailLines(content([], { changedAt: null })).some((line) =>
        line.startsWith("changed"),
      ),
    ).toBe(false);
    const madeAt = Date.UTC(2026, 2, 3, 12);
    expect(
      backDetailLines(
        content([], { createdAt: madeAt, changedAt: madeAt + 60_000 }),
      ).some((line) => line.startsWith("changed")),
    ).toBe(false);
  });

  it("says how many more pages there are", () => {
    expect(morePagesLine(1)).toBe("and 1 more page");
    expect(morePagesLine(12)).toBe("and 12 more pages");
  });
});

describe("backInk", () => {
  it("writes in the page's ink on pale paper and a light ink on dark paper", () => {
    expect(backInk("#fffdf9").ink).toBe("#3d3833");
    expect(backInk("#fffdf9").muted).toBe("#827a72");
    expect(backInk("#c9a678").ink).toBe("#3d3833");
    expect(backInk("#2b2724").ink).not.toBe("#3d3833");
    expect(backInk("#2b2724").bleedBlend).toBe("screen");
    expect(backInk("#fffdf9").bleedBlend).toBe("multiply");
  });

  it("refuses a paper that is not a hex color", () => {
    expect(() => backInk("linen")).toThrow();
  });
});

describe("collageBackMarkup", () => {
  const noFavicons = new Map<string, BackFavicon>();

  function parse(markup: string): Document {
    const document = new DOMParser().parseFromString(
      `<root xmlns="http://www.w3.org/1999/xhtml">${markup}</root>`,
      "application/xml",
    );
    expect(document.querySelector("parsererror")).toBeNull();
    return document;
  }

  it("writes one line per source page, in order, and no links", () => {
    const sources = [source(1), source(2, { pieceCount: 4 }), source(3)];
    const markup = collageBackMarkup({
      frame: POSTCARD,
      content: content(sources),
      paper: PALE,
      bleed: null,
      markIcon: MARK,
      favicons: noFavicons,
    });
    const document = parse(markup);
    const lines = [...document.querySelectorAll(".collage-back__source")];
    expect(lines).toHaveLength(3);
    lines.forEach((line, index) => {
      expect(line.querySelector(".collage-back__domain")?.textContent).toBe(
        sources[index].domain,
      );
      expect(line.querySelector(".collage-back__page")?.textContent).toBe(
        sources[index].pageTitle,
      );
    });
    expect(document.querySelectorAll("a")).toHaveLength(0);
    expect(markup).not.toMatch(/href=/);
  });

  it("escapes page text so stored titles cannot become markup", () => {
    const markup = collageBackMarkup({
      frame: POSTCARD,
      content: content(
        [source(1, { pageTitle: `<img src=x onerror="alert(1)"> & "more"` })],
        { title: "<script>" },
      ),
      paper: PALE,
      bleed: null,
      markIcon: MARK,
      favicons: noFavicons,
    });
    const document = parse(markup);
    expect(document.querySelectorAll("script")).toHaveLength(0);
    expect(
      document.querySelectorAll(".collage-back__sources img, .collage-back__title *"),
    ).toHaveLength(0);
    expect(document.querySelector(".collage-back__page")?.textContent).toBe(
      `<img src=x onerror="alert(1)"> & "more"`,
    );
    expect(document.querySelector(".collage-back__title")?.textContent).toBe(
      "<script>",
    );
  });

  it("ends a list too long for the frame with how many more pages there are", () => {
    const sources = Array.from({ length: 150 }, (_, index) => source(index));
    const layout = backLayout(POSTCARD, sources.length);
    const document = parse(
      collageBackMarkup({
        frame: POSTCARD,
        content: content(sources),
        paper: PALE,
      bleed: null,
      markIcon: MARK,
        favicons: noFavicons,
      }),
    );
    expect(document.querySelectorAll(".collage-back__source")).toHaveLength(
      layout.shown,
    );
    expect(document.querySelector(".collage-back__more")?.textContent).toBe(
      morePagesLine(layout.more),
    );
  });

  it("draws a fetched favicon, an empty ring for a missing one, and a gap while one loads", () => {
    const sources = [source(1), source(2), source(3)];
    const favicons = new Map<string, BackFavicon>([
      [sources[0].pageUrl, { data: "data:image/png;base64,AAAA" }],
      [sources[1].pageUrl, "missing"],
    ]);
    const document = parse(
      collageBackMarkup({
        frame: POSTCARD,
        content: content(sources),
        paper: PALE,
      bleed: null,
      markIcon: MARK,
        favicons,
      }),
    );
    const marks = [...document.querySelectorAll(".collage-back__mark")];
    expect(marks[0].tagName.toLowerCase()).toBe("img");
    expect(marks[0].getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(marks[1].classList.contains("collage-back__mark--none")).toBe(true);
    expect(marks[2].tagName.toLowerCase()).toBe("span");
    expect(marks[2].classList.contains("collage-back__mark--none")).toBe(false);
  });

  it("lays the front through the paper mirrored and faint, and only when there is one", () => {
    const withFront = parse(
      collageBackMarkup({
        frame: POSTCARD,
        paper: PALE,
        content: content([source(1)]),
        favicons: noFavicons,
        bleed: "data:image/jpeg;base64,RlJPTlQ=",
        markIcon: MARK,
      }),
    );
    const bleed = withFront.querySelector(".collage-back__bleed");
    expect(bleed?.getAttribute("src")).toBe("data:image/jpeg;base64,RlJPTlQ=");
    const declared = bleed?.getAttribute("style") ?? "";
    expect(declared).toContain("scaleX(-1)");
    expect(declared).toContain("opacity:0.11");
    expect(declared).toContain("blur(");
    expect(declared).toContain("mix-blend-mode:multiply");

    const onDark = parse(
      collageBackMarkup({
        frame: POSTCARD,
        paper: { color: "#2b2724", grain: false },
        content: content([source(1)]),
        favicons: noFavicons,
        bleed: "data:image/jpeg;base64,RlJPTlQ=",
        markIcon: MARK,
      }),
    );
    expect(
      onDark.querySelector(".collage-back__bleed")?.getAttribute("style"),
    ).toContain("mix-blend-mode:screen");

    const withoutFront = parse(
      collageBackMarkup({
        frame: POSTCARD,
        paper: PALE,
        content: content([]),
        favicons: noFavicons,
        bleed: null,
        markIcon: MARK,
      }),
    );
    expect(withoutFront.querySelector(".collage-back__bleed")).toBeNull();
  });

  it("presses the maker's mark into the title side, each half faint on its own", () => {
    const document = parse(
      collageBackMarkup({
        frame: POSTCARD,
        paper: PALE,
        content: content([source(1)]),
        favicons: noFavicons,
        bleed: null,
        markIcon: MARK,
      }),
    );
    const maker = document.querySelector(
      ".collage-back__details .collage-back__maker",
    );
    expect(maker).not.toBeNull();
    const icon = maker?.querySelector("img");
    expect(icon?.getAttribute("src")).toBe(MARK);
    expect(icon?.getAttribute("style")).toContain("mix-blend-mode:multiply");
    expect(icon?.getAttribute("style")).toContain("opacity:0.55");
    const wordmark = maker?.querySelector(".collage-back__wordmark");
    expect(wordmark?.textContent).toBe("we were online");
    expect(wordmark?.getAttribute("style")).toContain("italic 200");
    expect(maker?.getAttribute("style") ?? "").not.toContain("opacity");
  });

  it("names an untitled collage as untitled", () => {
    const document = parse(
      collageBackMarkup({
        frame: TALL,
        content: content([], { title: "   " }),
        paper: PALE,
      bleed: null,
      markIcon: MARK,
        favicons: noFavicons,
      }),
    );
    expect(document.querySelector(".collage-back__title")?.textContent).toBe(
      "untitled collage",
    );
  });
});

describe("collageBackDocument", () => {
  it("wraps the writing in a data URL SVG that carries the font faces", () => {
    const url = collageBackDocument({
      frame: POSTCARD,
      markup: "<p>hello</p>",
      fontFaces: "@font-face{font-family:'Lora';src:url(data:font/woff2;base64,AA)}",
      pixelScale: 2,
    });
    expect(url.startsWith("data:image/svg+xml")).toBe(true);
    const svg = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.querySelector("style")?.textContent).toContain(
      "font-family:'Lora'",
    );
    expect(document.querySelector("foreignObject")?.getAttribute("width")).toBe(
      "1500",
    );
    // Drawn at the bake's pixel size, laid out in frame units.
    expect(document.documentElement.getAttribute("width")).toBe("3000");
    expect(document.documentElement.getAttribute("viewBox")).toBe(
      "0 0 1500 1000",
    );
  });
});
