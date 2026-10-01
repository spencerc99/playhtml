// ABOUTME: Tests where peek labels land and how pieces are tinted while peeking.
// ABOUTME: Every label stays inside the frame and clear of the others; near pieces differ in tint.

import { describe, expect, it } from "vitest";
import {
  PEEK_TINTS,
  pieceBounds,
  placeTags,
  tintPieces,
  type Rect,
  type TagRequest,
} from "../entrypoints/scraps/peekTags";

const FRAME: Rect = { x: 0, y: 0, width: 1000, height: 600 };

function request(pieceId: string, piece: Rect, width = 120, height = 30): TagRequest {
  return { pieceId, piece, width, height };
}

function inside(tag: Rect, bounds: Rect): boolean {
  return (
    tag.x >= bounds.x &&
    tag.y >= bounds.y &&
    tag.x + tag.width <= bounds.x + bounds.width &&
    tag.y + tag.height <= bounds.y + bounds.height
  );
}

function overlapping(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

describe("pieceBounds", () => {
  it("is the piece's own box when it is upright", () => {
    expect(pieceBounds({ x: 10, y: 20, width: 100, height: 50, rotation: 0 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it("covers a quarter-turned piece standing on end", () => {
    const bounds = pieceBounds({ x: 0, y: 0, width: 100, height: 50, rotation: 90 });
    expect(bounds.x).toBeCloseTo(25);
    expect(bounds.y).toBeCloseTo(-25);
    expect(bounds.width).toBeCloseTo(50);
    expect(bounds.height).toBeCloseTo(100);
  });
});

describe("placeTags", () => {
  it("sets a label above its piece's top-left when there is room", () => {
    const [tag] = placeTags([request("a", { x: 200, y: 200, width: 100, height: 100 })], FRAME);
    expect(tag).toMatchObject({ x: 200, y: 170 });
  });

  it("goes below a piece that touches the top of the frame", () => {
    const [tag] = placeTags([request("a", { x: 200, y: 0, width: 100, height: 100 })], FRAME);
    expect(tag).toMatchObject({ x: 200, y: 100 });
  });

  it("moves inside the visible part of a piece hanging off the frame", () => {
    // Off the top and the left, and as tall as the frame, so neither above nor
    // below fits.
    const [tag] = placeTags(
      [request("a", { x: -80, y: -50, width: 300, height: 700 })],
      FRAME,
    );
    expect(tag).toMatchObject({ x: 0, y: 0 });
    expect(inside(tag, FRAME)).toBe(true);
  });

  it("keeps a label in the frame for a piece almost entirely off it", () => {
    const [tag] = placeTags(
      [request("a", { x: 960, y: 580, width: 200, height: 200 })],
      FRAME,
    );
    expect(inside(tag, FRAME)).toBe(true);
  });

  it("pulls in the label of a piece wholly outside the frame", () => {
    const [tag] = placeTags(
      [request("a", { x: 1200, y: 800, width: 100, height: 100 })],
      FRAME,
    );
    expect(inside(tag, FRAME)).toBe(true);
  });

  it("gives stacked pieces labels that neither overlap nor leave the frame", () => {
    const pile = Array.from({ length: 6 }, (_, index) =>
      request(`p${index}`, { x: 300 + index * 6, y: 250 + index * 6, width: 150, height: 120 }),
    );
    const tags = placeTags(pile, FRAME);
    for (const tag of tags) expect(inside(tag, FRAME)).toBe(true);
    for (let a = 0; a < tags.length; a += 1) {
      for (let b = a + 1; b < tags.length; b += 1) {
        expect(overlapping(tags[a], tags[b])).toBe(false);
      }
    }
  });

  it("places the same pieces the same way every time", () => {
    const pile = [
      request("a", { x: 0, y: 0, width: 200, height: 200 }),
      request("b", { x: 20, y: 20, width: 200, height: 200 }),
    ];
    expect(placeTags(pile, FRAME)).toEqual(placeTags(pile, FRAME));
  });
});

describe("tintPieces", () => {
  const box = (x: number, y: number): Rect => ({ x, y, width: 100, height: 100 });

  it("gives overlapping and nearby pieces different tints", () => {
    const tints = tintPieces(
      [
        { id: "a", bounds: box(0, 0) },
        { id: "b", bounds: box(50, 50) },
        { id: "c", bounds: box(120, 0) },
      ],
      new Map(),
      40,
    );
    expect(tints.get("a")).not.toBe(tints.get("b"));
    expect(tints.get("a")).not.toBe(tints.get("c"));
    expect(tints.get("b")).not.toBe(tints.get("c"));
    for (const tint of tints.values()) expect(PEEK_TINTS).toContain(tint);
  });

  it("counts pieces within the gap as near", () => {
    const pair = [
      { id: "a", bounds: box(0, 0) },
      { id: "b", bounds: box(160, 0) },
    ];
    const close = tintPieces(pair, new Map(), 80);
    expect(close.get("a")).not.toBe(close.get("b"));
    const apart = tintPieces(pair, new Map(), 40);
    expect(apart.get("a")).toBe(apart.get("b"));
  });

  it("lets pieces far apart share a tint", () => {
    const tints = tintPieces(
      [
        { id: "a", bounds: box(0, 0) },
        { id: "b", bounds: box(600, 400) },
      ],
      new Map(),
      40,
    );
    expect(tints.get("a")).toBe(tints.get("b"));
  });

  it("keeps the tints already given while a piece moves next to another", () => {
    const first = tintPieces(
      [
        { id: "a", bounds: box(0, 0) },
        { id: "b", bounds: box(600, 400) },
      ],
      new Map(),
      40,
    );
    const moved = tintPieces(
      [
        { id: "a", bounds: box(0, 0) },
        { id: "b", bounds: box(20, 20) },
        { id: "c", bounds: box(10, 10) },
      ],
      first,
      40,
    );
    expect(moved.get("a")).toBe(first.get("a"));
    expect(moved.get("b")).toBe(first.get("b"));
    // The new piece still avoids the tints around it.
    expect(moved.get("c")).not.toBe(moved.get("a"));
  });

  it("uses the least-used tint when every tint is taken nearby", () => {
    const crowd = PEEK_TINTS.map((_, index) => ({ id: `n${index}`, bounds: box(index * 5, 0) }));
    const tints = tintPieces([...crowd, { id: "late", bounds: box(2, 2) }], new Map(), 40);
    expect(PEEK_TINTS).toContain(tints.get("late"));
  });
});
