// ABOUTME: Tests corner drags that turn a piece over past its far corner, and shift's axis lock.
// ABOUTME: Pure box math, so the flip and the lock are checked without a browser.

import { describe, expect, it } from "vitest";
import {
  MIN_PIECE_SIDE,
  boxCenter,
  cornerPoint,
  dragCorner,
  lockToAxis,
  signedCornerScale,
  type PieceBox,
} from "../entrypoints/scraps/collageGeometry";

const BOX: PieceBox = { x: 100, y: 50, width: 200, height: 100 };

function expectPoint(actual: { x: number; y: number }, x: number, y: number) {
  expect(actual.x).toBeCloseTo(x, 6);
  expect(actual.y).toBeCloseTo(y, 6);
}

describe("the signed scale of a corner drag", () => {
  const anchor = { x: 0, y: 0 };
  const grabbed = { x: 100, y: 50 };
  const minimum = { x: 0.1, y: 0.1 };

  it("is plain growth on the near side of the anchor", () => {
    expect(
      signedCornerScale({ anchor, grabbed, pointer: { x: 200, y: 100 }, keepAspect: false, minimum }),
    ).toEqual({ x: 2, y: 2 });
  });

  it("goes negative on the axis the drag carried past the anchor", () => {
    const scale = signedCornerScale({
      anchor,
      grabbed,
      pointer: { x: -50, y: 25 },
      keepAspect: false,
      minimum,
    });
    expect(scale.x).toBeCloseTo(-0.5, 6);
    expect(scale.y).toBeCloseTo(0.5, 6);
  });

  it("keeps the aspect with the larger magnitude and each axis's own sign", () => {
    const scale = signedCornerScale({
      anchor,
      grabbed,
      pointer: { x: -100, y: 10 },
      keepAspect: true,
      minimum,
    });
    expect(scale).toEqual({ x: -1, y: 1 });
  });

  it("stops each magnitude at its minimum", () => {
    const scale = signedCornerScale({
      anchor,
      grabbed,
      pointer: { x: -1, y: 1 },
      keepAspect: false,
      minimum,
    });
    expect(scale).toEqual({ x: -0.1, y: 0.1 });
  });
});

describe("dragging a corner", () => {
  it("pins the opposite corner and grows without turning over", () => {
    const drag = dragCorner({
      box: BOX,
      rotationDegrees: 0,
      corner: "bottom-right",
      pointer: { x: 500, y: 250 },
      keepAspect: true,
      aboutCenter: false,
    });
    expect(drag).toEqual({
      box: { x: 100, y: 50, width: 400, height: 200 },
      flippedX: false,
      flippedY: false,
    });
  });

  it("turns the piece over across when pulled past the far side", () => {
    const drag = dragCorner({
      box: BOX,
      rotationDegrees: 0,
      corner: "bottom-right",
      pointer: { x: 0, y: 150 },
      keepAspect: false,
      aboutCenter: false,
    });
    // The pinned top-left corner is now the box's top-right.
    expect(drag.box.x).toBeCloseTo(0, 6);
    expect(drag.box.y).toBeCloseTo(50, 6);
    expect(drag.box.width).toBeCloseTo(100, 6);
    expect(drag.box.height).toBeCloseTo(100, 6);
    expect(drag.flippedX).toBe(true);
    expect(drag.flippedY).toBe(false);
  });

  it("turns over down and across at once past the far corner", () => {
    const drag = dragCorner({
      box: BOX,
      rotationDegrees: 0,
      corner: "top-left",
      pointer: { x: 500, y: 250 },
      keepAspect: false,
      aboutCenter: false,
    });
    expect(drag.box).toEqual({ x: 300, y: 150, width: 200, height: 100 });
    expect(drag.flippedX).toBe(true);
    expect(drag.flippedY).toBe(true);
  });

  it("keeps the pinned corner in place on a turned piece that flips", () => {
    const rotation = 30;
    const pinned = cornerPoint(BOX, rotation, "top-left");
    const drag = dragCorner({
      box: BOX,
      rotationDegrees: rotation,
      corner: "bottom-right",
      // Well past the far side along the piece's own axis.
      pointer: cornerPoint(
        { x: BOX.x - 150, y: BOX.y, width: 150, height: BOX.height },
        rotation,
        "bottom-left",
      ),
      keepAspect: false,
      aboutCenter: false,
    });
    expect(drag.flippedX).toBe(true);
    // The piece flipped across, so the old pinned corner is its new top-right.
    expectPoint(cornerPoint(drag.box, rotation, "top-right"), pinned.x, pinned.y);
  });

  it("grows about the center with alt and turns over past it", () => {
    const drag = dragCorner({
      box: BOX,
      rotationDegrees: 0,
      corner: "bottom-right",
      pointer: { x: 100, y: 150 },
      keepAspect: false,
      aboutCenter: true,
    });
    expectPoint(boxCenter(drag.box), 200, 100);
    expect(drag.box.width).toBeCloseTo(200, 6);
    expect(drag.box.height).toBeCloseTo(100, 6);
    expect(drag.flippedX).toBe(true);
    expect(drag.flippedY).toBe(false);
  });

  it("never shrinks a side below the smallest piece", () => {
    const drag = dragCorner({
      box: BOX,
      rotationDegrees: 0,
      corner: "bottom-right",
      pointer: { x: 100, y: 50 },
      keepAspect: false,
      aboutCenter: false,
    });
    expect(drag.box.width).toBeCloseTo(MIN_PIECE_SIDE, 6);
    expect(drag.box.height).toBeCloseTo(MIN_PIECE_SIDE, 6);
  });
});

describe("shift's axis lock", () => {
  it("keeps the axis the drag has mostly travelled along", () => {
    expect(lockToAxis({ x: 30, y: -8 })).toEqual({ x: 30, y: 0 });
    expect(lockToAxis({ x: 5, y: -40 })).toEqual({ x: 0, y: -40 });
  });

  it("changes axis as soon as the other one takes the lead", () => {
    expect(lockToAxis({ x: 20, y: 19 })).toEqual({ x: 20, y: 0 });
    expect(lockToAxis({ x: 20, y: 21 })).toEqual({ x: 0, y: 21 });
  });
});
