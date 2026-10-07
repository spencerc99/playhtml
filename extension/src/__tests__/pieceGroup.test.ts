// ABOUTME: Tests arrangement edits made to several collage pieces at once.
// ABOUTME: Restacking a group must keep the order its pieces had among themselves.

import { describe, expect, it } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import type { CollagePiece } from "../entrypoints/scraps/collageRecord";
import {
  copiesOnTop,
  moveGroupBackward,
  moveGroupForward,
  moveGroupToBack,
  moveGroupToFront,
  piecesById,
  removePieces,
  replacePieces,
} from "../entrypoints/scraps/pieceGroup";
import { stackOrder } from "../entrypoints/scraps/pieceStack";

const scrap: ScrapItem = {
  id: "scrap",
  key: "scrap",
  kind: "image",
  src: "https://example.test/a.png",
  naturalWidth: 100,
  naturalHeight: 100,
  pageTitle: "A page",
  domain: "example.test",
  pageUrl: "https://example.test/a",
  ts: 0,
};

function piece(id: string, z: number): CollagePiece {
  return {
    id,
    scrapId: "scrap",
    scrap,
    x: z * 10,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    z,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
  };
}

/** a at the back through e at the front. */
const stack = ["a", "b", "c", "d", "e"].map((id, z) => piece(id, z));

function order(pieces: readonly CollagePiece[]): string {
  return stackOrder(pieces)
    .map((item) => item.id)
    .join("");
}

describe("restacking several pieces", () => {
  it("brings each one forward past its unchosen neighbour", () => {
    expect(order(moveGroupForward(stack, ["a", "c"]))).toBe("badce");
  });

  it("keeps a run already at the front where it is", () => {
    expect(order(moveGroupForward(stack, ["d", "e"]))).toBe("abcde");
    expect(order(moveGroupForward(stack, ["c", "e"]))).toBe("abdce");
  });

  it("sends each one back past its unchosen neighbour", () => {
    expect(order(moveGroupBackward(stack, ["c", "e"]))).toBe("acbed");
    expect(order(moveGroupBackward(stack, ["a", "b", "d"]))).toBe("abdce");
  });

  it("lifts them to the front or the back in the order they had", () => {
    expect(order(moveGroupToFront(stack, ["d", "b"]))).toBe("acebd");
    expect(order(moveGroupToBack(stack, ["d", "b"]))).toBe("bdace");
  });

  it("numbers the stack from zero after any restack", () => {
    const zs = moveGroupForward(stack, ["a"]).map((item) => item.z).sort();
    expect(zs).toEqual([0, 1, 2, 3, 4]);
  });

  it("matches a single piece's step when one is chosen", () => {
    expect(order(moveGroupForward(stack, ["b"]))).toBe("acbde");
    expect(order(moveGroupBackward(stack, ["b"]))).toBe("bacde");
  });
});

describe("removing, replacing and copying several pieces", () => {
  it("takes the chosen pieces out and closes the stack", () => {
    const left = removePieces(stack, ["b", "d"]);
    expect(order(left)).toBe("ace");
    expect(left.map((item) => item.z)).toEqual([0, 1, 2]);
  });

  it("puts changed pieces back in their places", () => {
    const moved = { ...stack[2], x: 999 };
    const next = replacePieces(stack, [moved]);
    expect(next[2].x).toBe(999);
    expect(next[0]).toBe(stack[0]);
  });

  it("refuses to put back a piece the collage does not have", () => {
    expect(() => replacePieces(stack, [piece("stranger", 9)])).toThrow(
      /stranger/,
    );
  });

  it("finds pieces back to front and names any that are missing", () => {
    expect(piecesById(stack, ["e", "a"]).map((item) => item.id)).toEqual([
      "a",
      "e",
    ]);
    expect(() => piecesById(stack, ["a", "zz"])).toThrow(/zz/);
  });

  it("lays copies on top in the order the originals had", () => {
    let next = 0;
    const copies = copiesOnTop(stack, [stack[3], stack[1]], 24, () => {
      next += 1;
      return `copy${next}`;
    });
    expect(copies.map((item) => [item.id, item.z, item.x])).toEqual([
      ["copy1", 5, 10 + 24],
      ["copy2", 6, 30 + 24],
    ]);
    expect(copies[0].scrapId).toBe("scrap");
  });
});
