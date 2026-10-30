// ABOUTME: Tests the published-collage format parser, picture naming and picture-type sniffing.
// ABOUTME: The same parser guards the Worker's uploads and the viewer's reads, so it must reject strictly.

import { describe, expect, it } from "vitest";
import {
  PUBLISHED_COLLAGE_FORMAT,
  PUBLISHED_COLLAGE_VERSION,
  PublishedCollageError,
  isPublishedCollageId,
  parsePublishedCollage,
  publishedCollageViewerUrl,
  publishedImageIndex,
  publishedImageIndexes,
  publishedImageRef,
  sniffPublishedImageType,
  webUrl,
} from "../publishedCollage";

function piece(overrides: Record<string, unknown> = {}) {
  return {
    x: 12,
    y: -30,
    width: 320,
    height: 200,
    rotation: 7.5,
    z: 2,
    crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
    flipX: true,
    flipY: false,
    image: "img/0",
    source: {
      kind: "heading",
      pageUrl: "https://example.com/post?id=4#top",
      pageTitle: "A post",
      domain: "example.com",
      ts: 1_760_000_000_000,
      alt: "Hello there",
    },
    ...overrides,
  };
}

function heading(overrides: Record<string, unknown> = {}) {
  return {
    kind: "heading",
    text: "Hello there",
    level: 2,
    styles: { fontFamily: '"Inter", sans-serif', color: "rgb(0, 0, 0)" },
    ...overrides,
  };
}

function collage(overrides: Record<string, unknown> = {}) {
  return {
    format: PUBLISHED_COLLAGE_FORMAT,
    version: PUBLISHED_COLLAGE_VERSION,
    title: "a walk",
    frame: { width: 1500, height: 1000 },
    paper: { color: "#C9A678", grain: false },
    pieces: [piece()],
    ...overrides,
  };
}

