// ABOUTME: Tests the geometry of several collage pieces handled at once.
// ABOUTME: Bounds of turned boxes, marquee hits, and group scale, turn and mirror.

import { describe, expect, it } from "vitest";
import {
  angleAbout,
  boxMeetsRect,
  groupBounds,
  groupScaleFromCorner,
  mirrorGroup,
  piecesInRect,
  rectBetween,
  rotateGroup,
  scaleGroup,
  translateGroup,
  turnedCorners,
  type FlippableBox,
} from "../entrypoints/scraps/groupGeometry";
import { MIN_PIECE_SIDE, boxCenter } from "../entrypoints/scraps/collageGeometry";

function box(over: Partial<FlippableBox> = {}): FlippableBox {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    flipX: false,
    flipY: false,
    ...over,
  };
}

function expectPoint(actual: { x: number; y: number }, x: number, y: number) {
  expect(actual.x).toBeCloseTo(x, 6);
  expect(actual.y).toBeCloseTo(y, 6);
}

describe("the box around several pieces", () => {
  it("is the plain union for upright pieces", () => {
    const bounds = groupBounds([
      box({ x: 10, y: 20 }),
      box({ x: 200, y: 100, width: 40, height: 40 }),
    ]);
    expect(bounds).toEqual({ x: 10, y: 20, width: 230, height: 120 });
  });

  it("reaches out to the corners of a turned piece", () => {
    // A 100 x 50 box turned a quarter stands 50 wide and 100 tall about the
    // same center (50, 25).
    const bounds = groupBounds([box({ rotation: 90 })]);
    expect(bounds.x).toBeCloseTo(25, 6);
    expect(bounds.y).toBeCloseTo(-25, 6);
    expect(bounds.width).toBeCloseTo(50, 6);
    expect(bounds.height).toBeCloseTo(100, 6);
  });

  it("grows for a piece turned partway", () => {
    const square = box({ width: 100, height: 100, rotation: 45 });
    const bounds = groupBounds([square]);
    expect(bounds.width).toBeCloseTo(100 * Math.SQRT2, 6);
    expect(boxCenter(bounds).x).toBeCloseTo(50, 6);
  });

  it("refuses an empty group", () => {
    expect(() => groupBounds([])).toThrow();
  });

  it("lists a turned piece's corners clockwise from its own top-left", () => {
    const corners = turnedCorners(box({ rotation: 180 }));
    expectPoint(corners[0], 100, 50);
    expectPoint(corners[2], 0, 0);
  });
});

