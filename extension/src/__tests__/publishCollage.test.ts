// ABOUTME: Tests turning a studio collage into a shared collage, the upload/delete contract, and the stored share.
// ABOUTME: Pictures come from a stub resolver, so these run without canvases or the network.

import { describe, expect, it, vi } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  CollageShareError,
  buildSharedCollage,
  deleteSharedCollage,
  sharedSource,
  shareFormData,
  uploadSharedCollage,
  type SharedPieceMaterial,
} from "../entrypoints/scraps/shareCollage";
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
  SHARED_COLLAGE_LIMITS,
  parseSharedCollage,
} from "../../shared/sharedCollage";

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

function resolver(overrides: Partial<SharedPieceMaterial> = {}) {
  return vi.fn(
    async (p: CollagePiece): Promise<SharedPieceMaterial> => ({
      key:
        p.scrap.kind === "image" && !p.cutout
          ? `src:${p.scrap.src}`
          : `piece:${p.id}`,
      blob: blob(),
      ...overrides,
    }),
  );
}

describe("buildSharedCollage", () => {
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
    const built = await buildSharedCollage(record(pieces), resolver());
    expect(() => parseSharedCollage(built.collage)).not.toThrow();
    expect(built.collage.title).toBe("a collage");
    expect(built.collage.pieces.map((p) => p.z)).toEqual([0, 1, 2]);
    // The two uncut images share one source, so they upload one picture.
    expect(built.images).toHaveLength(2);
    expect(built.collage.pieces.map((p) => p.image)).toEqual([
      "img/0",
      "img/1",
      "img/0",
    ]);
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

  it("carries a baked cutout's placement and marks it", async () => {
    const placement = { x: 0.25, y: 0, width: 0.5, height: 1 };
    const built = await buildSharedCollage(
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
    await expect(buildSharedCollage(record([]), resolver())).rejects.toThrow(
      CollageShareError,
    );
    await expect(
      buildSharedCollage(
        record([piece()]),
        resolver({ blob: blob(SHARED_COLLAGE_LIMITS.maxImageBytes + 1) }),
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
      buildSharedCollage(
        record(many),
        resolver({ blob: blob(SHARED_COLLAGE_LIMITS.maxImageBytes - 1) }),
      ),
    ).rejects.toThrow(/40 MB/);
  });

  it("names the piece whose picture could not be read", async () => {
    const failing = vi.fn(async () => {
      throw new Error("fetch returned 404");
    });
    await expect(
      buildSharedCollage(record([piece()]), failing),
    ).rejects.toThrow(
      "a piece from example.test could not be read: fetch returned 404",
    );
  });
});

describe("sharedSource", () => {
  it("keeps only what the shared page shows, and only web addresses", () => {
    const source = sharedSource(
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
    const source = sharedSource(scrap({ pageTitle: "t".repeat(900) }));
    expect(source.pageTitle).toHaveLength(
      SHARED_COLLAGE_LIMITS.maxPageTitleLength,
    );
  });
});

describe("upload and take-down", () => {
  it("posts the collage and its pictures as multipart and keeps the token", async () => {
    const built = await buildSharedCollage(record([piece()]), resolver());
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
    const share = await uploadSharedCollage(
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
    const built = await buildSharedCollage(record([piece()]), resolver());
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Too many" }), { status: 429 }),
    );
    await expect(
      uploadSharedCollage(
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
      await deleteSharedCollage(
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
      deleteSharedCollage(
        "https://w",
        { id: "abc", deleteToken: "x" },
        refused as unknown as typeof fetch,
      ),
    ).rejects.toThrow("nope");
  });

  it("builds a form with one part per picture", async () => {
    const form = shareFormData({
      collage: (await buildSharedCollage(record([piece()]), resolver()))
        .collage,
      images: [blob(), blob()],
    });
    expect([...form.keys()]).toEqual(["collage", "img/0", "img/1"]);
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
    const parsed = parseCollageRecord({ ...record([piece()]), share });
    expect(parsed.share).toEqual(share);
    expect(() =>
      parseCollageRecord({ ...record([piece()]), share: { id: "x" } }),
    ).toThrow();
  });

  it("is never copied into a duplicate or a collage file", async () => {
    const shared = { ...record([piece()]), share };
    expect(duplicateCollage(shared).share).toBeUndefined();
    const file = await encodeCollageFile(shared);
    expect(file).not.toContain("tok");
    expect(readCollageFile(file).share).toBeUndefined();
  });
});