describe("parsePublishedCollage", () => {
  it("reads a well-formed collage and keeps only known fields", () => {
    const parsed = parsePublishedCollage({
      ...collage({
        pieces: [
          {
            ...piece(),
            extra: 1,
            placement: { x: 0.1, y: 0, width: 0.8, height: 1 },
            cutout: true,
          },
        ],
      }),
      sharedAt: 5,
      unknown: "dropped",
    });
    expect(parsed.paper).toEqual({ color: "#c9a678", grain: false });
    expect(parsed.sharedAt).toBe(5);
    expect(parsed).not.toHaveProperty("unknown");
    expect(parsed.pieces[0]).not.toHaveProperty("extra");
    expect(parsed.pieces[0].placement).toEqual({
      x: 0.1,
      y: 0,
      width: 0.8,
      height: 1,
    });
    expect(parsed.pieces[0].cutout).toBe(true);
    expect(parsed.pieces[0].source).toEqual(piece().source);
  });

  const bad: [string, unknown][] = [
    ["a non-object", "nope"],
    ["another format", collage({ format: "wwo-collage" })],
    ["another version", collage({ version: 2 })],
    ["a missing frame", collage({ frame: undefined })],
    ["a tiny frame", collage({ frame: { width: 10, height: 1000 } })],
    ["a non-hex paper", collage({ paper: { color: "red", grain: true } })],
    ["no pieces", collage({ pieces: [] })],
    [
      "a non-finite coordinate",
      collage({ pieces: [piece({ x: Number.NaN })] }),
    ],
    ["a zero-size piece", collage({ pieces: [piece({ width: 0 })] })],
    [
      "a crop with no area",
      collage({
        pieces: [piece({ crop: { x: 0, y: 0, width: 0, height: 1 } })],
      }),
    ],
    [
      "a picture that is not img/<n>",
      collage({ pieces: [piece({ image: "https://evil.example/x.png" })] }),
    ],
    [
      "a padded picture index",
      collage({ pieces: [piece({ image: "img/01" })] }),
    ],
    [
      "an unknown kind",
      collage({
        pieces: [piece({ source: { ...piece().source, kind: "iframe" } })],
      }),
    ],
    [
      "a javascript: page",
      collage({
        pieces: [
          piece({
            source: { ...piece().source, pageUrl: "javascript:alert(1)" },
          }),
        ],
      }),
    ],
    [
      "a data: favicon",
      collage({
        pieces: [
          piece({
            source: {
              ...piece().source,
              faviconUrl: "data:image/png;base64,AA",
            },
          }),
        ],
      }),
    ],
    ["an overlong title", collage({ title: "x".repeat(201) })],
    [
      "a cutout that is not true",
      collage({ pieces: [piece({ cutout: false })] }),
    ],
    [
      "a piece with both a picture and content",
      collage({ pieces: [piece({ content: heading() })] }),
    ],
    [
      "a piece with neither a picture nor content",
      collage({ pieces: [piece({ image: undefined })] }),
    ],
    [
      "content whose kind differs from its source",
      collage({
        pieces: [
          piece({
            image: undefined,
            content: heading(),
            source: { ...piece().source, kind: "button" },
          }),
        ],
      }),
    ],
    [
      "a style property the collector never captures",
      collage({
        pieces: [
          piece({
            image: undefined,
            content: heading({ styles: { position: "fixed" } }),
          }),
        ],
      }),
    ],
    [
      "a style value that fetches",
      collage({
        pieces: [
          piece({
            image: undefined,
            content: heading({
              styles: { color: "red; background: url(https://x.example/p)" },
            }),
          }),
        ],
      }),
    ],
    [
      "an icon that is not an svg",
      collage({
        pieces: [
          piece({
            image: undefined,
            content: {
              kind: "svg-icon",
              markup: "<img src=x onerror=alert(1)>",
              width: 10,
              height: 10,
            },
            source: { ...piece().source, kind: "svg-icon" },
          }),
        ],
      }),
    ],
    [
      "markup over 64 KB",
      collage({
        pieces: [
          piece({
            image: undefined,
            content: {
              kind: "svg-icon",
              markup: `<svg>${"<g/>".repeat(17_000)}</svg>`,
              width: 10,
              height: 10,
            },
            source: { ...piece().source, kind: "svg-icon" },
          }),
        ],
      }),
    ],
    [
      "content that is placed like a picture",
      collage({
        pieces: [
          piece({
            image: undefined,
            content: heading(),
            placement: { x: 0, y: 0, width: 1, height: 1 },
          }),
        ],
      }),
    ],
    ["an unknown back", collage({ backShows: "everything" })],
    [
      "only one natural dimension",
      collage({
        pieces: [piece({ source: { ...piece().source, naturalWidth: 10 } })],
      }),
    ],
  ];
  for (const [name, value] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => parsePublishedCollage(value)).toThrow(PublishedCollageError);
    });
  }

  it("reads content pieces, the back and when it was made", () => {
    const button = {
      kind: "button",
      text: "Subscribe",
      styles: {
        backgroundColor: "rgb(0, 0, 255)",
        backgroundImage: "linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))",
        border: "1px solid rgb(0, 0, 0)",
      },
      innerSvg: '<svg viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>',
      backdropColor: "rgb(255, 255, 255)",
    };
    const parsed = parsePublishedCollage(
      collage({
        createdAt: 5,
        backShows: "titles",
        pieces: [
          piece({ image: undefined, content: heading() }),
          piece({
            image: undefined,
            content: button,
            source: { ...piece().source, kind: "button" },
          }),
        ],
      }),
    );
    expect(parsed.createdAt).toBe(5);
    expect(parsed.backShows).toBe("titles");
    expect(parsed.pieces[0]).not.toHaveProperty("image");
    expect(parsed.pieces[0].content).toEqual(heading());
    expect(parsed.pieces[1].content).toEqual(button);
    // A collage with only content pieces uploads no pictures.
    expect(publishedImageIndexes(parsed)).toEqual([]);
  });

  it("reads a version 1 collage written before content and the back", () => {
    const parsed = parsePublishedCollage(collage());
    expect(parsed).not.toHaveProperty("backShows");
    expect(parsed).not.toHaveProperty("createdAt");
  });

  it("accepts a piece whose page address is empty", () => {
    const parsed = parsePublishedCollage(
      collage({
        pieces: [piece({ source: { ...piece().source, pageUrl: "" } })],
      }),
    );
    expect(parsed.pieces[0].source.pageUrl).toBe("");
  });

  it("reads a signature by name and colour, or by colour alone", () => {
    const named = parsePublishedCollage(
      collage({
        signature: { name: "  spencer ", color: "#FFAE00", pid: "x" },
      }),
    );
    expect(named.signature).toEqual({ name: "spencer", color: "#ffae00" });
    const sealed = parsePublishedCollage(
      collage({ signature: { color: "#4f8cff" } }),
    );
    expect(sealed.signature).toEqual({ color: "#4f8cff" });
    expect(parsePublishedCollage(collage())).not.toHaveProperty("signature");
  });

  for (const [name, signature] of [
    ["a signature without a colour", { name: "spencer" }],
    ["a signature colour that is not hex", { color: "hsl(10, 70%, 60%)" }],
    ["an empty signature name", { name: "   ", color: "#ffae00" }],
    [
      "a signature name with control characters",
      { name: "a\nb", color: "#ffae00" },
    ],
    [
      "a signature name with a direction override",
      { name: "ari\u202Ekcis", color: "#ffae00" },
    ],
    [
      "a signature name with a zero-width character",
      { name: "spen\u200Bcer", color: "#ffae00" },
    ],
    ["an overlong signature name", { name: "x".repeat(61), color: "#ffae00" }],
  ] as const) {
    it(`rejects ${name}`, () => {
      expect(() => parsePublishedCollage(collage({ signature }))).toThrow(
        PublishedCollageError,
      );
    });
  }
});

