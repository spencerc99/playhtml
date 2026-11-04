// ABOUTME: Tests the back of a collage: its sites, its words, its layout math, and its markup.
// ABOUTME: Guards that every site is accounted for, that nothing is cut off, and that nothing on it is a link.

import { describe, expect, it } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  BACK_COLUMN_MIN,
  BACK_LOOK,
  BACK_PIECE_STEPS,
  BACK_TITLE_LIMIT,
  BACK_TITLE_STEPS,
  backDate,
  backDetail,
  backInk,
  backLayout,
  backPageTitle,
  backPieceWidth,
  backSites,
  backTitleSize,
  collageBackDocument,
  collageBackMarkup,
  collectedRange,
  type BackFavicon,
  type BackThumbnail,
  type CollageBackContent,
} from "../entrypoints/scraps/collageBack";
import type { CollagePiece } from "../entrypoints/scraps/collageRecord";
import { COLLAGE_FORMATS } from "../entrypoints/scraps/collageFormats";

const POSTCARD = COLLAGE_FORMATS.postcard;
const TALL = COLLAGE_FORMATS["postcard-tall"];
const SQUARE = COLLAGE_FORMATS.square;
const WIDE = COLLAGE_FORMATS.wide;
const PALE = { color: "#fffdf9", grain: true };
const MARK = "data:image/png;base64,TUFSSw==";
const DAY = 24 * 60 * 60 * 1000;
const START = new Date(2026, 7, 17, 12).getTime();

let made = 0;
function piece(
  domain: string,
  overrides: { page?: string; ts?: number; width?: number; height?: number; favicon?: string } = {},
): CollagePiece {
  made += 1;
  const page = overrides.page ?? "a";
  return {
    id: `piece_${made}`,
    scrapId: `scrap_${made}`,
    scrap: {
      id: `scrap_${made}`,
      key: `image:${made}`,
      kind: "image",
      src: `https://${domain}/${made}.png`,
      naturalWidth: 100,
      naturalHeight: 80,
      pageTitle: `A page on ${domain}`,
      domain,
      pageUrl: `https://${domain}/${page}`,
      ts: overrides.ts ?? START,
      ...(overrides.favicon ? { faviconUrl: overrides.favicon } : {}),
    } as ScrapItem,
    x: 0,
    y: 0,
    width: overrides.width ?? 100,
    height: overrides.height ?? 80,
    rotation: 0,
    z: made,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
  };
}

function titled(domain: string, page: string, pageTitle: string, ts = START): CollagePiece {
  const made = piece(domain, { page, ts });
  return { ...made, scrap: { ...made.scrap, pageTitle } as ScrapItem };
}

/** A collage with the given number of pieces from each of a run of sites. */
function sitesOf(counts: number[]): CollagePiece[] {
  return counts.flatMap((count, index) =>
    Array.from({ length: count }, (_, n) =>
      piece(`site${index}.test`, { ts: START + index * DAY + n }),
    ),
  );
}

function content(
  pieces: CollagePiece[],
  overrides: Partial<CollageBackContent> = {},
): CollageBackContent {
  return {
    title: "a walk through march",
    createdAt: START + 30 * DAY,
    changedAt: START + 34 * DAY,
    pieces,
    shows: "pieces",
    ...overrides,
  };
}

