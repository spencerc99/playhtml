// ABOUTME: Tests the table collage piece helpers: ordering, placement, and gesture math.
// ABOUTME: Also covers the shape-template conversion from cursor positions.

import { describe, it, expect } from "vitest";
import {
  domainOf,
  initialWidth,
  isOnTop,
  makePiece,
  MAX_PIECE_WIDTH,
  MIN_PIECE_WIDTH,
  movedTransform,
  normalizeDegrees,
  orderAroundCentroid,
  piecesOf,
  remoteDragTransforms,
  rotateResizeTransform,
  sortedPieces,
  sourceDomain,
  templatePointsFromCursors,
  topZ,
  transformChanged,
  type Piece,
  type Pieces,
} from "../collage/pieces";

const piece = (id: string, overrides: Partial<Piece> = {}): Piece => ({
  id,
  src: `https://img.example.com/${id}.png`,
  pageUrl: "",
  alt: "",
  placedByPid: "pk_a",
  placedByName: "a",
  placedByColor: "#f00",
  x: 0.5,
  y: 0.5,
  width: 0.16,
  aspect: 1,
  rotation: 0,
  z: 1,
  placedAt: 0,
  ...overrides,
});

const map = (...pieces: Piece[]): Pieces =>
  Object.fromEntries(pieces.map((p) => [p.id, p]));

describe("piece ordering and limits", () => {
  it("piecesOf tolerates data without a pieces map", () => {
    expect(piecesOf(undefined)).toEqual({});
    expect(piecesOf({})).toEqual({});
  });

  it("sorts by z, then by placement time", () => {
    const pieces = map(
      piece("c", { z: 2, placedAt: 1 }),
      piece("a", { z: 1, placedAt: 5 }),
      piece("b", { z: 2, placedAt: 0 }),
    );
    expect(sortedPieces(pieces).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("topZ is 0 for an empty table and the max otherwise", () => {
    expect(topZ({})).toBe(0);
    expect(topZ(map(piece("a", { z: 3 }), piece("b", { z: 7 })))).toBe(7);
  });

  it("isOnTop only when strictly above every other piece", () => {
    const pieces = map(piece("a", { z: 3 }), piece("b", { z: 3 }));
    expect(isOnTop(pieces, "a")).toBe(false);
    expect(isOnTop(map(piece("a", { z: 4 }), piece("b", { z: 3 })), "a")).toBe(
      true,
    );
    expect(isOnTop(pieces, "missing")).toBe(false);
  });
});

describe("makePiece", () => {
  const placer = { pid: "pk_a", name: "alice", color: "#0a0" };
  const options = { id: "new", now: 42, random: () => 0.5 };

  it("lands on top, at the point, with the placer attached", () => {
    const p = makePiece(
      { src: "https://x.test/a.png", aspect: 0.5 },
      placer,
      { x: 0.25, y: 0.75 },
      map(piece("a", { z: 9 })),
      16 / 9,
      options,
    );
    expect(p).toMatchObject({
      id: "new",
      x: 0.25,
      y: 0.75,
      z: 10,
      placedByPid: "pk_a",
      placedByName: "alice",
      placedByColor: "#0a0",
      placedAt: 42,
      aspect: 0.5,
      pageUrl: "",
      rotation: 0,
    });
  });

  it("clamps the point onto the table and falls back on a bad aspect", () => {
    const p = makePiece(
      { src: "https://x.test/a.png", aspect: NaN },
      placer,
      { x: -1, y: 3 },
      {},
      1,
      options,
    );
    expect(p.x).toBe(0);
    expect(p.y).toBe(1);
    expect(p.aspect).toBeGreaterThan(0);
  });

  it("tilts a little either way", () => {
    const lo = makePiece({ src: "s", aspect: 1 }, placer, { x: 0, y: 0 }, {}, 1, {
      ...options,
      random: () => 0,
    });
    const hi = makePiece({ src: "s", aspect: 1 }, placer, { x: 0, y: 0 }, {}, 1, {
      ...options,
      random: () => 0.999,
    });
    expect(lo.rotation).toBe(-6);
    expect(hi.rotation).toBeLessThanOrEqual(6);
    expect(hi.rotation).toBeGreaterThan(5);
  });

  it("shrinks tall images so they fit on the table", () => {
    const wide = initialWidth(0.5, 16 / 9);
    const tall = initialWidth(4, 16 / 9);
    expect(wide).toBeCloseTo(0.16);
    expect(tall).toBeLessThan(wide);
    // Height as a fraction of the table stays within 40%.
    expect(tall * 4 * (16 / 9)).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(initialWidth(1000, 1)).toBe(MIN_PIECE_WIDTH);
  });
});

describe("gesture math", () => {
  const start = { x: 0.5, y: 0.5, width: 0.2, rotation: 10 };

  it("moves by a relative delta and keeps the center on the table", () => {
    expect(movedTransform(start, { dx: 0.1, dy: -0.2 })).toMatchObject({
      x: 0.6,
      y: 0.3,
      width: 0.2,
      rotation: 10,
    });
    expect(movedTransform(start, { dx: 2, dy: -2 })).toMatchObject({
      x: 1,
      y: 0,
    });
  });

  it("turning the corner a quarter turn at the same distance rotates 90deg", () => {
    const t = rotateResizeTransform(
      start,
      { x: 100, y: 100 },
      { x: 150, y: 100 },
      { x: 100, y: 150 },
    );
    expect(t.rotation).toBeCloseTo(100);
    expect(t.width).toBeCloseTo(0.2);
    expect(t.x).toBe(0.5);
  });

  it("pulling the corner twice as far doubles the width without turning", () => {
    const t = rotateResizeTransform(
      start,
      { x: 0, y: 0 },
      { x: 30, y: 40 },
      { x: 60, y: 80 },
    );
    expect(t.width).toBeCloseTo(0.4);
    expect(t.rotation).toBeCloseTo(10);
  });

  it("clamps size and ignores a pointer on the center", () => {
    const huge = rotateResizeTransform(
      start,
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 500, y: 500 },
    );
    expect(huge.width).toBe(MAX_PIECE_WIDTH);
    expect(
      rotateResizeTransform(start, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }),
    ).toEqual(start);
  });

  it("normalizes angles into (-180, 180]", () => {
    expect(normalizeDegrees(190)).toBe(-170);
    expect(normalizeDegrees(-190)).toBe(170);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(540)).toBe(180);
  });

  it("transformChanged ignores float noise", () => {
    expect(transformChanged(start, { ...start, x: 0.50000001 })).toBe(false);
    expect(transformChanged(start, { ...start, rotation: 11 })).toBe(true);
  });
});

