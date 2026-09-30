// ABOUTME: Tests which piece a press reaches when several are stacked at a point.
// ABOUTME: Pure geometry, so click, drag and deep-select are checked without a browser.

import { describe, expect, it } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  deeperPieceAt,
  neighborInStack,
  pieceHoldsPoint,
  piecesUnder,
  planPress,
  spreadTags,
  stackOrder,
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

describe("drawing order", () => {
  it("draws back to front by z", () => {
    expect(stackOrder([top, bottom, middle]).map((p) => p.id)).toEqual([
      "bottom",
      "middle",
      "top",
    ]);
  });

  it("puts the later of two equal pieces in front, as the page does", () => {
    // Two pieces can share a z in a record written before stacks were
    // renumbered; the page then draws the later element over the earlier.
    const first = piece({ id: "first", z: 1 });
    const second = piece({ id: "second", z: 1 });
    expect(stackOrder([first, second]).map((p) => p.id)).toEqual([
      "first",
      "second",
    ]);
    expect(topPieceUnder([first, second], inThePile)?.id).toBe("second");
    expect(
      piecesUnder([first, second], inThePile).map((p) => p.id),
    ).toEqual(["second", "first"]);
  });
});

describe("a plain press", () => {
  it("takes the frontmost piece when nothing is in hand", () => {
    expect(planPress(pile, inThePile, null, false)).toEqual({
      selectOnDown: "top",
      dragId: "top",
      selectOnClick: "top",
    });
  });

  it("steps one piece down on each click of the piece in hand, wrapping", () => {
    // A click on the selection reaches into the pile without a modifier.
    expect(planPress(pile, inThePile, "top", false)?.selectOnClick).toBe(
      "middle",
    );
    expect(planPress(pile, inThePile, "middle", false)?.selectOnClick).toBe(
      "bottom",
    );
    expect(planPress(pile, inThePile, "bottom", false)?.selectOnClick).toBe(
      "top",
    );
  });

  it("never changes the selection when the press on the piece in hand drags", () => {
    // Clicking the top piece and pressing again to drag it must keep it.
    const plan = planPress(pile, inThePile, "top", false);
    expect(plan?.selectOnDown).toBe("top");
    expect(plan?.dragId).toBe("top");
  });

  it("drags the piece in hand even where another lies on top of it", () => {
    const plan = planPress(pile, inThePile, "bottom", false);
    expect(plan?.selectOnDown).toBe("bottom");
    expect(plan?.dragId).toBe("bottom");
  });

  it("takes the frontmost piece when the selection is elsewhere", () => {
    expect(planPress(pile, inThePile, "apart", false)).toEqual({
      selectOnDown: "top",
      dragId: "top",
      selectOnClick: "top",
    });
  });

  it("plans nothing on bare frame", () => {
    expect(planPress(pile, { x: 900, y: 900 }, "top", false)).toBeNull();
  });

  it("respects rotation when choosing what is in front", () => {
    // A turned piece in front whose rotated box leaves this corner uncovered.
    const turned = piece({ id: "turned", z: 9, rotation: 45 });
    const plain = piece({ id: "plain", z: 0 });
    expect(planPress([plain, turned], { x: 3, y: 3 }, null, false)?.dragId).toBe(
      "plain",
    );
    expect(
      planPress([plain, turned], { x: 50, y: 50 }, null, false)?.dragId,
    ).toBe("turned");
  });
});

describe("a deep press (cmd or ctrl)", () => {
  it("takes the next piece down and wraps back to the front", () => {
    expect(planPress(pile, inThePile, "top", true)?.selectOnDown).toBe("middle");
    expect(planPress(pile, inThePile, "middle", true)?.selectOnDown).toBe(
      "bottom",
    );
    expect(planPress(pile, inThePile, "bottom", true)?.selectOnDown).toBe("top");
  });

  it("drags and keeps the piece it reached", () => {
    expect(planPress(pile, inThePile, "top", true)).toEqual({
      selectOnDown: "middle",
      dragId: "middle",
      selectOnClick: "middle",
    });
  });

  it("starts at the front when the selection is not under the point", () => {
    expect(deeperPieceAt(pile, inThePile, "apart")).toBe("top");
    expect(deeperPieceAt(pile, inThePile, null)).toBe("top");
  });

  it("never reorders the stack", () => {
    const before = pile.map((p) => ({ id: p.id, z: p.z }));
    planPress(pile, inThePile, "top", true);
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
