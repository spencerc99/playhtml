// ABOUTME: Checks how large a published picture is made for the piece it fills,
// ABOUTME: and that animated pictures are published as they are, never redrawn to one frame.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../entrypoints/scraps/bakeCollage", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../entrypoints/scraps/bakeCollage")
  >()),
  loadImage: vi.fn(async () => {
    throw new Error("redrawn");
  }),
}));

import {
  neededLongestSide,
  publishPieceMaterial,
} from "../entrypoints/scraps/publishPieceImages";
import type { CollagePiece } from "../entrypoints/scraps/collageRecord";

const FULL = { x: 0, y: 0, width: 1, height: 1 };

describe("neededLongestSide", () => {
  it("is twice the piece's longest side, rounded up to a step", () => {
    expect(neededLongestSide({ width: 300, height: 200, crop: FULL })).toBe(
      640,
    );
  });

  it("counts the whole picture when the piece shows only part of it", () => {
    const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
    expect(neededLongestSide({ width: 300, height: 200, crop })).toBe(1280);
  });

  it("stays between one step and the cap", () => {
    expect(neededLongestSide({ width: 10, height: 8, crop: FULL })).toBe(128);
    expect(neededLongestSide({ width: 4000, height: 900, crop: FULL })).toBe(
      2048,
    );
  });
});

/** A PNG made of the given chunks; CRCs are left as zeros, which nothing here checks. */
function png(chunks: [string, number][]): Uint8Array {
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [type, length] of chunks) {
    parts.push(
      (length >>> 24) & 255,
      (length >>> 16) & 255,
      (length >>> 8) & 255,
      length & 255,
      ...[...type].map((c) => c.charCodeAt(0)),
    );
    for (let i = 0; i < length + 4; i++) parts.push(0);
  }
  return new Uint8Array(parts);
}

function imagePiece(src: string): CollagePiece {
  return {
    id: "piece_1",
    scrapId: "scrap_1",
    scrap: {
      id: "scrap_1",
      kind: "image",
      src,
      domain: "example.test",
    },
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    rotation: 0,
    z: 0,
    crop: FULL,
    flipX: false,
    flipY: false,
  } as unknown as CollagePiece;
}

describe("publishPieceMaterial for large PNGs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function serve(bytes: Uint8Array) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(bytes.buffer as ArrayBuffer, {
            status: 200,
            headers: { "Content-Type": "image/png" },
          }),
      ),
    );
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
  }

  const FRAME_BYTES = 200 * 1024;

  it("sends an animated PNG as it is, so it keeps moving", async () => {
    const apng = png([
      ["IHDR", 13],
      ["acTL", 8],
      ["IDAT", FRAME_BYTES],
      ["IEND", 0],
    ]);
    serve(apng);
    const material = await publishPieceMaterial(
      imagePiece("https://example.test/spin.png"),
    );
    if (!("blob" in material)) throw new Error("expected a picture");
    expect(material.blob.type).toBe("image/png");
    expect(new Uint8Array(await material.blob.arrayBuffer())).toEqual(apng);
  });

  it("redraws a large still PNG at the size its piece needs", async () => {
    serve(
      png([
        ["IHDR", 13],
        ["IDAT", FRAME_BYTES],
        ["IEND", 0],
      ]),
    );
    await expect(
      publishPieceMaterial(imagePiece("https://example.test/photo.png")),
    ).rejects.toThrow("redrawn");
  });
});
