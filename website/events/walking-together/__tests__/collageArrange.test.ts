// ABOUTME: Tests the collaging effect that gathers every scrap into the captured shape.
// ABOUTME: Covers polygon helpers, density, spread, and the no-shape fallback.

import { describe, it, expect } from "vitest";
import {
  arrangeIntoShape,
  defaultShape,
  pointInPolygon,
  polygonArea,
  type Piece,
  type Pieces,
} from "../collage/pieces";

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const piece = (id: string, i: number): Piece => ({
  id,
  src: `https://example.com/${id}.png`,
  pageUrl: "",
  alt: "",
  placedByPid: `p${i % 3}`,
  placedByName: "someone",
  placedByColor: "#888888",
  x: 0.05,
  y: 0.05,
  width: 0.16,
  aspect: 0.75,
  rotation: 0,
  z: i + 1,
  placedAt: i,
});

const many = (n: number): Pieces =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`s${i}`, piece(`s${i}`, i)]),
  );

const square = [
  { x: 0.25, y: 0.25, color: "#000" },
  { x: 0.75, y: 0.25, color: "#000" },
  { x: 0.75, y: 0.75, color: "#000" },
  { x: 0.25, y: 0.75, color: "#000" },
];

describe("polygon helpers", () => {
  it("finds points inside and outside", () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 0.1, y: 0.5 }, square)).toBe(false);
  });

  it("measures area", () => {
    expect(polygonArea(square)).toBeCloseTo(0.25);
  });
});

describe("arrangeIntoShape", () => {
  it("places every scrap inside the shape", () => {
    const layout = arrangeIntoShape(many(20), square, 1, seeded(1));
    expect(Object.keys(layout)).toHaveLength(20);
    for (const t of Object.values(layout)) {
      expect(pointInPolygon(t, square)).toBe(true);
    }
  });

  it("lays down more paper than the shape's area, so scraps overlap", () => {
    const pieces = many(20);
    const layout = arrangeIntoShape(pieces, square, 1, seeded(2));
    const paper = Object.entries(layout).reduce(
      (sum, [id, t]) => sum + t.width * t.width * pieces[id].aspect,
      0,
    );
    expect(paper).toBeGreaterThan(polygonArea(square));
  });

  it("spreads scraps across the shape instead of clumping", () => {
    const layout = Object.values(arrangeIntoShape(many(16), square, 1, seeded(3)));
    const quadrants = new Set(
      layout.map((t) => `${t.x < 0.5 ? "l" : "r"}${t.y < 0.5 ? "t" : "b"}`),
    );
    expect(quadrants.size).toBe(4);
  });

  it("gives each scrap its own stacking order above the current stack", () => {
    const pieces = many(10);
    const zs = Object.values(arrangeIntoShape(pieces, square, 1, seeded(4))).map(
      (t) => t.z,
    );
    expect(new Set(zs).size).toBe(10);
    expect(Math.min(...zs)).toBeGreaterThan(10);
  });

  it("falls back to a centered oval when no shape was captured", () => {
    const oval = defaultShape(16 / 9);
    const layout = arrangeIntoShape(many(8), [], 16 / 9, seeded(5));
    for (const t of Object.values(layout)) {
      expect(pointInPolygon(t, oval)).toBe(true);
    }
  });

  it("returns nothing for an empty table", () => {
    expect(arrangeIntoShape({}, square, 1, seeded(6))).toEqual({});
  });
});
