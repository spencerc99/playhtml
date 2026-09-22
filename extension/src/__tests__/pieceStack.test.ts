// ABOUTME: Tests which piece a click reaches when several are stacked at a point.
// ABOUTME: Pure geometry, so the cycling order is checked without a browser.

import { describe, expect, it } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  neighborInStack,
  nextSelectionAt,
  pieceHoldsPoint,
  piecesUnder,
  spreadTags,
  topPieceUnder,
  type TagBox,
} from "../entrypoints/scraps/pieceStack";
import type { CollagePiece } from "../entrypoints/scraps/collageRecord";

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

function piece(over: Partial<CollagePiece> & { id: string; z: number }): CollagePiece {
  return {
    scrapId: "scrap",
    scrap,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
    ...over,
  };
}

/** Three pieces piled on the same spot, plus one off on its own. */
const bottom = piece({ id: "bottom", z: 0 });
const middle = piece({ id: "middle", z: 1 });
const top = piece({ id: "top", z: 2 });
const apart = piece({ id: "apart", z: 3, x: 400, y: 400 });
const pile = [bottom, middle, top, apart];
const inThePile = { x: 50, y: 50 };

describe("what lies under a point", () => {
  it("finds a piece the point is inside", () => {
    expect(pieceHoldsPoint(bottom, inThePile)).toBe(true);
  });

  it("does not find one the point misses", () => {
    expect(pieceHoldsPoint(apart, inThePile)).toBe(false);
  });

  it("respects a piece's rotation", () => {
    const turned = piece({ id: "turned", z: 0, rotation: 45 });
    // Just outside a corner of the unrotated box, which the turn moves away.
    expect(pieceHoldsPoint(turned, { x: 3, y: 3 })).toBe(false);
    expect(pieceHoldsPoint(turned, { x: 50, y: 50 })).toBe(true);
  });

  it("lists the stack frontmost first", () => {
    expect(piecesUnder(pile, inThePile).map((p) => p.id)).toEqual([
      "top",
      "middle",
      "bottom",
    ]);
  });

  it("names the frontmost piece on its own", () => {
    expect(topPieceUnder(pile, inThePile)?.id).toBe("top");
    expect(topPieceUnder(pile, { x: 900, y: 900 })).toBeNull();
  });
});

describe("clicking the same spot again", () => {
  it("takes the top piece first", () => {
    expect(nextSelectionAt(pile, inThePile, null)).toBe("top");
  });

  it("walks down through the stack and wraps", () => {
    expect(nextSelectionAt(pile, inThePile, "top")).toBe("middle");
    expect(nextSelectionAt(pile, inThePile, "middle")).toBe("bottom");
    expect(nextSelectionAt(pile, inThePile, "bottom")).toBe("top");
  });

  it("starts again at the front when the selection is elsewhere", () => {
    expect(nextSelectionAt(pile, inThePile, "apart")).toBe("top");
  });

  it("selects nothing on bare frame", () => {
    expect(nextSelectionAt(pile, { x: 900, y: 900 }, "top")).toBeNull();
  });

  it("never reorders the stack", () => {
    const before = pile.map((p) => ({ id: p.id, z: p.z }));
    nextSelectionAt(pile, inThePile, "top");
    expect(pile.map((p) => ({ id: p.id, z: p.z }))).toEqual(before);
  });
});

describe("stepping through the stack from the keyboard", () => {
  it("goes one below and one above", () => {
    expect(neighborInStack(pile, "apart", "below")).toBe("top");
    expect(neighborInStack(pile, "top", "below")).toBe("middle");
    expect(neighborInStack(pile, "middle", "above")).toBe("top");
  });

  it("wraps at either end", () => {
    expect(neighborInStack(pile, "bottom", "below")).toBe("apart");
    expect(neighborInStack(pile, "apart", "above")).toBe("bottom");
  });

  it("takes the front piece when nothing is selected", () => {
    expect(neighborInStack(pile, null, "below")).toBe("apart");
  });

  it("has nothing to step to on an empty collage", () => {
    expect(neighborInStack([], null, "below")).toBeNull();
  });
});

describe("keeping two source tags off each other", () => {
  const tag = (pieceId: string, x: number, y: number): TagBox => ({
    pieceId,
    x,
    y,
    width: 80,
    height: 14,
  });

  it("leaves tags that do not touch where they are", () => {
    const spread = spreadTags([tag("a", 0, 0), tag("b", 200, 200)]);
    expect(spread.map((t) => t.y)).toEqual([0, 200]);
  });

  it("drops a tag below the one it would cover", () => {
    const spread = spreadTags([tag("a", 0, 0), tag("b", 10, 4)]);
    expect(spread[0].y).toBe(0);
    expect(spread[1].y).toBe(14);
  });

  it("keeps dropping through a whole pile", () => {
    const spread = spreadTags([
      tag("a", 0, 0),
      tag("b", 0, 2),
      tag("c", 0, 4),
    ]);
    expect(spread.map((t) => t.y)).toEqual([0, 14, 28]);
  });

  it("leaves no two tags overlapping", () => {
    const spread = spreadTags([
      tag("a", 0, 0),
      tag("b", 5, 1),
      tag("c", 10, 2),
      tag("d", 15, 3),
    ]);
    for (let i = 0; i < spread.length; i += 1) {
      for (let j = i + 1; j < spread.length; j += 1) {
        const a = spread[i];
        const b = spread[j];
        const hit =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(hit).toBe(false);
      }
    }
  });

  it("keeps every tag it was given, in order", () => {
    const spread = spreadTags([tag("a", 0, 0), tag("b", 0, 2)]);
    expect(spread.map((t) => t.pieceId)).toEqual(["a", "b"]);
  });
});
