// ABOUTME: Tests the shared-collage viewer's mapping: ids, fetch outcomes, lightbox items, labels and order.
// ABOUTME: Pure functions only; the page itself is exercised in a real browser.

import { describe, expect, it, vi } from "vitest";
import {
  SHARED_COLLAGE_FORMAT,
  SHARED_COLLAGE_VERSION,
  type SharedCollagePiece,
} from "../../../shared/sharedCollage";
import {
  faviconFor,
  fitScale,
  loadSharedCollage,
  pieceScrapItem,
  placementStyle,
  readingOrder,
  sharedCollageIdFrom,
  sharedImageUrl,
  sourceLabel,
} from "../sharedCollageView";

const ID = "AbCdEfGhIjKlMnOpQrStU_";

function piece(
  overrides: Partial<SharedCollagePiece> = {},
): SharedCollagePiece {
  return {
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 0,
    z: 0,
    crop: { x: 0, y: 0, width: 0.5, height: 1 },
    flipX: false,
    flipY: false,
    image: "img/0",
    source: {
      kind: "image",
      pageUrl: "https://example.com/full/path?x=1#frag",
      pageTitle: "  A Page Title ",
      domain: "example.com",
      ts: 1_760_000_000_000,
      alt: "a fern",
    },
    ...overrides,
  };
}

function collageJson(pieces = [piece()]) {
  return {
    format: SHARED_COLLAGE_FORMAT,
    version: SHARED_COLLAGE_VERSION,
    title: "t",
    frame: { width: 1500, height: 1000 },
    paper: { color: "#fffdf9", grain: true },
    pieces,
    sharedAt: 1,
  };
}

describe("sharedCollageIdFrom", () => {
  it("reads a well-formed id and ignores anything else", () => {
    expect(sharedCollageIdFrom(`?id=${ID}`)).toBe(ID);
    expect(sharedCollageIdFrom("?id=../../etc")).toBeNull();
    expect(sharedCollageIdFrom("")).toBeNull();
  });
});

describe("loadSharedCollage", () => {
  it("parses a collage, and tells a deleted one from a failure", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify(collageJson())));
    const loaded = await loadSharedCollage(
      "https://w",
      ID,
      ok as unknown as typeof fetch,
    );
    expect(loaded.kind).toBe("ok");
    expect(ok).toHaveBeenCalledWith(`https://w/collages/${ID}`);

    const gone = vi.fn(async () => new Response("{}", { status: 404 }));
    expect(
      await loadSharedCollage("https://w", ID, gone as unknown as typeof fetch),
    ).toEqual({
      kind: "missing",
    });

    const broken = vi.fn(
      async () => new Response(JSON.stringify({ format: "nope" })),
    );
    expect(
      (
        await loadSharedCollage(
          "https://w",
          ID,
          broken as unknown as typeof fetch,
        )
      ).kind,
    ).toBe("error");

    const down = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(
      (
        await loadSharedCollage(
          "https://w",
          ID,
          down as unknown as typeof fetch,
        )
      ).kind,
    ).toBe("error");
  });
});

describe("pieceScrapItem", () => {
  it("maps a piece onto the lightbox's image item with the full page URL", () => {
    const url = sharedImageUrl("https://w", ID, "img/0");
    expect(url).toBe(`https://w/collages/${ID}/img/0`);
    const item = pieceScrapItem(piece(), 3, url);
    expect(item).toMatchObject({
      id: "piece-3",
      key: "piece-3",
      kind: "image",
      src: url,
      alt: "a fern",
      pageUrl: "https://example.com/full/path?x=1#frag",
      domain: "example.com",
      ts: 1_760_000_000_000,
      // No recorded size: the uncropped source box stands in.
      naturalWidth: 400,
      naturalHeight: 100,
    });
  });

  it("prefers the recorded picture size and leaves out a missing page", () => {
    const item = pieceScrapItem(
      piece({
        source: {
          ...piece().source,
          pageUrl: "",
          naturalWidth: 640,
          naturalHeight: 480,
        },
      }),
      0,
      "u",
    );
    expect(item.pageUrl).toBe("");
    expect(
      item.kind === "image" && [item.naturalWidth, item.naturalHeight],
    ).toEqual([640, 480]);
  });
});

describe("labels", () => {
  it("names the site or the page", () => {
    expect(sourceLabel(piece(), "site")).toBe("example.com");
    expect(sourceLabel(piece(), "title")).toBe("A Page Title");
    expect(
      sourceLabel(
        piece({ source: { ...piece().source, pageTitle: " " } }),
        "title",
      ),
    ).toBe("example.com");
  });

  it("uses the scrap's favicon, else the favicon service", () => {
    expect(
      faviconFor(
        piece({
          source: { ...piece().source, faviconUrl: "https://e.com/f.ico" },
        }),
      ),
    ).toBe("https://e.com/f.ico");
    expect(faviconFor(piece())).toContain(
      "google.com/s2/favicons?domain=example.com",
    );
  });
});

describe("layout", () => {
  it("fits the frame into the space without enlarging it", () => {
    expect(
      fitScale({ width: 1500, height: 1000 }, { width: 750, height: 1000 }),
    ).toBe(0.5);
    expect(
      fitScale({ width: 1500, height: 1000 }, { width: 3000, height: 3000 }),
    ).toBe(1);
  });

  it("walks pieces in reading order", () => {
    const pieces = [
      piece({ x: 900, y: 50 }),
      piece({ x: 50, y: 700 }),
      piece({ x: 50, y: 60 }),
    ];
    expect(readingOrder(pieces, 1000)).toEqual([2, 0, 1]);
  });

  it("places a baked cutout inside its source box", () => {
    expect(
      placementStyle(
        piece({ placement: { x: 0.25, y: 0, width: 0.5, height: 1 } }),
      ),
    ).toEqual({
      left: "25%",
      top: "0%",
      width: "50%",
      height: "100%",
    });
    expect(placementStyle(piece()).width).toBe("100%");
  });
});
