// ABOUTME: Tests how clicks, shift, marquees and drags change the pieces in hand.
// ABOUTME: The single-piece rules must still hold when only one piece is held.

import { describe, expect, it } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import type { CollagePiece } from "../entrypoints/scraps/collageRecord";
import {
  EMPTY_SELECTION,
  marqueeSelection,
  planBarePress,
  planSelectionPress,
  pruneSelection,
  selectMany,
  selectOnly,
  soleSelected,
  toggleInSelection,
} from "../entrypoints/scraps/studioSelection";

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

/** Three pieces piled on one spot, and one off on its own. */
const bottom = piece({ id: "bottom", z: 0 });
const middle = piece({ id: "middle", z: 1 });
const top = piece({ id: "top", z: 2 });
const apart = piece({ id: "apart", z: 3, x: 400, y: 400 });
const pieces = [bottom, middle, top, apart];
const inThePile = { x: 50, y: 50 };
const onApart = { x: 450, y: 450 };
const plain = { deep: false, additive: false };
const shift = { deep: false, additive: true };

describe("the hand", () => {
  it("adds a piece with shift and makes it the primary", () => {
    const next = toggleInSelection(selectOnly("a"), "b");
    expect(next).toEqual({ ids: ["a", "b"], primary: "b" });
  });

  it("puts a held piece down with shift, handing the primary back", () => {
    const held = selectMany(["a", "b", "c"]);
    expect(toggleInSelection(held, "c")).toEqual({
      ids: ["a", "b"],
      primary: "b",
    });
    expect(toggleInSelection(held, "a")).toEqual({
      ids: ["b", "c"],
      primary: "c",
    });
    expect(toggleInSelection(selectOnly("a"), "a")).toEqual(EMPTY_SELECTION);
  });

  it("takes the same piece only once", () => {
    expect(selectMany(["a", "b", "a"])).toEqual({
      ids: ["a", "b"],
      primary: "b",
    });
  });

  it("names the sole piece only when exactly one is held", () => {
    expect(soleSelected(selectOnly("a"))).toBe("a");
    expect(soleSelected(selectMany(["a", "b"]))).toBeNull();
    expect(soleSelected(EMPTY_SELECTION)).toBeNull();
  });

  it("drops pieces that have left the collage", () => {
    const held = selectMany(["top", "gone"]);
    expect(pruneSelection(held, pieces)).toEqual({
      ids: ["top"],
      primary: "top",
    });
    const intact = selectMany(["top", "middle"]);
    expect(pruneSelection(intact, pieces)).toBe(intact);
  });
});

describe("a marquee", () => {
  it("takes exactly what it touches", () => {
    expect(marqueeSelection(selectOnly("x"), ["a", "b"], false)).toEqual({
      ids: ["a", "b"],
      primary: "b",
    });
    expect(marqueeSelection(selectOnly("x"), [], false)).toEqual(
      EMPTY_SELECTION,
    );
  });

  it("with shift adds to what was held when it began", () => {
    const base = selectOnly("x");
    expect(marqueeSelection(base, ["a", "x"], true)).toEqual({
      ids: ["x", "a"],
      primary: "a",
    });
    // Drawn back off the new pieces, the hand is just what it began with.
    expect(marqueeSelection(base, [], true)).toBe(base);
  });
});

describe("a press with one piece or none held", () => {
  it("takes the frontmost piece when nothing is held", () => {
    const plan = planSelectionPress(pieces, inThePile, EMPTY_SELECTION, plain);
    expect(plan).toEqual({
      selectOnDown: selectOnly("top"),
      dragIds: ["top"],
      selectOnClick: selectOnly("top"),
    });
  });

  it("clicking the held piece again steps one down the pile", () => {
    const plan = planSelectionPress(pieces, inThePile, selectOnly("top"), plain);
    expect(plan?.selectOnDown).toEqual(selectOnly("top"));
    expect(plan?.dragIds).toEqual(["top"]);
    expect(plan?.selectOnClick).toEqual(selectOnly("middle"));
  });

  it("drags the held piece even where another lies on top", () => {
    const plan = planSelectionPress(pieces, inThePile, selectOnly("bottom"), plain);
    expect(plan?.dragIds).toEqual(["bottom"]);
    expect(plan?.selectOnDown).toEqual(selectOnly("bottom"));
  });

  it("reaches the next piece down straight away with cmd", () => {
    const plan = planSelectionPress(pieces, inThePile, selectOnly("top"), {
      deep: true,
      additive: false,
    });
    expect(plan?.selectOnDown).toEqual(selectOnly("middle"));
    expect(plan?.dragIds).toEqual(["middle"]);
  });

  it("does nothing on bare paper", () => {
    expect(
      planSelectionPress(pieces, { x: 300, y: 10 }, selectOnly("top"), plain),
    ).toBeNull();
  });
});