describe("backSites", () => {
  it("gathers pieces by site and counts each site's pages", () => {
    const sites = backSites([
      piece("a.test", { page: "one" }),
      piece("a.test", { page: "two" }),
      piece("a.test", { page: "two" }),
      piece("b.test"),
    ]);
    expect(sites.map((site) => site.domain)).toEqual(["a.test", "b.test"]);
    expect(sites[0].pageCount).toBe(2);
    expect(sites[0].pieces).toHaveLength(3);
    expect(sites[1].pageCount).toBe(1);
  });

  it("leads with the sites that gave the most pieces, then the one seen first", () => {
    const sites = backSites([
      piece("early.test", { ts: START }),
      piece("busy.test", { ts: START + DAY }),
      piece("busy.test", { ts: START + DAY }),
      piece("late.test", { ts: START + 2 * DAY }),
    ]);
    expect(sites.map((site) => site.domain)).toEqual([
      "busy.test",
      "early.test",
      "late.test",
    ]);
  });

  it("keeps each piece's placed shape and orders a site's pieces as collected", () => {
    const later = piece("a.test", { ts: START + DAY, width: 300, height: 100 });
    const earlier = piece("a.test", { ts: START, width: 50, height: 100 });
    const [site] = backSites([later, earlier]);
    expect(site.pieces.map((each) => each.id)).toEqual([earlier.id, later.id]);
    expect(site.pieces.map((each) => each.aspect)).toEqual([0.5, 3]);
    expect(site.firstSeenAt).toBe(START);
  });

  it("marks a site with the first of its pages that stored a favicon", () => {
    const [site] = backSites([
      piece("a.test", { page: "bare", ts: START }),
      piece("a.test", { page: "marked", ts: START + 1, favicon: "https://a.test/icon.png" }),
    ]);
    expect(site.faviconPage).toBe("https://a.test/marked");
    const [bare] = backSites([piece("b.test", { page: "only" })]);
    expect(bare.faviconPage).toBe("https://b.test/only");
  });

  it("refuses a piece with no area", () => {
    expect(() => backSites([piece("a.test", { width: 0 })])).toThrow();
  });
});

describe("page titles on the back", () => {
  it("drops the site's own name from either end of a title", () => {
    expect(backPageTitle("rod stock | McMaster-Carr", "mcmaster.com")).toBe("rod stock");
    expect(backPageTitle("SerenityOS - Wikipedia", "en.wikipedia.org")).toBe("SerenityOS");
    expect(backPageTitle("Amazon.com : blue painters tape", "amazon.com")).toBe("blue painters tape");
    expect(backPageTitle("Home / X", "x.com")).toBe("Home");
  });

  it("leaves a title that only names the site empty", () => {
    expect(backPageTitle("Pinterest", "pinterest.com")).toBe("");
    expect(backPageTitle("1Shows", "1shows.org")).toBe("");
  });

  it("keeps titles that merely contain a short site name", () => {
    expect(backPageTitle("Linux on the desktop", "x.com")).toBe("Linux on the desktop");
    expect(backPageTitle("Ladybird funded : r/linux", "reddit.com")).toBe("Ladybird funded : r/linux");
    expect(
      backPageTitle("Thunderbird Is Thriving: Our 2022 Financial Report", "blog.thunderbird.net"),
    ).toBe("Thunderbird Is Thriving: Our 2022 Financial Report");
    expect(backPageTitle("Amazon.com", "amazon.com")).toBe("");
  });

  it("lists a site's pages once each, sharing a title counted together, untitled pages left out", () => {
    const [site] = backSites([
      titled("mcmaster.com", "a", "rod stock | McMaster-Carr"),
      titled("mcmaster.com", "b", "rod stock | McMaster-Carr", START + 1),
      titled("mcmaster.com", "c", "round head screws | McMaster-Carr", START + 2),
      titled("mcmaster.com", "d", "McMaster-Carr", START + 3),
    ]);
    expect(site.pageCount).toBe(4);
    expect(site.pages).toEqual([
      { title: "rod stock", pieceCount: 2 },
      { title: "round head screws", pieceCount: 1 },
    ]);
  });
});

