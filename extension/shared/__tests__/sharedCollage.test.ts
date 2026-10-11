// ABOUTME: Tests the shared-collage format parser, picture naming and picture-type sniffing.
// ABOUTME: The same parser guards the Worker's uploads and the viewer's reads, so it must reject strictly.

import { describe, expect, it } from "vitest";
import {
  SHARED_COLLAGE_FORMAT,
  SHARED_COLLAGE_VERSION,
  SharedCollageError,
  isSharedCollageId,
  parseSharedCollage,
  sharedCollageViewerUrl,
  sharedImageIndex,
  sharedImageIndexes,
  sharedImageRef,
  sniffSharedImageType,
  webUrl,
} from "../sharedCollage";

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

function collage(overrides: Record<string, unknown> = {}) {
  return {
    format: SHARED_COLLAGE_FORMAT,
    version: SHARED_COLLAGE_VERSION,
    title: "a walk",
    frame: { width: 1500, height: 1000 },
    paper: { color: "#C9A678", grain: false },
    pieces: [piece()],
    ...overrides,
  };
}

describe("parseSharedCollage", () => {
  it("reads a well-formed collage and keeps only known fields", () => {
    const parsed = parseSharedCollage({
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
      "only one natural dimension",
      collage({
        pieces: [piece({ source: { ...piece().source, naturalWidth: 10 } })],
      }),
    ],
  ];
  for (const [name, value] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => parseSharedCollage(value)).toThrow(SharedCollageError);
    });
  }

  it("accepts a piece whose page address is empty", () => {
    const parsed = parseSharedCollage(
      collage({
        pieces: [piece({ source: { ...piece().source, pageUrl: "" } })],
      }),
    );
    expect(parsed.pieces[0].source.pageUrl).toBe("");
  });
});

describe("picture names", () => {
  it("round-trips indexes and rejects anything else", () => {
    expect(sharedImageRef(0)).toBe("img/0");
    expect(sharedImageIndex("img/299")).toBe(299);
    expect(sharedImageIndex("img/300")).toBeNull();
    expect(sharedImageIndex("img/-1")).toBeNull();
    expect(sharedImageIndex("img/../x")).toBeNull();
    expect(() => sharedImageRef(300)).toThrow(SharedCollageError);
  });

  it("requires the pictures to run 0..n-1 with no gaps", () => {
    const two = parseSharedCollage(
      collage({
        pieces: [
          piece({ image: "img/1" }),
          piece({ image: "img/0" }),
          piece({ image: "img/1" }),
        ],
      }),
    );
    expect(sharedImageIndexes(two)).toEqual([0, 1]);
    const gap = parseSharedCollage(
      collage({ pieces: [piece({ image: "img/2" })] }),
    );
    expect(() => sharedImageIndexes(gap)).toThrow(SharedCollageError);
  });
});

describe("sniffSharedImageType", () => {
  const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
  it("names the formats the share carries by their bytes", () => {
    expect(
      sniffSharedImageType(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
    expect(sniffSharedImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
    expect(sniffSharedImageType(new Uint8Array(ascii("GIF89a....")))).toBe(
      "image/gif",
    );
    expect(
      sniffSharedImageType(new Uint8Array(ascii("RIFF\0\0\0\0WEBPVP8 "))),
    ).toBe("image/webp");
    expect(
      sniffSharedImageType(
        new Uint8Array([0, 0, 0, 0x1c, ...ascii("ftypavif")]),
      ),
    ).toBe("image/avif");
  });

  it("refuses svg, html and empty bytes", () => {
    expect(
      sniffSharedImageType(new Uint8Array(ascii("<svg xmlns"))),
    ).toBeNull();
    expect(
      sniffSharedImageType(new Uint8Array(ascii("<!doctype html>"))),
    ).toBeNull();
    expect(sniffSharedImageType(new Uint8Array())).toBeNull();
  });
});

describe("helpers", () => {
  it("recognizes share ids", () => {
    expect(isSharedCollageId("AbCdEfGhIjKlMnOpQrStU_")).toBe(true);
    expect(isSharedCollageId("short")).toBe(false);
    expect(isSharedCollageId("AbCdEfGhIjKlMnOpQrSt/_")).toBe(false);
  });

  it("builds viewer links", () => {
    expect(sharedCollageViewerUrl("abc")).toBe(
      "https://wewere.online/collage/?id=abc",
    );
    expect(sharedCollageViewerUrl("abc", "http://localhost:5173/")).toBe(
      "http://localhost:5173/collage/?id=abc",
    );
  });

  it("only accepts web addresses", () => {
    expect(webUrl("https://a.example/x")).toBe("https://a.example/x");
    expect(webUrl("ftp://a.example/x")).toBeNull();
    expect(webUrl("not a url")).toBeNull();
  });
});
