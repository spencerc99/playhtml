// ABOUTME: Tests turning a studio collage into a shared collage, the upload/delete contract, and the stored share.
// ABOUTME: Pictures come from a stub resolver, so these run without canvases or the network.

import { describe, expect, it, vi } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  CollagePublishError,
  buildPublishedCollage,
  deletePublishedCollage,
  publishedSource,
  publishFormData,
  uploadPublishedCollage,
  type PublishedPieceMaterial,
} from "../entrypoints/scraps/publishCollage";
import {
  duplicateCollage,
  parseCollageRecord,
  type CollagePiece,
  type CollageRecord,
} from "../entrypoints/scraps/collageRecord";
import {
  encodeCollageFile,
  readCollageFile,
} from "../entrypoints/scraps/collageFile";
import {
  PUBLISHED_COLLAGE_LIMITS,
  parsePublishedCollage,
} from "../../shared/publishedCollage";

function scrap(overrides: Partial<ScrapItem> = {}): ScrapItem {
  return {
    id: "scrap_1",
    key: "image:one",
    kind: "image",
    src: "https://example.test/one.png",
    naturalWidth: 100,
    naturalHeight: 80,
    pageTitle: "A page",
    domain: "example.test",
    pageUrl: "https://example.test/a?b=1",
    faviconUrl: "https://example.test/favicon.ico",
    ts: 1_000,
    position: { pageX: 1, pageY: 2, pageWidth: 3, pageHeight: 4 },
    ...overrides,
  } as ScrapItem;
}

function piece(overrides: Partial<CollagePiece> = {}): CollagePiece {
  return {
    id: "piece_1",
    scrapId: "scrap_1",
    scrap: scrap(),
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    rotation: 3,
    z: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
    ...overrides,
  };
}

function record(pieces: CollagePiece[]): CollageRecord {
  return {
    id: "collage_1",
    title: "  a collage  ",
    createdAt: 1,
    updatedAt: 2,
    frame: { width: 1500, height: 1000 },
    format: "postcard",
    paper: { color: "#fffdf9", grain: true },
    pieces,
    preview: { drawn: false, reason: "not yet" },
  };
}

const blob = (size = 4) =>
  new Blob([new Uint8Array(size)], { type: "image/png" });

function resolver(overrides: Partial<PublishedPieceMaterial> = {}) {
  return vi.fn(
    async (p: CollagePiece): Promise<PublishedPieceMaterial> => ({
      key:
        p.scrap.kind === "image" && !p.cutout
          ? `src:${p.scrap.src}`
          : `piece:${p.id}`,
      blob: blob(),
      ...overrides,
    }),
  );
}