describe("the words on the back", () => {
  it("writes dates as two-digit month, day and year", () => {
    expect(backDate(new Date(2026, 8, 9, 15).getTime())).toBe("09/09/26");
    expect(backDate(new Date(2031, 11, 25).getTime())).toBe("12/25/31");
  });

  it("gives the collected pieces one span, or one date when they share a day", () => {
    expect(collectedRange([])).toBeNull();
    expect(collectedRange([piece("a.test"), piece("b.test", { ts: START + 1000 })])).toBe(
      "08/17/26",
    );
    expect(collectedRange([piece("a.test"), piece("b.test", { ts: START + 3 * DAY })])).toBe(
      "08/17/26-08/20/26",
    );
  });

  it("says when it was made, changed and collected, and how much it holds", () => {
    const pieces = [
      piece("a.test", { page: "one" }),
      piece("a.test", { page: "two", ts: START + DAY }),
      piece("b.test", { ts: START + 2 * DAY }),
    ];
    expect(backDetail(content(pieces))).toBe(
      "made 09/16/26 · changed 09/20/26 · collected 08/17/26-08/19/26 · 3 pieces from 3 pages on 2 sites",
    );
  });

  it("leaves out the changed date before a save or on the day it was made", () => {
    expect(backDetail(content([piece("a.test")], { changedAt: null }))).not.toContain("changed");
    expect(
      backDetail(content([piece("a.test")], { changedAt: START + 30 * DAY + 1000 })),
    ).not.toContain("changed");
  });

  it("says when nothing has been placed yet", () => {
    expect(backDetail(content([], { changedAt: null }))).toBe(
      "made 09/16/26 · nothing placed yet",
    );
  });

  it("steps a long title down in size rather than cutting it", () => {
    expect(backTitleSize("construction")).toBe(40);
    expect(backTitleSize("x".repeat(45))).toBe(32);
    expect(backTitleSize("x".repeat(90))).toBe(26);
  });
});

