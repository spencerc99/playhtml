// ABOUTME: Tests converting collage pieces to tldraw shapes for the tldraw collage editor, and back.
// ABOUTME: An untouched collage must come back identical; an edit changes only what was edited.

import { describe, expect, it } from "vitest";
import type { IndexKey } from "tldraw";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import type { CollagePiece } from "../entrypoints/scraps/collageRecord";
import {
  SCRAP_PIECE_TYPE,
  assetIdForSrc,
  pieceToShape,
  piecesToShapes,
  shapesToPieces,
  type PieceShape,
} from "../entrypoints/scraps/tldraw/pieceShapes";

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
  encounterCount: undefined,
} as Extract<ScrapItem, { kind: "image" }>;

const HEADING = {
  id: "scrap_2",
  key: "heading:two",
  kind: "heading",
  text: "hello",
  level: 1,
  styles: { fontSize: "32px" },
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
    x: 40.123456789,
    y: 60.987654321,
    width: 200.1,
    height: 100.3,
    rotation: 0,
    z: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
    ...overrides,
  };
}

/** A collage's pieces with odd values: sparse heights, an order unlike the stack, awkward floats. */
function awkwardPieces(): CollagePiece[] {
  return [
    piece({ id: "piece_top", z: 17, rotation: -33.3333333, flipX: true }),
    piece({
      id: "piece_bottom",
      z: -4,
      crop: { x: 0.1234567, y: 0, width: 0.3333333, height: 0.9 },
      flipY: true,
      width: 100.5,
    }),
    piece({
      id: "piece_middle",
      z: 3,
      scrap: HEADING,
      scrapId: HEADING.id,
      rotation: 170.25,
    }),
    piece({
      id: "piece_cut",
      z: 3,
      rotation: 91.7,
      cutout: { method: "edge-color", tolerance: 0.17 },
    }),
  ];
}

/** Carries shapes the way tldraw stores them: plain JSON records. */
function throughStore(shapes: readonly PieceShape[]): PieceShape[] {
  return JSON.parse(JSON.stringify(shapes)) as PieceShape[];
}

const INDEX = "a1" as IndexKey;

describe("pieceToShape", () => {
  it("turns a rotated piece about its center, where tldraw turns about the corner", () => {
    // A 200x100 box centered at (140, 110), turned a quarter.
    const shape = pieceToShape(
      piece({ x: 40, y: 60, width: 200, height: 100, rotation: 90 }),
      INDEX,
    );
    expect(shape.rotation).toBeCloseTo(Math.PI / 2);
    expect(shape.x).toBeCloseTo(190);
    expect(shape.y).toBeCloseTo(10);
  });

  it("carries crop fractions as tldraw's corner crop", () => {
    const shape = pieceToShape(piece({ crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 } }), INDEX);
    expect(shape.props.crop?.topLeft).toEqual({ x: 0.1, y: 0.2 });
    expect(shape.props.crop?.bottomRight.x).toBeCloseTo(0.6);
    expect(shape.props.crop?.bottomRight.y).toBeCloseTo(0.8);
  });

  it("keeps the scrap in meta as plain JSON, dropping undefined fields", () => {
    const shape = pieceToShape(piece(), INDEX);
    expect("encounterCount" in shape.meta.scrap).toBe(false);
    expect(shape.meta.pieceId).toBe("piece_1");
  });

  it("draws plain pictures as images and everything else as scrap pieces", () => {
    const image = pieceToShape(piece(), INDEX);
    expect(image.type).toBe("image");
    if (image.type !== "image") throw new Error("expected an image shape");
    expect(image.props.assetId).toBe(assetIdForSrc(IMAGE.src));
    expect(pieceToShape(piece({ scrap: HEADING }), INDEX).type).toBe(SCRAP_PIECE_TYPE);
    expect(
      pieceToShape(piece({ cutout: { method: "edge-color", tolerance: 0.2 } }), INDEX).type,
    ).toBe(SCRAP_PIECE_TYPE);
  });
});

describe("round trip", () => {
  it("gives back an untouched collage's pieces exactly, in record order", () => {
    const original = awkwardPieces();
    const { shapes, sources } = piecesToShapes(original);
    const back = shapesToPieces(
      throughStore(shapes).reverse(),
      sources,
      original.map((p) => p.id),
    );
    expect(back).toStrictEqual(original);
    // The very same objects, so nothing tldraw does not model can be lost.
    back.forEach((p, i) => expect(p).toBe(original[i]));
  });

  it("changes only the geometry of a moved piece", () => {
    const original = awkwardPieces();
    const { shapes, sources } = piecesToShapes(original);
    const stored = throughStore(shapes);
    const top = stored.find((s) => s.meta.pieceId === "piece_top")!;
    top.x += 30;
    top.y -= 12.5;
    const back = shapesToPieces(stored, sources, original.map((p) => p.id));
    const moved = back.find((p) => p.id === "piece_top")!;
    const before = original.find((p) => p.id === "piece_top")!;
    expect(moved.x).toBeCloseTo(before.x + 30);
    expect(moved.y).toBeCloseTo(before.y - 12.5);
    expect(moved.rotation).toBeCloseTo(before.rotation);
    expect({ ...moved, x: 0, y: 0, rotation: 0, width: 0, height: 0 }).toStrictEqual({
      ...before,
      x: 0,
      y: 0,
      rotation: 0,
      width: 0,
      height: 0,
    });
    for (const other of back.filter((p) => p.id !== "piece_top")) {
      expect(other).toBe(original.find((p) => p.id === other.id));
    }
  });

  it("carries a cutout through untouched, and takes a changed one", () => {
    const original = awkwardPieces();
    const { shapes, sources } = piecesToShapes(original);
    const stored = throughStore(shapes);
    const cut = stored.find((s) => s.meta.pieceId === "piece_cut")!;
    if (cut.type !== SCRAP_PIECE_TYPE) throw new Error("expected a scrap piece");
    cut.props.cutout = { method: "edge-color", tolerance: 0.4 };
    const back = shapesToPieces(stored, sources, original.map((p) => p.id));
    expect(back.find((p) => p.id === "piece_cut")!.cutout).toEqual({
      method: "edge-color",
      tolerance: 0.4,
    });
  });

  it("renumbers heights once the stacking order changes", () => {
    const original = awkwardPieces();
    const { shapes, sources } = piecesToShapes(original);
    const stored = throughStore(shapes);
    const bottom = stored.find((s) => s.meta.pieceId === "piece_bottom")!;
    bottom.index = "a9" as IndexKey;
    const back = shapesToPieces(stored, sources, original.map((p) => p.id));
    expect(back.map((p) => p.id)).toEqual(original.map((p) => p.id));
    expect(back.find((p) => p.id === "piece_bottom")!.z).toBe(3);
    expect(back.map((p) => p.z).sort()).toEqual([0, 1, 2, 3]);
  });

  it("makes a duplicate a new piece copied from its original, after the others", () => {
    const original = awkwardPieces();
    const { shapes, sources } = piecesToShapes(original);
    const stored = throughStore(shapes);
    const top = stored.find((s) => s.meta.pieceId === "piece_top")!;
    const copy = { ...top, id: "shape:piece_copy", x: top.x + 24, index: "a9" as IndexKey };
    const back = shapesToPieces([...stored, copy], sources, original.map((p) => p.id));
    expect(back).toHaveLength(5);
    const made = back[4];
    expect(made.id).toBe("piece_copy");
    expect(made.scrap).toBe(original[0].scrap);
    expect(made.flipX).toBe(true);
    expect(made.x).toBeCloseTo(original[0].x + 24);
  });
});
