// ABOUTME: Tests how flipping composes with rotation, cropping and the box.
// ABOUTME: A flip mirrors what a piece shows without moving or resizing it.

import { describe, expect, it } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  applyCrop,
  commitCropSession,
  flipPiece,
  materialBox,
  mirrorCrop,
  pieceMaterialTransform,
  type CollagePiece,
} from "../entrypoints/scraps/collageRecord";

function piece(overrides: Partial<CollagePiece> = {}): CollagePiece {
  return {
    id: "piece_1",
    scrapId: "scrap_1",
    scrap: {
      id: "scrap_1",
      key: "image:one",
      kind: "image",
      src: "https://example.test/one.png",
      naturalWidth: 200,
      naturalHeight: 100,
      pageTitle: "A page",
      domain: "example.test",
      pageUrl: "https://example.test/a",
      ts: 1_000,
    } as ScrapItem,
    x: 40,
    y: 60,
    width: 200,
    height: 100,
    rotation: 0,
    z: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
    ...overrides,
  };
}

describe("flipPiece", () => {
  it("mirrors horizontally without moving or resizing the box", () => {
    const flipped = flipPiece(piece(), "x");
    expect(flipped.flipX).toBe(true);
    expect(flipped.flipY).toBe(false);
    expect({
      x: flipped.x,
      y: flipped.y,
      width: flipped.width,
      height: flipped.height,
    }).toEqual({ x: 40, y: 60, width: 200, height: 100 });
  });

  it("mirrors vertically on its own axis", () => {
    const flipped = flipPiece(piece(), "y");
    expect(flipped.flipY).toBe(true);
    expect(flipped.flipX).toBe(false);
  });

  it("returns to the original after two flips on the same axis", () => {
    const twice = flipPiece(flipPiece(piece(), "x"), "x");
    expect(twice.flipX).toBe(false);
  });

  it("combines both axes independently", () => {
    const both = flipPiece(flipPiece(piece(), "x"), "y");
    expect(both).toMatchObject({ flipX: true, flipY: true });
  });

  it("leaves the rotation alone", () => {
    expect(flipPiece(piece({ rotation: 37 }), "x").rotation).toBe(37);
  });

  it("leaves the crop window alone, because the crop names the source", () => {
    const cropped = applyCrop(piece(), {
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    });
    const flipped = flipPiece(cropped, "x");
    expect(flipped.crop).toEqual(cropped.crop);
    expect(flipped.width).toBe(cropped.width);
    expect(flipped.x).toBe(cropped.x);
  });

  it("keeps a cutout attached to the piece it was computed for", () => {
    const cut = piece({ cutout: { method: "edge-color", tolerance: 0.2 } });
    expect(flipPiece(cut, "y").cutout).toEqual(cut.cutout);
  });
});

describe("pieceMaterialTransform", () => {
  it("draws nothing extra when the piece is not flipped", () => {
    expect(pieceMaterialTransform(piece())).toBe("none");
  });

  it("mirrors on the flipped axis only", () => {
    expect(pieceMaterialTransform(piece({ flipX: true }))).toBe("scale(-1, 1)");
    expect(pieceMaterialTransform(piece({ flipY: true }))).toBe("scale(1, -1)");
    expect(
      pieceMaterialTransform(piece({ flipX: true, flipY: true })),
    ).toBe("scale(-1, -1)");
  });

  it("does not encode the rotation, which the box already carries", () => {
    expect(pieceMaterialTransform(piece({ rotation: 90, flipX: true }))).toBe(
      "scale(-1, 1)",
    );
  });
});

describe("materialBox", () => {
  const cropped = () =>
    applyCrop(piece(), { x: 0, y: 0, width: 0.5, height: 1 });

  it("is the plain source box on an unflipped piece", () => {
    const shown = cropped();
    expect(materialBox(shown)).toEqual({
      x: shown.x,
      y: shown.y,
      width: shown.width * 2,
      height: shown.height,
    });
  });

  it("mirrors the source about the piece's box, so the crop still shows", () => {
    // The left half is kept. Mirrored about the piece's own middle, the whole
    // source extends to the left instead, and the box still shows that half.
    const flipped = flipPiece(cropped(), "x");
    const box = materialBox(flipped);
    expect(box.x).toBeCloseTo(flipped.x - flipped.width);
    expect(box.x + box.width).toBeCloseTo(flipped.x + flipped.width);
  });
});

describe("mirrorCrop", () => {
  it("is its own inverse", () => {
    const crop = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const flips = { flipX: true, flipY: true };
    const back = mirrorCrop(mirrorCrop(crop, flips), flips);
    expect(back.x).toBeCloseTo(crop.x);
    expect(back.y).toBeCloseTo(crop.y);
  });
});

describe("cropping a flipped piece", () => {
  it("keeps the part kept on screen where it sat on screen", () => {
    const flipped = flipPiece(piece(), "x");
    // The left half of the source shows on the right of a mirrored piece.
    const cropped = commitCropSession(flipped, {
      x: 0,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(cropped.crop).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
    expect(cropped.x).toBeCloseTo(flipped.x + flipped.width / 2);
    expect(cropped.width).toBeCloseTo(flipped.width / 2);
  });
});