describe("buildPublishedCollage", () => {
  it("keeps geometry, orders by stack, and dedupes shared pictures", async () => {
    const pieces = [
      piece({
        id: "top",
        z: 5,
        flipX: true,
        crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
      }),
      piece({ id: "bottom", z: 1 }),
      piece({
        id: "words",
        z: 3,
        scrap: scrap({
          kind: "button",
          text: "Buy now",
          styles: {},
        } as Partial<ScrapItem>),
      }),
    ];
    const materialFor = resolver();
    const built = await buildPublishedCollage(record(pieces), materialFor);
    expect(() => parsePublishedCollage(built.collage)).not.toThrow();
    expect(built.collage.title).toBe("a collage");
    expect(built.collage.createdAt).toBe(1);
    expect(built.collage.pieces.map((p) => p.z)).toEqual([0, 1, 2]);
    // The two uncut images share one source, so they upload one picture, and
    // the button travels as its words rather than as a picture.
    expect(built.images).toHaveLength(1);
    expect(materialFor).toHaveBeenCalledTimes(2);
    expect(built.collage.pieces.map((p) => p.image)).toEqual([
      "img/0",
      undefined,
      "img/0",
    ]);
    expect(built.collage.pieces[1].content).toEqual({
      kind: "button",
      text: "Buy now",
      styles: {},
    });
    const top = built.collage.pieces[2];
    expect(top).toMatchObject({
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      rotation: 3,
      flipX: true,
    });
    expect(top.crop).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.5 });
    expect(built.collage.pieces[1].source).toMatchObject({
      kind: "button",
      alt: "Buy now",
    });
  });

  it("publishes buttons, headings and icons as their captured markup", async () => {
    const pieces = [
      piece({
        id: "button",
        z: 0,
        scrap: scrap({
          kind: "button",
          text: "Subscribe",
          styles: {
            backgroundColor: "rgb(0, 0, 255)",
            backgroundImage: "url(https://tracker.example/pixel.png)",
            position: "fixed",
            fontSize: "16px",
          },
          innerSvg: '<svg viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>',
          backdropColor: "rgb(255, 255, 255)",
        } as Partial<ScrapItem>),
      }),
      piece({
        id: "heading",
        z: 1,
        scrap: scrap({
          kind: "heading",
          text: "the internet is a place",
          level: 2,
          styles: { fontFamily: "Georgia", lineHeight: "1.2" },
        } as Partial<ScrapItem>),
      }),
      piece({
        id: "icon",
        z: 2,
        scrap: scrap({
          kind: "svg-icon",
          markup: '<svg viewBox="0 0 2 2"><circle r="1"/></svg>',
          width: 24,
          height: 24,
        } as Partial<ScrapItem>),
      }),
    ];
    const materialFor = resolver();
    const built = await buildPublishedCollage(
      { ...record(pieces), backShows: "titles" },
      materialFor,
    );
    expect(materialFor).not.toHaveBeenCalled();
    expect(built.images).toEqual([]);
    expect(built.collage.backShows).toBe("titles");
    const [button, heading, icon] = built.collage.pieces;
    // Only captured properties with values that cannot fetch are kept.
    expect(button.content).toEqual({
      kind: "button",
      text: "Subscribe",
      styles: { backgroundColor: "rgb(0, 0, 255)", fontSize: "16px" },
      innerSvg: '<svg viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>',
      backdropColor: "rgb(255, 255, 255)",
    });
    expect(heading.content).toEqual({
      kind: "heading",
      text: "the internet is a place",
      level: 2,
      styles: { fontFamily: "Georgia", lineHeight: "1.2" },
    });
    expect(icon.content).toMatchObject({ kind: "svg-icon", width: 24 });
    expect(icon.source.kind).toBe("svg-icon");
    expect(() => parsePublishedCollage(built.collage)).not.toThrow();
  });

  it("refuses a piece whose markup is over the per-piece limit", async () => {
    const huge = `<svg>${"<g/>".repeat(PUBLISHED_COLLAGE_LIMITS.maxContentBytes / 4)}</svg>`;
    await expect(
      buildPublishedCollage(
        record([
          piece({
            scrap: scrap({
              kind: "svg-icon",
              markup: huge,
              width: 1,
              height: 1,
            } as Partial<ScrapItem>),
          }),
        ]),
        resolver(),
      ),
    ).rejects.toThrow(/too large to publish/);
  });

  it("carries a baked cutout's placement and marks it", async () => {
    const placement = { x: 0.25, y: 0, width: 0.5, height: 1 };
    const built = await buildPublishedCollage(
      record([
        piece({
          cutout: { method: "edge-color", tolerance: 0.1 },
        } as Partial<CollagePiece>),
      ]),
      resolver({ placement, cutout: true }),
    );
    expect(built.collage.pieces[0].placement).toEqual(placement);
    expect(built.collage.pieces[0].cutout).toBe(true);
  });

  it("refuses an empty collage, and pictures over the limits", async () => {
    await expect(buildPublishedCollage(record([]), resolver())).rejects.toThrow(
      CollagePublishError,
    );
    await expect(
      buildPublishedCollage(
        record([piece()]),
        resolver({ blob: blob(PUBLISHED_COLLAGE_LIMITS.maxImageBytes + 1) }),
      ),
    ).rejects.toThrow(/over the 5 MB/);
    const many = Array.from({ length: 9 }, (_, i) =>
      piece({
        id: `p${i}`,
        z: i,
        scrap: scrap({
          src: `https://example.test/${i}.png`,
        } as Partial<ScrapItem>),
      }),
    );
    await expect(
      buildPublishedCollage(
        record(many),
        resolver({ blob: blob(PUBLISHED_COLLAGE_LIMITS.maxImageBytes - 1) }),
      ),
    ).rejects.toThrow(/40 MB/);
  });

  it("names the piece whose picture could not be read", async () => {
    const failing = vi.fn(async () => {
      throw new Error("fetch returned 404");
    });
    await expect(
      buildPublishedCollage(record([piece()]), failing),
    ).rejects.toThrow(
      "a piece from example.test could not be read: fetch returned 404",
    );
  });
});

