// ABOUTME: Tests converting collage pieces to tldraw shapes for the tldraw studio prototype, and back.
// ABOUTME: Position, rotation, crop, flips, stacking and shape kind must all survive the round trip.

import { describe, expect, it } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import type { CollagePiece } from "../entrypoints/scraps/collageRecord";
import {
  SCRAP_PIECE_TYPE,
  assetIdForSrc,
  piecesToRecords,
  pieceToShape,
  shapesToPieces,
} from "../entrypoints/scraps/tldraw/pieceShapes";
import type { IndexKey } from "tldraw";

const IMAGE = {
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
} as Extract<ScrapItem, { kind: "image" }>;

const HEADING = {
  id: "scrap_2",
  key: "heading:two",
  kind: "heading",
  text: "hello",
  pageTitle: "B page",
  domain: "example.test",
  pageUrl: "https://example.test/b",
  ts: 2_000,
} as unknown as ScrapItem;

function piece(overrides: Partial<CollagePiece> = {}): CollagePiece {
  return {
    id: "piece_1",
    scrapId: IMAGE.id,
    scrap: IMAGE,
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

const INDEX = "a1" as IndexKey;

describe("pieceToShape", () => {
  it("places an unrotated piece at its own top-left corner", () => {
    const shape = pieceToShape(piece(), INDEX);
    expect(shape.type).toBe("image");
    expect(shape.id).toBe("shape:piece_1");
    expect(shape.x).toBeCloseTo(40);
    expect(shape.y).toBeCloseTo(60);
    expect(shape.rotation).toBe(0);
    expect(shape.props.w).toBe(200);
    expect(shape.props.h).toBe(100);
    expect(shape.props.crop).toBeNull();
  });

  it("turns a rotated piece about its center, where tldraw turns about the corner", () => {
    // A 200x100 box centered at (140, 110), turned a quarter.
    const shape = pieceToShape(piece({ rotation: 90 }), INDEX);
    expect(shape.rotation).toBeCloseTo(Math.PI / 2);
    // The unrotated top-left (-100, -50) from center turns to (50, -100).
    expect(shape.x).toBeCloseTo(190);
    expect(shape.y).toBeCloseTo(10);
  });

  it("carries crop fractions as tldraw's corner crop", () => {
    const shape = pieceToShape(
      piece({ crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 } }),
      INDEX,
    );
    expect(shape.props.crop?.topLeft.x).toBeCloseTo(0.1);
    expect(shape.props.crop?.topLeft.y).toBeCloseTo(0.2);
    expect(shape.props.crop?.bottomRight.x).toBeCloseTo(0.6);
    expect(shape.props.crop?.bottomRight.y).toBeCloseTo(0.8);
  });

  it("keeps the scrap in meta as plain JSON, dropping undefined fields", () => {
    const scrap = { ...IMAGE, encounterCount: undefined } as ScrapItem;
    const shape = pieceToShape(piece({ scrap }), INDEX);
    expect("encounterCount" in shape.meta.scrap).toBe(false);
    expect(shape.meta.scrap.src).toBe(IMAGE.src);
  });

  it("points an image at a shared asset for its source", () => {
    const shape = pieceToShape(piece(), INDEX);
    if (shape.type !== "image") throw new Error("expected an image shape");
    expect(shape.props.assetId).toBe(assetIdForSrc(IMAGE.src));
    expect(shape.meta.scrapId).toBe(IMAGE.id);
  });

  it("draws a heading, and a cut-out image, as a scrap piece", () => {
    expect(pieceToShape(piece({ scrap: HEADING, scrapId: HEADING.id }), INDEX).type).toBe(
      SCRAP_PIECE_TYPE,
    );
    const cut = pieceToShape(
      piece({ cutout: { method: "edge-color", tolerance: 0.2 } }),
      INDEX,
    );
    expect(cut.type).toBe(SCRAP_PIECE_TYPE);
    if (cut.type !== SCRAP_PIECE_TYPE) throw new Error("expected a scrap piece");
    expect(cut.props.cutout).toEqual({ method: "edge-color", tolerance: 0.2 });
  });
});

describe("piecesToRecords and shapesToPieces", () => {
  it("round-trips pieces with their stacking, crop, flips and rotation", () => {
    const pieces: CollagePiece[] = [
      piece({ id: "piece_top", z: 2, rotation: -30, flipX: true }),
      piece({
        id: "piece_bottom",
        z: 0,
        crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
        flipY: true,
        width: 100,
      }),
      piece({
        id: "piece_middle",
        z: 1,
        scrap: HEADING,
        scrapId: HEADING.id,
        rotation: 170,
        cutout: undefined,
      }),
    ];
    const { shapes, assets } = piecesToRecords(pieces);
    expect(assets).toHaveLength(1);
    expect(assets[0].props.src).toBe(IMAGE.src);

    const back = shapesToPieces([...shapes].reverse());
    expect(back.map((p) => p.id)).toEqual(["piece_bottom", "piece_middle", "piece_top"]);
    expect(back.map((p) => p.z)).toEqual([0, 1, 2]);

    for (const original of pieces) {
      const returned = back.find((p) => p.id === original.id);
      if (!returned) throw new Error(`missing ${original.id}`);
      expect(returned.x).toBeCloseTo(original.x);
      expect(returned.y).toBeCloseTo(original.y);
      expect(returned.width).toBeCloseTo(original.width);
      expect(returned.height).toBeCloseTo(original.height);
      expect(returned.rotation).toBeCloseTo(original.rotation);
      expect(returned.crop.x).toBeCloseTo(original.crop.x);
      expect(returned.crop.width).toBeCloseTo(original.crop.width);
      expect(returned.flipX).toBe(original.flipX);
      expect(returned.flipY).toBe(original.flipY);
      expect(returned.scrap).toEqual(original.scrap);
      expect(returned.cutout).toEqual(original.cutout);
    }
  });
});
