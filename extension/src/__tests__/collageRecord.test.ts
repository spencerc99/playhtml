// ABOUTME: Tests collage record parsing, stacking order, and source-page provenance.
// ABOUTME: Guards that a stored collage round-trips and that provenance dedupes by page.

import { describe, expect, it } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import { rotatePoint } from "../entrypoints/scraps/collageGeometry";
import {
  applyCrop,
  clearCrop,
  collageProvenance,
  commitCropSession,
  cropSessionStart,
  duplicateCollage,
  movePieceBackward,
  movePieceForward,
  normalizeStack,
  parseCollagePiece,
  parseCollageRecord,
  summarizeCollage,
  type CollagePiece,
  type CollageRecord,
} from "../entrypoints/scraps/collageRecord";

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
    pageUrl: "https://example.test/a",
    ts: 1_000,
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
    rotation: 0,
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
    title: "A collage",
    createdAt: 5_000,
    updatedAt: 6_000,
    frame: { width: 1500, height: 1000 },
    format: "postcard",
    paper: { color: "#fffdf9", grain: false },
    pieces,
    preview: { drawn: true as const, image: new Blob(["png"], { type: "image/png" }) },
  };
}

describe("parseCollagePiece", () => {
  it("round-trips a well-formed piece", () => {
    const original = piece({ rotation: 24, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } });
    expect(parseCollagePiece(structuredClone(original))).toEqual(original);
  });

  it("defaults a piece saved without a crop to the whole source", () => {
    const { crop, ...withoutCrop } = piece();
    expect(crop).toBeDefined();
    expect(parseCollagePiece(withoutCrop).crop).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it("refuses a piece missing its scrap snapshot", () => {
    const { scrap: _dropped, ...withoutScrap } = piece();
    expect(() => parseCollagePiece(withoutScrap)).toThrow(/scrap snapshot/);
  });

  it("refuses a piece with a non-numeric position", () => {
    expect(() => parseCollagePiece({ ...piece(), x: "left" })).toThrow(
      /numeric x/,
    );
  });

  it("refuses a partial crop rather than filling in the gap", () => {
    expect(() =>
      parseCollagePiece({ ...piece(), crop: { x: 0, y: 0, width: 1 } }),
    ).toThrow(/numeric height/);
  });
});

describe("parseCollageRecord", () => {
  it("round-trips a saved collage", () => {
    const original = record([piece()]);
    const parsed = parseCollageRecord({
      ...structuredClone({ ...original, preview: undefined }),
      preview: original.preview,
    });
    expect(parsed).toEqual(original);
  });

  it("refuses a record with no preview at all", () => {
    const { preview: _dropped, ...withoutPreview } = record([piece()]);
    expect(() => parseCollageRecord(withoutPreview)).toThrow(/missing its preview/);
  });

  it("reads a collage stored before its first bake", () => {
    const undrawn = {
      ...record([piece()]),
      preview: { drawn: false, reason: "not drawn yet" },
    };
    expect(parseCollageRecord(undrawn).preview).toEqual({
      drawn: false,
      reason: "not drawn yet",
    });
  });

  it("refuses a preview that claims to be drawn but carries no image", () => {
    const lying = { ...record([piece()]), preview: { drawn: true } };
    expect(() => parseCollageRecord(lying)).toThrow(/carries no image/);
  });

  it("refuses an undrawn preview that does not say why", () => {
    const silent = { ...record([piece()]), preview: { drawn: false } };
    expect(() => parseCollageRecord(silent)).toThrow(/must say why/);
  });

  it("refuses a record with no pieces array", () => {
    const { pieces: _dropped, ...withoutPieces } = record([piece()]);
    expect(() => parseCollageRecord(withoutPieces)).toThrow(/its pieces/);
  });

  it("summarizes a record down to what the history grid shows", () => {
    const summary = summarizeCollage(record([piece(), piece({ id: "piece_2" })]));
    expect(summary).toMatchObject({
      id: "collage_1",
      title: "A collage",
      pieceCount: 2,
      createdAt: 5_000,
      updatedAt: 6_000,
    });
  });
});

describe("collageProvenance", () => {
  it("lists one entry per source page, oldest first", () => {
    const sources = collageProvenance([
      piece({
        id: "a",
        scrap: scrap({ pageUrl: "https://b.test/x", domain: "b.test", ts: 3_000 }),
      }),
      piece({
        id: "b",
        scrap: scrap({ pageUrl: "https://a.test/y", domain: "a.test", ts: 1_000 }),
      }),
    ]);
    expect(sources.map((source) => source.domain)).toEqual([
      "a.test",
      "b.test",
    ]);
  });

  it("carries the page's favicon from whichever piece stored one", () => {
    const sources = collageProvenance([
      piece({ id: "a", scrap: scrap({ ts: 1_000 }) }),
      piece({
        id: "b",
        scrap: scrap({ ts: 2_000, faviconUrl: "https://example.test/icon.png" }),
      }),
      piece({
        id: "c",
        scrap: scrap({
          pageUrl: "https://other.test/",
          domain: "other.test",
          ts: 3_000,
        }),
      }),
    ]);
    expect(sources[0].faviconUrl).toBe("https://example.test/icon.png");
    expect("faviconUrl" in sources[1]).toBe(false);
  });

  it("dedupes several pieces taken from one page and counts them", () => {
    const sources = collageProvenance([
      piece({ id: "a", scrap: scrap({ ts: 4_000 }) }),
      piece({ id: "b", scrap: scrap({ ts: 2_000 }) }),
      piece({ id: "c", scrap: scrap({ ts: 9_000 }) }),
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0].pieceCount).toBe(3);
    expect(sources[0].firstSeenAt).toBe(2_000);
  });

  it("separates pages that share a domain", () => {
    const sources = collageProvenance([
      piece({ id: "a", scrap: scrap({ pageUrl: "https://example.test/one" }) }),
      piece({ id: "b", scrap: scrap({ pageUrl: "https://example.test/two" }) }),
    ]);
    expect(sources).toHaveLength(2);
  });
});

describe("cropping a piece", () => {
  const half = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

  it("shrinks the visible box to the kept rectangle", () => {
    const cropped = applyCrop(piece({ x: 0, y: 0, width: 200, height: 100 }), half);
    expect(cropped).toMatchObject({ x: 50, y: 25, width: 100, height: 50 });
  });

  it("composes onto the source so a second crop still refers to the original", () => {
    const once = applyCrop(piece(), half);
    const twice = applyCrop(once, half);
    expect(twice.crop).toEqual({
      x: 0.375,
      y: 0.375,
      width: 0.25,
      height: 0.25,
    });
  });

  it("leaves the kept material where it sat on a rotated piece", () => {
    const original = piece({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 40,
    });
    const radians = (original.rotation * Math.PI) / 180;
    const keptCornerBefore = rotatePoint(
      { x: 50, y: 25 },
      { x: 100, y: 50 },
      radians,
    );
    const cropped = applyCrop(original, half);
    const keptCornerAfter = rotatePoint(
      { x: cropped.x, y: cropped.y },
      { x: cropped.x + cropped.width / 2, y: cropped.y + cropped.height / 2 },
      radians,
    );
    expect(keptCornerAfter.x).toBeCloseTo(keptCornerBefore.x);
    expect(keptCornerAfter.y).toBeCloseTo(keptCornerBefore.y);
  });

  it("restores the whole source around the same center", () => {
    const original = piece({ x: 0, y: 0, width: 200, height: 100 });
    const restored = clearCrop(applyCrop(original, half));
    expect(restored.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(restored.width).toBeCloseTo(200);
    expect(restored.height).toBeCloseTo(100);
    expect(restored.x + restored.width / 2).toBeCloseTo(100);
    expect(restored.y + restored.height / 2).toBeCloseTo(50);
  });

  it("refuses to restore a piece whose crop has no area", () => {
    expect(() =>
      clearCrop(piece({ crop: { x: 0, y: 0, width: 0, height: 1 } })),
    ).toThrow(/no area/);
  });
});

describe("a crop session", () => {
  const half = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

  it("opens on the piece's last crop rather than the whole image", () => {
    const cropped = applyCrop(piece({ x: 0, y: 0, width: 200, height: 100 }), half);
    expect(cropSessionStart(cropped)).toEqual(half);
  });

  it("opens on the whole image for a piece never cropped", () => {
    expect(cropSessionStart(piece())).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it("leaves the piece alone when it ends where it began", () => {
    const cropped = applyCrop(piece({ x: 0, y: 0, width: 200, height: 100 }), half);
    expect(commitCropSession(cropped, cropSessionStart(cropped))).toBe(cropped);
  });

  it("tightens a previous crop without moving the kept material", () => {
    const original = piece({ x: 0, y: 0, width: 200, height: 100 });
    const cropped = applyCrop(original, half);
    const tighter = commitCropSession(cropped, {
      x: 0.25,
      y: 0.25,
      width: 0.25,
      height: 0.5,
    });
    expect(tighter.crop).toEqual({ x: 0.25, y: 0.25, width: 0.25, height: 0.5 });
    expect(tighter).toMatchObject({ x: 50, y: 25, width: 50, height: 50 });
  });

  it("can be dragged back out to the whole image", () => {
    const original = piece({ x: 0, y: 0, width: 200, height: 100 });
    const restored = commitCropSession(applyCrop(original, half), {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(restored.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(restored.x).toBeCloseTo(0);
    expect(restored.y).toBeCloseTo(0);
    expect(restored.width).toBeCloseTo(200);
    expect(restored.height).toBeCloseTo(100);
  });
});

describe("stacking", () => {
  it("compacts z into a dense run in the current order", () => {
    const stacked = normalizeStack([
      piece({ id: "a", z: 40 }),
      piece({ id: "b", z: 2 }),
      piece({ id: "c", z: 17 }),
    ]);
    expect(stacked.map((item) => [item.id, item.z])).toEqual([
      ["b", 0],
      ["c", 1],
      ["a", 2],
    ]);
  });

  it("swaps a piece with the one above it", () => {
    const moved = movePieceForward(
      [piece({ id: "a", z: 0 }), piece({ id: "b", z: 1 })],
      "a",
    );
    expect(moved.find((item) => item.id === "a")?.z).toBe(1);
    expect(moved.find((item) => item.id === "b")?.z).toBe(0);
  });

  it("leaves the topmost piece alone", () => {
    const pieces = [piece({ id: "a", z: 0 }), piece({ id: "b", z: 1 })];
    expect(movePieceForward(pieces, "b").find((i) => i.id === "b")?.z).toBe(1);
    expect(movePieceBackward(pieces, "a").find((i) => i.id === "a")?.z).toBe(0);
  });

  it("refuses to restack a piece the collage does not hold", () => {
    expect(() => movePieceForward([piece({ id: "a" })], "ghost")).toThrow(
      /no piece ghost/,
    );
  });
});

describe("copying a collage", () => {
  const source: CollageRecord = {
    id: "collage_source",
    title: "  a good one  ",
    createdAt: 1_000,
    updatedAt: 2_000,
    frame: { width: 1500, height: 1000 },
    format: "postcard",
    paper: { color: "#c9a678", grain: true },
    pieces: [
      piece({ id: "piece_a", z: 0, x: 10, y: 20, rotation: 12 }),
      piece({
        id: "piece_b",
        z: 1,
        x: 30,
        y: 40,
        cutout: { method: "edge-color", tolerance: 0.2 },
      }),
    ],
    preview: {
      drawn: true as const,
      image: new Blob(["png"], { type: "image/png" }),
    },
  };
  const copy = duplicateCollage(source, 9_000);

  it("is a separate collage", () => {
    expect(copy.id).not.toBe(source.id);
    expect(copy.id.startsWith("collage_")).toBe(true);
  });

  it("says it is a copy", () => {
    expect(copy.title).toBe("a good one copy");
  });

  it("names an unnamed collage's copy", () => {
    expect(duplicateCollage({ ...source, title: "" }).title).toBe(
      "untitled collage copy",
    );
    expect(duplicateCollage({ ...source, title: "   " }).title).toBe(
      "untitled collage copy",
    );
  });

  it("is made now, not when the original was", () => {
    expect(copy.createdAt).toBe(9_000);
    expect(copy.updatedAt).toBe(9_000);
  });

  it("keeps the same size, paper and grain", () => {
    expect(copy.format).toBe(source.format);
    expect(copy.frame).toEqual(source.frame);
    expect(copy.paper).toEqual(source.paper);
  });

  it("holds the same arrangement, piece for piece", () => {
    expect(copy.pieces).toHaveLength(source.pieces.length);
    copy.pieces.forEach((piece, index) => {
      const original = source.pieces[index];
      expect(piece.x).toBe(original.x);
      expect(piece.y).toBe(original.y);
      expect(piece.width).toBe(original.width);
      expect(piece.height).toBe(original.height);
      expect(piece.rotation).toBe(original.rotation);
      expect(piece.z).toBe(original.z);
      expect(piece.crop).toEqual(original.crop);
      expect(piece.scrapId).toBe(original.scrapId);
    });
  });

  it("gives every piece an id of its own", () => {
    const ids = copy.pieces.map((piece) => piece.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const original of source.pieces) {
      expect(ids).not.toContain(original.id);
    }
  });

  it("shares no mutable object with the original", () => {
    expect(copy.frame).not.toBe(source.frame);
    expect(copy.paper).not.toBe(source.paper);
    copy.pieces.forEach((piece, index) => {
      expect(piece).not.toBe(source.pieces[index]);
      expect(piece.crop).not.toBe(source.pieces[index].crop);
    });
    expect(copy.pieces[1].cutout).not.toBe(source.pieces[1].cutout);
    expect(copy.pieces[1].cutout).toEqual(source.pieces[1].cutout);
  });

  it("carries the picture across, because the arrangement is the same", () => {
    expect(copy.preview.drawn).toBe(true);
    if (copy.preview.drawn && source.preview.drawn) {
      expect(copy.preview.image).toBe(source.preview.image);
    }
  });

  it("carries an absent picture across as absent", () => {
    const undrawn = duplicateCollage({
      ...source,
      preview: { drawn: false as const, reason: "not drawn yet" },
    });
    expect(undrawn.preview).toEqual({
      drawn: false,
      reason: "not drawn yet",
    });
  });

  it("leaves the original untouched", () => {
    expect(source.id).toBe("collage_source");
    expect(source.title).toBe("  a good one  ");
    expect(source.pieces[0].id).toBe("piece_a");
    expect(source.updatedAt).toBe(2_000);
  });
});