describe("domains", () => {
  it("strips www and tolerates junk", () => {
    expect(domainOf("https://www.example.com/a")).toBe("example.com");
    expect(domainOf("not a url")).toBe("");
    expect(domainOf(undefined)).toBe("");
  });

  it("prefers the page over the image host", () => {
    expect(
      sourceDomain({ pageUrl: "https://blog.test/post", src: "https://cdn.test/x.png" }),
    ).toBe("blog.test");
    expect(sourceDomain({ pageUrl: "", src: "https://cdn.test/x.png" })).toBe(
      "cdn.test",
    );
  });
});

describe("shape template", () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };

  it("converts cursors to table-relative points, skipping the admin and off-table cursors", () => {
    const points = templatePointsFromCursors(
      [
        { key: "a", x: 110, y: 70, color: "#f00" },
        { key: "admin", x: 50, y: 50, color: "#fa0" },
        { key: "off", x: 500, y: 50, color: "#00f" },
      ],
      rect,
      "admin",
    );
    expect(points).toEqual({ a: { x: 0.5, y: 0.5, color: "#f00" } });
  });

  it("returns nothing for a collapsed table", () => {
    expect(
      templatePointsFromCursors(
        [{ key: "a", x: 0, y: 0, color: "#f00" }],
        { left: 0, top: 0, width: 0, height: 0 },
        undefined,
      ),
    ).toEqual({});
  });

  it("orders a ring of points by angle so the outline doesn't cross itself", () => {
    const right = { x: 0.7, y: 0.5, color: "c" };
    const bottom = { x: 0.5, y: 0.7, color: "c" };
    const left = { x: 0.3, y: 0.5, color: "c" };
    const top = { x: 0.5, y: 0.3, color: "c" };
    const ordered = orderAroundCentroid([right, left, top, bottom]);
    // Sorted by screen angle (y grows downward); left sits at exactly 180deg.
    expect(ordered).toEqual([top, right, bottom, left]);
  });

  it("leaves fewer than three points as they are", () => {
    const pts = [
      { x: 0, y: 0, color: "c" },
      { x: 1, y: 1, color: "c" },
    ];
    expect(orderAroundCentroid(pts)).toEqual(pts);
  });
});

describe("remote drag previews", () => {
  it("collects other people's in-progress drags and skips mine", () => {
    const transform = { x: 0.1, y: 0.2, width: 0.3, rotation: 4 };
    expect(
      remoteDragTransforms([
        { user: { isMe: false }, live: { drag: { id: "p1", transform } } },
        { user: { isMe: true }, live: { drag: { id: "p2", transform } } },
        { user: { isMe: false }, live: { drag: null } },
        { user: { isMe: false }, live: undefined },
      ]),
    ).toEqual({ p1: transform });
  });
});