describe("picture names", () => {
  it("round-trips indexes and rejects anything else", () => {
    expect(publishedImageRef(0)).toBe("img/0");
    expect(publishedImageIndex("img/299")).toBe(299);
    expect(publishedImageIndex("img/300")).toBeNull();
    expect(publishedImageIndex("img/-1")).toBeNull();
    expect(publishedImageIndex("img/../x")).toBeNull();
    expect(() => publishedImageRef(300)).toThrow(PublishedCollageError);
  });

  it("requires the pictures to run 0..n-1 with no gaps", () => {
    const two = parsePublishedCollage(
      collage({
        pieces: [
          piece({ image: "img/1" }),
          piece({ image: "img/0" }),
          piece({ image: "img/1" }),
        ],
      }),
    );
    expect(publishedImageIndexes(two)).toEqual([0, 1]);
    const gap = parsePublishedCollage(
      collage({ pieces: [piece({ image: "img/2" })] }),
    );
    expect(() => publishedImageIndexes(gap)).toThrow(PublishedCollageError);
  });
});

describe("sniffPublishedImageType", () => {
  const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
  it("names the formats the share carries by their bytes", () => {
    expect(
      sniffPublishedImageType(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
    expect(
      sniffPublishedImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
    ).toBe("image/jpeg");
    expect(sniffPublishedImageType(new Uint8Array(ascii("GIF89a....")))).toBe(
      "image/gif",
    );
    expect(
      sniffPublishedImageType(new Uint8Array(ascii("RIFF\0\0\0\0WEBPVP8 "))),
    ).toBe("image/webp");
    expect(
      sniffPublishedImageType(
        new Uint8Array([0, 0, 0, 0x1c, ...ascii("ftypavif")]),
      ),
    ).toBe("image/avif");
  });

  it("refuses svg, html and empty bytes", () => {
    expect(
      sniffPublishedImageType(new Uint8Array(ascii("<svg xmlns"))),
    ).toBeNull();
    expect(
      sniffPublishedImageType(new Uint8Array(ascii("<!doctype html>"))),
    ).toBeNull();
    expect(sniffPublishedImageType(new Uint8Array())).toBeNull();
  });
});

describe("helpers", () => {
  it("recognizes share ids", () => {
    expect(isPublishedCollageId("AbCdEfGhIjKlMnOpQrStU_")).toBe(true);
    expect(isPublishedCollageId("short")).toBe(false);
    expect(isPublishedCollageId("AbCdEfGhIjKlMnOpQrSt/_")).toBe(false);
  });

  it("builds viewer links", () => {
    expect(publishedCollageViewerUrl("abc")).toBe(
      "https://wewere.online/collage/?id=abc",
    );
    expect(publishedCollageViewerUrl("abc", "http://localhost:5173/")).toBe(
      "http://localhost:5173/collage/?id=abc",
    );
  });

  it("only accepts web addresses", () => {
    expect(webUrl("https://a.example/x")).toBe("https://a.example/x");
    expect(webUrl("ftp://a.example/x")).toBeNull();
    expect(webUrl("not a url")).toBeNull();
  });
});
