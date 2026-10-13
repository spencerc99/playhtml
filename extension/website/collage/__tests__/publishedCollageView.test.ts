// ABOUTME: Tests the published-collage viewer's mapping: ids, fetch outcomes, studio pieces, labels and order.
// ABOUTME: Pure functions only; the page itself is exercised in a real browser.

import { describe, expect, it, vi } from "vitest";
import {
  PUBLISHED_COLLAGE_FORMAT,
  PUBLISHED_COLLAGE_VERSION,
  parsePublishedCollage,
  type PublishedCollagePiece,
} from "../../../shared/publishedCollage";
import {
  faviconFor,
  cropWithinPicture,
  fitScale,
  loadPublishedCollage,
  readingOrder,
  revealRanks,
  viewerPieces,
  publishedCollageIdFrom,
  publishedImageUrl,
} from "../publishedCollageView";

const ID = "AbCdEfGhIjKlMnOpQrStU_";

function piece(
  overrides: Partial<PublishedCollagePiece> = {},
): PublishedCollagePiece {
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
    format: PUBLISHED_COLLAGE_FORMAT,
    version: PUBLISHED_COLLAGE_VERSION,
    title: "t",
    frame: { width: 1500, height: 1000 },
    paper: { color: "#fffdf9", grain: true },
    pieces,
    sharedAt: 1,
  };
}

describe("publishedCollageIdFrom", () => {
  it("reads a well-formed id and ignores anything else", () => {
    expect(publishedCollageIdFrom(`?id=${ID}`)).toBe(ID);
    expect(publishedCollageIdFrom("?id=../../etc")).toBeNull();
    expect(publishedCollageIdFrom("")).toBeNull();
  });
});

describe("loadPublishedCollage", () => {
  it("parses a collage, and tells a deleted one from a failure", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify(collageJson())));
    const loaded = await loadPublishedCollage(
      "https://w",
      ID,
      ok as unknown as typeof fetch,
    );
    expect(loaded.kind).toBe("ok");
    expect(ok).toHaveBeenCalledWith(`https://w/collages/${ID}`);

    const gone = vi.fn(async () => new Response("{}", { status: 404 }));
    expect(
      await loadPublishedCollage(
        "https://w",
        ID,
        gone as unknown as typeof fetch,
      ),
    ).toEqual({
      kind: "missing",
    });

    const broken = vi.fn(
      async () => new Response(JSON.stringify({ format: "nope" })),
    );
    expect(
      (
        await loadPublishedCollage(
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
        await loadPublishedCollage(
          "https://w",
          ID,
          down as unknown as typeof fetch,
        )
      ).kind,
    ).toBe("error");
  });
});

describe("viewerPieces", () => {
  const imageUrl = (ref: string) => publishedImageUrl("https://w", ID, ref);

  it("draws a picture as an image filling its source, with the full page URL", () => {
    expect(imageUrl("img/0")).toBe(`https://w/collages/${ID}/img/0`);
    const collage = parsePublishedCollage(collageJson([piece(), piece()]));
    const [, shown] = viewerPieces(collage, imageUrl);
    expect(shown.piece).toMatchObject({
      id: "piece-1",
      x: 100,
      width: 200,
      crop: { x: 0, y: 0, width: 0.5, height: 1 },
    });
    expect(shown.item).toBe(shown.piece.scrap);
    expect(shown.item).toMatchObject({
      id: "piece-1",
      kind: "image",
      src: imageUrl("img/0"),
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
    const collage = parsePublishedCollage(
      collageJson([
        piece({
          source: {
            ...piece().source,
            pageUrl: "",
            naturalWidth: 640,
            naturalHeight: 480,
          },
        }),
      ]),
    );
    const [{ item }] = viewerPieces(collage, imageUrl);
    expect(item.pageUrl).toBe("");
    expect(
      item.kind === "image" && [item.naturalWidth, item.naturalHeight],
    ).toEqual([640, 480]);
  });

  it("names a cursor picture as a cursor in the lightbox", () => {
    const collage = parsePublishedCollage(
      collageJson([piece({ source: { ...piece().source, kind: "cursor" } })]),
    );
    const [{ piece: shown, item }] = viewerPieces(collage, imageUrl);
    expect(shown.scrap.kind).toBe("image");
    expect(item).toMatchObject({ kind: "cursor", url: imageUrl("img/0") });
  });

  it("sets content pieces from their words, keeping their own kind", () => {
    const collage = parsePublishedCollage(
      collageJson([
        piece({
          image: undefined,
          content: {
            kind: "heading",
            text: "the internet is a place",
            level: 1,
            styles: { fontFamily: "Georgia" },
          },
          source: { ...piece().source, kind: "heading" },
        }),
      ]),
    );
    const [{ piece: shown, item }] = viewerPieces(collage, imageUrl);
    expect(item).toBe(shown.scrap);
    expect(item).toMatchObject({
      kind: "heading",
      text: "the internet is a place",
      level: 1,
      styles: { fontFamily: "Georgia" },
    });
  });

  it("re-expresses a baked cutout's crop against its own picture", () => {
    const cut = piece({
      crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
      placement: { x: 0.25, y: 0, width: 0.5, height: 1 },
      cutout: true,
    });
    expect(cropWithinPicture(cut)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(cropWithinPicture(piece())).toEqual(piece().crop);
  });
});

describe("labels", () => {
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

  it("reveals pieces from the middle out, or from the edges in", () => {
    const frame = { width: 1000, height: 1000 };
    const pieces = [
      piece({ x: 0, y: 0, width: 100, height: 100 }),
      piece({ x: 450, y: 450, width: 100, height: 100 }),
      piece({ x: 300, y: 450, width: 100, height: 100 }),
    ];
    expect(revealRanks(pieces, frame)).toEqual([2, 0, 1]);
    expect(revealRanks(pieces, frame, "edges")).toEqual([0, 2, 1]);
  });
});
