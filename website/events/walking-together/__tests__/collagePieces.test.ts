// ABOUTME: Tests the table collage piece helpers: ordering, domains, and live drafts.
// ABOUTME: Also covers the shape-template conversion from cursor positions.

import { describe, it, expect } from "vitest";
import {
  domainOf,
  orderAroundCentroid,
  pageLink,
  piecesOf,
  remoteDrafts,
  sortedPieces,
  sourceDomain,
  templatePointsFromCursors,
  topZ,
  type Piece,
  type Pieces,
  safePieces,
  MAX_TABLE_PIECES,
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
});

describe("domains", () => {
  it("keeps the web page a scrap came from", () => {
    expect(pageLink("https://blog.example.com/posts/1?page=2")).toBe(
      "https://blog.example.com/posts/1?page=2",
    );
    expect(pageLink("https://blog.example.com")).toBe("https://blog.example.com/");
    expect(pageLink("javascript:alert(1)")).toBe("");
    expect(pageLink(undefined)).toBe("");
  });

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

describe("remote drafts", () => {
  it("lays other people's changes over the stored pieces and skips mine", () => {
    const stored = { p1: piece("p1", { x: 0.5, y: 0.5 }) };
    expect(
      remoteDrafts(
        [
          { user: { isMe: false }, live: { draft: [{ id: "p1", set: { x: 0.1 } }] } },
          { user: { isMe: true }, live: { draft: [{ id: "p1", set: { y: 0.9 } }] } },
          { user: { isMe: false }, live: { draft: null } },
          { user: { isMe: false }, live: undefined },
        ],
        stored,
      ),
    ).toEqual({ p1: { ...stored.p1, x: 0.1 } });
  });

  it("keeps a field someone else changed while the drag is going", () => {
    // The stored piece already has another person's new turn.
    const stored = { p1: piece("p1", { rotation: 45 }) };
    const drafts = remoteDrafts(
      [{ user: { isMe: false }, live: { draft: [{ id: "p1", set: { x: 0.2 }, unset: ["crop"] }] } }],
      stored,
    );
    expect(drafts.p1.rotation).toBe(45);
    expect(drafts.p1.x).toBe(0.2);
  });

  it("shows a piece new to the table whole", () => {
    const fresh = piece("p9");
    expect(
      remoteDrafts([{ user: { isMe: false }, live: { draft: [{ id: "p9", set: fresh }] } }], {}),
    ).toEqual({ p9: fresh });
  });

  it("skips presence from an older page", () => {
    const old = { drag: { id: "p1" } } as unknown as { draft: null };
    const wholePieces = { draft: [piece("p1")] } as unknown as { draft: null };
    expect(remoteDrafts([{ user: { isMe: false }, live: old }], {})).toEqual({});
    expect(remoteDrafts([{ user: { isMe: false }, live: wholePieces }], {})).toEqual({});
  });
});

describe("safePieces", () => {
  const good = {
    id: "a",
    src: "https://example.com/a.png",
    pageUrl: "https://example.com/page",
    alt: "a",
    placedByPid: "p",
    placedByName: "pat",
    placedByColor: "#ff0000",
    x: 0.5,
    y: 0.5,
    width: 0.2,
    aspect: 1,
    rotation: 0,
    z: 1,
    placedAt: 1,
  };

  it("keeps a well-formed piece unchanged", () => {
    expect(safePieces({ a: good }).a).toEqual(good);
  });

  it("drops pieces that aren't web images and repairs bad fields", () => {
    const safe = safePieces({
      js: { ...good, src: "javascript:alert(1)" },
      bad: {
        ...good,
        x: Number.NaN,
        pageUrl: "javascript:x",
        placedByColor: "red;}",
        width: 99,
      },
      junk: "nope",
    });
    expect(Object.keys(safe)).toEqual(["bad"]);
    expect(safe.bad.x).toBe(0.5);
    expect(safe.bad.pageUrl).toBe("");
    expect(safe.bad.placedByColor).toBe("#888888");
    expect(safe.bad.width).toBe(0.7);
  });

  it("caps how many pieces a table shows", () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < MAX_TABLE_PIECES + 10; i++)
      many[`p${i}`] = { ...good, id: `p${i}` };
    expect(Object.keys(safePieces(many))).toHaveLength(MAX_TABLE_PIECES);
  });
});