describe("the marquee", () => {
  it("spans the drag whichever way it went", () => {
    expect(rectBetween({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  it("takes a piece it only partly covers", () => {
    expect(boxMeetsRect(box(), { x: 90, y: 40, width: 50, height: 50 })).toBe(
      true,
    );
  });

  it("misses a piece clear of it", () => {
    expect(boxMeetsRect(box(), { x: 101, y: 0, width: 50, height: 50 })).toBe(
      false,
    );
  });

  it("misses a turned piece whose upright box it would have clipped", () => {
    // A square turned 45 degrees has empty corners in its upright box. A
    // marquee tucked into one of those corners touches nothing.
    const diamond = box({ width: 100, height: 100, rotation: 45 });
    const inTheEmptyCorner = { x: -18, y: -18, width: 10, height: 10 };
    expect(boxMeetsRect(diamond, inTheEmptyCorner)).toBe(false);
    expect(boxMeetsRect(box({ width: 100, height: 100 }), { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
  });

  it("takes a turned piece where its tip reaches in", () => {
    const diamond = box({ width: 100, height: 100, rotation: 45 });
    // The left tip sits at about (-20.7, 50).
    expect(
      boxMeetsRect(diamond, { x: -25, y: 45, width: 10, height: 10 }),
    ).toBe(true);
  });

  it("takes a piece wholly inside it and keeps the order given", () => {
    const pieces = [
      { ...box({ x: 0, y: 0 }), id: "a" },
      { ...box({ x: 500, y: 500 }), id: "far" },
      { ...box({ x: 20, y: 20, width: 10, height: 10 }), id: "b" },
    ];
    const hits = piecesInRect(pieces, { x: -5, y: -5, width: 200, height: 200 });
    expect(hits.map((piece) => piece.id)).toEqual(["a", "b"]);
  });
});

describe("scaling a group from a corner", () => {
  const bounds = { x: 0, y: 0, width: 200, height: 100 };

  it("keeps the opposite corner still and the aspect even", () => {
    const grow = groupScaleFromCorner({
      bounds,
      corner: "bottom-right",
      pointer: { x: 400, y: 150 },
      keepAspect: true,
      aboutCenter: false,
    });
    expect(grow).toEqual({ anchor: { x: 0, y: 0 }, x: 2, y: 2 });
  });

  it("stretches each axis apart when the aspect is freed", () => {
    const grow = groupScaleFromCorner({
      bounds,
      corner: "top-left",
      pointer: { x: 100, y: -100 },
      keepAspect: false,
      aboutCenter: false,
    });
    expect(grow.anchor).toEqual({ x: 200, y: 100 });
    expect(grow.x).toBeCloseTo(0.5, 6);
    expect(grow.y).toBeCloseTo(2, 6);
  });

  it("grows about the middle with alt", () => {
    const grow = groupScaleFromCorner({
      bounds,
      corner: "top-right",
      pointer: { x: 300, y: -50 },
      keepAspect: true,
      aboutCenter: true,
    });
    expect(grow.anchor).toEqual({ x: 100, y: 50 });
    expect(grow.x).toBeCloseTo(2, 6);
  });

  it("stops short of turning the group inside out", () => {
    const grow = groupScaleFromCorner({
      bounds,
      corner: "bottom-right",
      pointer: { x: -300, y: -300 },
      keepAspect: false,
      aboutCenter: false,
    });
    expect(grow.x).toBeGreaterThan(0);
    expect(grow.y).toBeGreaterThan(0);
  });

  it("moves each piece's place and size with the scale", () => {
    const [left, right] = scaleGroup(
      [box({ x: 0, y: 0 }), box({ x: 100, y: 50 })],
      { anchor: { x: 0, y: 0 }, x: 2, y: 2 },
    );
    expect(left).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    expect(right).toMatchObject({ x: 200, y: 100, width: 200, height: 100 });
    // The group's box scales exactly with an even scale.
    expect(groupBounds([left, right])).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 200,
    });
  });

  it("stretches a quarter-turned piece along its own axes", () => {
    const [turned] = scaleGroup([box({ rotation: 90 })], {
      anchor: { x: 50, y: 25 },
      x: 2,
      y: 1,
    });
    // Its own width runs down the frame, so a sideways stretch widens its
    // height instead.
    expect(turned.width).toBeCloseTo(100, 6);
    expect(turned.height).toBeCloseTo(100, 6);
    expectPoint(boxCenter(turned), 50, 25);
  });

  it("never shrinks a piece below the smallest side", () => {
    const [tiny] = scaleGroup([box()], { anchor: { x: 0, y: 0 }, x: 0.01, y: 0.01 });
    expect(tiny.width).toBe(MIN_PIECE_SIDE);
    expect(tiny.height).toBe(MIN_PIECE_SIDE);
  });
});

describe("turning a group", () => {
  it("orbits each piece about the center and adds the turn to its own", () => {
    const pieces = [
      box({ x: 100, y: -25, rotation: 10 }), // center (150, 0)
      box({ x: -200, y: -25, rotation: 350 }), // center (-150, 0)
    ];
    const [first, second] = rotateGroup(pieces, { x: 0, y: 0 }, 90);
    expectPoint(boxCenter(first), 0, 150);
    expect(first.rotation).toBe(100);
    expectPoint(boxCenter(second), 0, -150);
    expect(second.rotation).toBe(80);
    // Sizes are untouched.
    expect(first.width).toBe(100);
    expect(first.height).toBe(50);
  });

  it("measures the angle round a center with zero pointing right", () => {
    expect(angleAbout({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
    expect(angleAbout({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(90);
  });
});

describe("moving and mirroring a group", () => {
  it("moves every piece by the same amount", () => {
    const moved = translateGroup([box(), box({ x: 30 })], 5, -7);
    expect(moved.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 5, y: -7 },
      { x: 35, y: -7 },
    ]);
  });

  it("mirrors the arrangement left to right across its middle", () => {
    const pieces = [
      box({ x: 0, y: 0, rotation: 30 }),
      box({ x: 300, y: 0, width: 100, height: 50 }),
    ];
    const before = groupBounds(pieces);
    const middle = before.x + before.width / 2;
    const [left, right] = mirrorGroup(pieces, "x");
    // Each center crosses the middle of the group's box to the same distance.
    expectPoint(boxCenter(left), 2 * middle - 50, 25);
    expectPoint(boxCenter(right), 2 * middle - 350, 25);
    expect(left.rotation).toBe(330);
    expect(left.flipX).toBe(true);
    expect(left.flipY).toBe(false);
    const after = groupBounds([left, right]);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.width).toBeCloseTo(before.width, 6);
  });

  it("mirrors top to bottom", () => {
    const [upper, lower] = mirrorGroup(
      [box({ y: 0 }), box({ y: 200, flipY: true })],
      "y",
    );
    expectPoint(boxCenter(upper), 50, 225);
    expect(upper.flipY).toBe(true);
    expectPoint(boxCenter(lower), 50, 25);
    expect(lower.flipY).toBe(false);
  });
});