describe("a shift press", () => {
  it("adds the frontmost piece and drags the whole hand", () => {
    const plan = planSelectionPress(pieces, onApart, selectOnly("top"), shift);
    const both = { ids: ["top", "apart"], primary: "apart" };
    expect(plan).toEqual({
      selectOnDown: both,
      dragIds: ["top", "apart"],
      selectOnClick: both,
    });
  });

  it("on a held piece keeps the hand for a drag and puts it down on a click", () => {
    const held = selectMany(["apart", "top"]);
    const plan = planSelectionPress(pieces, onApart, held, shift);
    expect(plan?.selectOnDown).toBe(held);
    expect(plan?.dragIds).toEqual(["apart", "top"]);
    expect(plan?.selectOnClick).toEqual(selectOnly("top"));
  });
});

describe("a press with several held", () => {
  const held = selectMany(["apart", "top"]);

  it("on a held piece keeps the hand so a drag moves them all", () => {
    const plan = planSelectionPress(pieces, onApart, held, plain);
    expect(plan?.selectOnDown).toBe(held);
    expect(plan?.dragIds).toEqual(["apart", "top"]);
  });

  it("narrows to the clicked piece on a click without a drag", () => {
    const plan = planSelectionPress(pieces, onApart, held, plain);
    expect(plan?.selectOnClick).toEqual(selectOnly("apart"));
  });

  it("does not step down the pile the way a single held piece does", () => {
    const plan = planSelectionPress(pieces, inThePile, held, plain);
    expect(plan?.selectOnClick).toEqual(selectOnly("top"));
  });

  it("carries the hand from a held piece buried under an unheld one", () => {
    const buried = selectMany(["bottom", "apart"]);
    const plan = planSelectionPress(pieces, inThePile, buried, plain);
    expect(plan?.dragIds).toEqual(["bottom", "apart"]);
    // A click there takes the piece the eye sees on top.
    expect(plan?.selectOnClick).toEqual(selectOnly("top"));
  });

  it("takes an unheld piece alone when pressed away from the hand", () => {
    const plan = planSelectionPress(
      pieces,
      onApart,
      selectMany(["top", "middle"]),
      plain,
    );
    expect(plan?.selectOnDown).toEqual(selectOnly("apart"));
    expect(plan?.dragIds).toEqual(["apart"]);
  });

  it("with cmd reaches down from the primary alone", () => {
    const plan = planSelectionPress(pieces, inThePile, selectMany(["apart", "top"]), {
      deep: true,
      additive: false,
    });
    expect(plan?.selectOnDown).toEqual(selectOnly("middle"));
    expect(plan?.dragIds).toEqual(["middle"]);
  });
});

describe("a press on bare paper", () => {
  const held = selectMany(["top", "apart"]);
  const groupBox = { x: 0, y: 0, width: 500, height: 500 };
  const betweenThem = { x: 250, y: 250 };
  const outside = { x: 700, y: 50 };

  it("inside the box around several grabs them all", () => {
    expect(planBarePress(betweenThem, held, groupBox, false)).toEqual({
      kind: "drag",
      dragIds: ["top", "apart"],
      selectOnClick: EMPTY_SELECTION,
    });
  });

  it("inside the box with shift still grabs them, and a click keeps them", () => {
    expect(planBarePress(betweenThem, held, groupBox, true)).toEqual({
      kind: "drag",
      dragIds: ["top", "apart"],
      selectOnClick: held,
    });
  });

  it("outside the box starts a marquee that lets go of the hand", () => {
    expect(planBarePress(outside, held, groupBox, false)).toEqual({
      kind: "marquee",
      base: EMPTY_SELECTION,
      additive: false,
    });
  });

  it("outside the box with shift starts a marquee that keeps the hand", () => {
    expect(planBarePress(outside, held, groupBox, true)).toEqual({
      kind: "marquee",
      base: held,
      additive: true,
    });
  });

  it("with one piece or none held always starts a marquee", () => {
    expect(planBarePress(betweenThem, selectOnly("top"), groupBox, false).kind).toBe(
      "marquee",
    );
    expect(planBarePress(betweenThem, EMPTY_SELECTION, null, false).kind).toBe(
      "marquee",
    );
  });
});