describe("backLayout", () => {
  const detail = "made 09/16/26 · collected 08/17/26-08/20/26 · 35 pieces from 16 pages on 9 sites";

  it("splits each format into as many columns of the minimum width as fit", () => {
    const sites = backSites(sitesOf([3, 2]));
    expect(backLayout(POSTCARD, "t", detail, sites, "pieces").columns).toBe(3);
    expect(backLayout(WIDE, "t", detail, sites, "pieces").columns).toBe(3);
    expect(backLayout(SQUARE, "t", detail, sites, "pieces").columns).toBe(2);
    expect(backLayout(TALL, "t", detail, sites, "pieces").columns).toBe(2);
    for (const format of [POSTCARD, WIDE, SQUARE, TALL]) {
      expect(backLayout(format, "t", detail, sites, "pieces").columnWidth).toBeGreaterThanOrEqual(
        BACK_COLUMN_MIN,
      );
    }
  });

  it("shows a small collage's pieces at the largest size", () => {
    const layout = backLayout(TALL, "t", detail, backSites(sitesOf([2, 1])), "pieces");
    expect(layout.itemSize).toBe(BACK_PIECE_STEPS[0]);
    expect(layout.rest).toHaveLength(0);
    expect(layout.rows.every((row) => row.kept === row.site.pieces.length)).toBe(true);
  });

  it("shows pieces smaller as the collage grows, never larger", () => {
    let previous: number = BACK_PIECE_STEPS[0];
    for (const sites of [2, 6, 12, 20, 30]) {
      const layout = backLayout(
        POSTCARD,
        "t",
        detail,
        backSites(sitesOf(Array.from({ length: sites }, () => 3))),
        "pieces",
      );
      expect(layout.itemSize).toBeLessThanOrEqual(previous);
      previous = layout.itemSize;
    }
  });

  it("caps a site's pieces and counts the rest, rather than letting a row run on", () => {
    const layout = backLayout(POSTCARD, "t", detail, backSites(sitesOf([60])), "pieces");
    const [row] = layout.rows;
    expect(row.kept).toBeGreaterThan(0);
    expect(row.kept).toBeLessThan(60);
  });

  it("accounts for every site, naming the ones without a row in the strip", () => {
    const sites = backSites(sitesOf(Array.from({ length: 80 }, () => 2)));
    const layout = backLayout(WIDE, "t", detail, sites, "pieces");
    expect(layout.rows.length + layout.rest.length).toBe(80);
    expect(layout.rest.length).toBeGreaterThan(0);
    expect(layout.itemSize).toBe(BACK_PIECE_STEPS[BACK_PIECE_STEPS.length - 1]);
    // The strip lists the rest in the same order: most pieces first.
    expect([...layout.rows.map((row) => row.site), ...layout.rest]).toEqual(sites);
  });

  it("drops the names from the strip once naming every site would run long", () => {
    const few = backLayout(WIDE, "t", detail, backSites(sitesOf(Array.from({ length: 24 }, () => 2))), "pieces");
    const many = backLayout(WIDE, "t", detail, backSites(sitesOf(Array.from({ length: 200 }, () => 1))), "pieces");
    expect(many.rest.length).toBeGreaterThan(few.rest.length);
    expect(many.restNamed).toBe(false);
  });

  it("gives a long title less room for the list", () => {
    const sites = backSites(sitesOf(Array.from({ length: 30 }, () => 2)));
    const short = backLayout(WIDE, "shed", detail, sites, "pieces");
    const long = backLayout(WIDE, "everything from the week we started building the shed, plus a few buttons i liked", detail, sites, "pieces");
    expect(long.rows.length).toBeLessThanOrEqual(short.rows.length);
  });

  it("writes titles at the larger size when they fit, and caps how many each site lists", () => {
    const pieces = Array.from({ length: 6 }, (_, n) =>
      titled("shop.test", `p${n}`, `product number ${n}`, START + n),
    );
    const layout = backLayout(POSTCARD, "t", detail, backSites(pieces), "titles");
    expect(layout.itemSize).toBe(BACK_TITLE_STEPS[0]);
    expect(layout.rows[0].kept).toBe(BACK_TITLE_LIMIT);
  });

  it("accounts for every site when titles overflow too", () => {
    const pieces = Array.from({ length: 90 }, (_, n) =>
      titled(`site${n}.test`, "a", `a fairly long page title about thing number ${n}`, START + n),
    );
    const layout = backLayout(WIDE, "t", detail, backSites(pieces), "titles");
    expect(layout.rows.length + layout.rest.length).toBe(90);
    expect(layout.rest.length).toBeGreaterThan(0);
  });

  it("never draws a piece wider than its column", () => {
    expect(backPieceWidth(96, 10, 352)).toBe(352);
    expect(backPieceWidth(48, 1.5, 352)).toBe(72);
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
  const noThumbnails = new Map<string, BackThumbnail>();

  function parse(markup: string): Document {
    const document = new DOMParser().parseFromString(
      `<root xmlns="http://www.w3.org/1999/xhtml">${markup}</root>`,
      "application/xml",
    );
    expect(document.querySelector("parsererror")).toBeNull();
    return document;
  }

  function markup(
    pieces: CollagePiece[],
    overrides: Partial<Parameters<typeof collageBackMarkup>[0]> = {},
  ): string {
    return collageBackMarkup({
      frame: POSTCARD,
      content: content(pieces),
      paper: PALE,
      bleed: null,
      markIcon: MARK,
      look: BACK_LOOK,
      favicons: noFavicons,
      thumbnails: noThumbnails,
      ...overrides,
    });
  }

  it("writes one row per site, most pieces first, and no links", () => {
    const html = markup([piece("one.test"), piece("two.test"), piece("two.test")]);
    const document = parse(html);
    const domains = [...document.querySelectorAll(".collage-back__site .collage-back__domain")].map(
      (node) => node.textContent?.replace(/​/g, ""),
    );
    expect(domains).toEqual(["two.test", "one.test"]);
    expect(document.querySelector(".collage-back__seen")?.textContent).toBe(
      "08/17/26 · 1 page · 2 pieces",
    );
    expect(document.querySelectorAll("a")).toHaveLength(0);
    expect(html).not.toMatch(/href=/);
  });

  it("lets a long domain wrap only at its dots", () => {
    const document = parse(markup([piece("blog.thunderbird.net")]));
    expect(document.querySelector(".collage-back__domain")?.textContent).toBe(
      "blog.​thunderbird.​net",
    );
  });

  it("escapes stored text so it cannot become markup", () => {
    const document = parse(
      markup([piece(`<img src=x onerror="alert(1)">.test`)], {
        content: content([piece(`<b>"&".test`)], { title: "<script>" }),
      }),
    );
    expect(document.querySelectorAll("script, b")).toHaveLength(0);
    expect(document.querySelector(".collage-back__title")?.textContent).toBe("<script>");
    expect(document.querySelector(".collage-back__domain")?.textContent).toContain(`<b>"&"`);
  });

  it("draws each piece once drawn, an outline when it would not load, and a faint box while it draws", () => {
    const pieces = [piece("a.test"), piece("a.test"), piece("a.test")];
    const document = parse(
      markup(pieces, {
        thumbnails: new Map<string, BackThumbnail>([
          [pieces[0].id, { data: "data:image/webp;base64,AAAA" }],
          [pieces[1].id, "missing"],
        ]),
      }),
    );
    const shown = [...document.querySelectorAll(".collage-back__piece")];
    expect(shown).toHaveLength(3);
    expect(shown[0].tagName.toLowerCase()).toBe("img");
    expect(shown[0].getAttribute("src")).toBe("data:image/webp;base64,AAAA");
    expect(shown[1].classList.contains("collage-back__piece--missing")).toBe(true);
    expect(shown[2].classList.contains("collage-back__piece--pending")).toBe(true);
  });

  it("counts the pieces a site has no room to show", () => {
    const document = parse(markup(sitesOf([60])));
    const shown = document.querySelectorAll(".collage-back__piece").length;
    expect(shown).toBeLessThan(60);
    expect(document.querySelector(".collage-back__extra")?.textContent).toBe(`+${60 - shown}`);
  });

  it("names the sites without a row of their own under the list", () => {
    const pieces = sitesOf(Array.from({ length: 80 }, () => 2));
    const layout = backLayout(
      WIDE,
      "a walk through march",
      backDetail(content(pieces)),
      backSites(pieces),
      "pieces",
    );
    const document = parse(markup(pieces, { frame: WIDE }));
    expect(document.querySelectorAll(".collage-back__site")).toHaveLength(layout.rows.length);
    const strip = document.querySelector(".collage-back__rest");
    expect(strip?.textContent).toContain(`also from ${layout.rest.length} sites`);
    expect(strip?.querySelectorAll(".collage-back__also")).toHaveLength(layout.rest.length);
  });

  it("lists page titles with their piece counts instead of pieces when asked", () => {
    const pieces = [
      ...Array.from({ length: 5 }, (_, n) =>
        titled("mcmaster.com", `p${n}`, `part ${n} | McMaster-Carr`, START + n),
      ),
      titled("pinterest.com", "board", "Pinterest", START + 10),
    ];
    const document = parse(markup(pieces, { content: content(pieces, { shows: "titles" }) }));
    expect(document.querySelectorAll(".collage-back__piece")).toHaveLength(0);
    const titles = [...document.querySelectorAll(".collage-back__page")].map((node) => node.textContent);
    expect(titles).toEqual(["part 0 \u00b7 1", "part 1 \u00b7 1", "part 2 \u00b7 1"]);
    expect(document.querySelector(".collage-back__extra")?.textContent).toBe("+2 more pages");
    // A site whose only title is its own name lists nothing under it.
    const sites = [...document.querySelectorAll(".collage-back__site")];
    expect(sites[1].querySelector(".collage-back__pages")).toBeNull();
  });

  it("escapes page titles", () => {
    const pieces = [titled("a.test", "x", `<img src=x onerror="alert(1)">`)];
    const document = parse(markup(pieces, { content: content(pieces, { shows: "titles" }) }));
    expect(document.querySelectorAll(".collage-back__page img")).toHaveLength(0);
    expect(document.querySelector(".collage-back__page")?.textContent).toContain(`<img src=x`);
  });

  it("leaves the strip out when every site has a row", () => {
    expect(parse(markup([piece("a.test")])).querySelector(".collage-back__rest")).toBeNull();
  });

  it("draws a fetched favicon, an empty ring for a missing one, and a gap while one loads", () => {
    const pieces = [
      piece("one.test", { ts: START }),
      piece("two.test", { ts: START + 1 }),
      piece("three.test", { ts: START + 2 }),
    ];
    const document = parse(
      markup(pieces, {
        favicons: new Map<string, BackFavicon>([
          [pieces[0].scrap.pageUrl, { data: "data:image/png;base64,AAAA" }],
          [pieces[1].scrap.pageUrl, "missing"],
        ]),
      }),
    );
    const marks = [...document.querySelectorAll(".collage-back__site .collage-back__favicon")];
    expect(marks[0].tagName.toLowerCase()).toBe("img");
    expect(marks[0].getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(marks[1].classList.contains("collage-back__favicon--none")).toBe(true);
    expect(marks[2].tagName.toLowerCase()).toBe("span");
    expect(marks[2].classList.contains("collage-back__favicon--none")).toBe(false);
  });

  it("lays the front through the paper mirrored and faint, and only when there is one", () => {
    const withFront = parse(markup([piece("a.test")], { bleed: "data:image/jpeg;base64,RlJPTlQ=" }));
    const bleed = withFront.querySelector(".collage-back__bleed");
    expect(bleed?.getAttribute("src")).toBe("data:image/jpeg;base64,RlJPTlQ=");
    const declared = bleed?.getAttribute("style") ?? "";
    expect(declared).toContain("scaleX(-1)");
    expect(declared).toContain(`opacity:${BACK_LOOK.bleedOpacity}`);
    expect(declared).toContain("blur(");
    expect(declared).toContain("mix-blend-mode:multiply");

    const onDark = parse(
      markup([piece("a.test")], {
        paper: { color: "#2b2724", grain: false },
        bleed: "data:image/jpeg;base64,RlJPTlQ=",
      }),
    );
    // The paper color stays on the front; the back is always the plain card.
    expect(onDark.querySelector(".collage-back__bleed")?.getAttribute("style")).toContain(
      "mix-blend-mode:multiply",
    );
    expect(onDark.querySelector(".collage-back__paper")?.getAttribute("style")).toContain(
      BACK_LOOK.cardColor,
    );

    expect(parse(markup([])).querySelector(".collage-back__bleed")).toBeNull();
  });

  it("presses the maker's mark into the paper, each half faint on its own", () => {
    const document = parse(markup([piece("a.test")]));
    const maker = document.querySelector(".collage-back__maker");
    expect(maker).not.toBeNull();
    const icon = maker?.querySelector("img");
    expect(icon?.getAttribute("src")).toBe(MARK);
    expect(icon?.getAttribute("style")).toContain("mix-blend-mode:multiply");
    expect(icon?.getAttribute("style")).toContain(`opacity:${BACK_LOOK.markOpacity}`);
    const wordmark = maker?.querySelector(".collage-back__wordmark");
    expect(wordmark?.textContent).toBe("we were online");
    expect(wordmark?.getAttribute("style")).toContain("italic 200");
    expect(maker?.getAttribute("style") ?? "").not.toContain("opacity");
  });

  it("names an untitled collage as untitled", () => {
    const document = parse(
      markup([], { frame: TALL, content: content([], { title: "   " }) }),
    );
    expect(document.querySelector(".collage-back__title")?.textContent).toBe(
      "untitled collage",
    );
  });

  it("never cuts its words off with an ellipsis", () => {
    const html = markup(sitesOf(Array.from({ length: 40 }, () => 3)));
    expect(html).not.toContain("ellipsis");
    expect(html).not.toContain("…");
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