describe("publishedSource", () => {
  it("keeps only what the shared page shows, and only web addresses", () => {
    const source = publishedSource(
      scrap({
        pageUrl: "javascript:alert(1)",
        faviconUrl: "data:image/png;base64,AA",
      }),
    );
    expect(source).toEqual({
      kind: "image",
      pageUrl: "",
      pageTitle: "A page",
      domain: "example.test",
      ts: 1_000,
      naturalWidth: 100,
      naturalHeight: 80,
    });
    expect(source).not.toHaveProperty("position");
  });

  it("clips an overlong page title", () => {
    const source = publishedSource(scrap({ pageTitle: "t".repeat(900) }));
    expect(source.pageTitle).toHaveLength(
      PUBLISHED_COLLAGE_LIMITS.maxPageTitleLength,
    );
  });
});

describe("upload and take-down", () => {
  it("posts the collage and its pictures as multipart and keeps the token", async () => {
    const built = await buildPublishedCollage(record([piece()]), resolver());
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "AbCdEfGhIjKlMnOpQrStU_",
            deleteToken: "tok",
            url: "https://wewere.online/collage/?id=AbCdEfGhIjKlMnOpQrStU_",
          }),
          { status: 201 },
        ),
    );
    const share = await uploadPublishedCollage(
      "https://worker.example",
      built,
      () => 42,
      fetcher as unknown as typeof fetch,
    );
    expect(share).toEqual({
      id: "AbCdEfGhIjKlMnOpQrStU_",
      deleteToken: "tok",
      url: "https://wewere.online/collage/?id=AbCdEfGhIjKlMnOpQrStU_",
      sharedAt: 42,
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://worker.example/collages");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(JSON.parse(form.get("collage") as string).pieces).toHaveLength(1);
    expect(form.get("img/0")).toBeInstanceOf(Blob);
  });

  it("says what the server refused", async () => {
    const built = await buildPublishedCollage(record([piece()]), resolver());
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Too many" }), { status: 429 }),
    );
    await expect(
      uploadPublishedCollage(
        "https://w",
        built,
        Date.now,
        fetcher as unknown as typeof fetch,
      ),
    ).rejects.toThrow("Too many");
  });

  it("deletes with the token and treats an already-gone link as gone", async () => {
    for (const status of [204, 404]) {
      const fetcher = vi.fn(async () => new Response(null, { status }));
      await deletePublishedCollage(
        "https://w",
        { id: "abc", deleteToken: "tok" },
        fetcher as unknown as typeof fetch,
      );
      const [url, init] = fetcher.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe("https://w/collages/abc");
      expect(init.headers).toEqual({ Authorization: "Bearer tok" });
    }
    const refused = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "nope" }), { status: 403 }),
    );
    await expect(
      deletePublishedCollage(
        "https://w",
        { id: "abc", deleteToken: "x" },
        refused as unknown as typeof fetch,
      ),
    ).rejects.toThrow("nope");
  });

  it("builds a form with one part per picture", async () => {
    const form = publishFormData({
      collage: (await buildPublishedCollage(record([piece()]), resolver()))
        .collage,
      images: [blob(), blob()],
    });
    expect([...form.keys()]).toEqual(["collage", "img/0", "img/1"]);
  });

  it("sends the cover when one was drawn, and shares without one that failed", async () => {
    const withCover = await buildPublishedCollage(
      record([piece()]),
      resolver(),
      async () => new Blob([new Uint8Array(8)], { type: "image/jpeg" }),
    );
    expect([...publishFormData(withCover).keys()]).toContain("cover");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = await buildPublishedCollage(
      record([piece()]),
      resolver(),
      async () => {
        throw new Error("tainted canvas");
      },
    );
    warn.mockRestore();
    expect(failed.cover).toBeUndefined();
    expect([...publishFormData(failed).keys()]).not.toContain("cover");
  });
});

describe("the stored share", () => {
  const share = {
    id: "AbCdEfGhIjKlMnOpQrStU_",
    deleteToken: "tok",
    sharedAt: 5,
    url: "https://wewere.online/collage/?id=x",
  };

  it("round-trips on the collage record", () => {
    const parsed = parseCollageRecord({
      ...record([piece()]),
      publication: share,
    });
    expect(parsed.publication).toEqual(share);
    expect(() =>
      parseCollageRecord({ ...record([piece()]), publication: { id: "x" } }),
    ).toThrow();
  });

  it("is never copied into a duplicate or a collage file", async () => {
    const shared = { ...record([piece()]), publication: share };
    expect(duplicateCollage(shared).publication).toBeUndefined();
    const file = await encodeCollageFile(shared);
    expect(file).not.toContain("tok");
    expect(readCollageFile(file).publication).toBeUndefined();
  });
});
