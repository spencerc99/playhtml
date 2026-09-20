// ABOUTME: Tests collage record parsing, stacking order, and source-page provenance.
// ABOUTME: Guards that a stored collage round-trips and that provenance dedupes by page.

import { describe, expect, it } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  collageProvenance,
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
    ...overrides,
  };
}

function record(pieces: CollagePiece[]): CollageRecord {
  return {
    id: "collage_1",
    title: "A collage",
    createdAt: 5_000,
    updatedAt: 6_000,
    frame: { width: 1200, height: 800 },
    pieces,
    preview: new Blob(["png"], { type: "image/png" }),
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

  it("refuses a record with no baked preview", () => {
    const { preview: _dropped, ...withoutPreview } = record([piece()]);
    expect(() => parseCollageRecord(withoutPreview)).toThrow(/baked preview/);
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
