// ABOUTME: Tests the collage placement, resize, rotate, and crop math.
// ABOUTME: Guards that crops compose onto the source box and rotated resizes stay pinned.

import { describe, expect, it } from "vitest";
import {
  FULL_CROP,
  MIN_CROP_FRACTION,
  MIN_PIECE_SIDE,
  clamp,
  composeCrop,
  cropFromLocalDrag,
  dragCropGrip,
  fanOutPlacement,
  fitWithin,
  frameScale,
  isFullCrop,
  isUsableCrop,
  normalizeDegrees,
  resizeFromCorner,
  rotatePoint,
  rotationToPointer,
  scaleAboutCenter,
  scaleFromPointer,
  snapDegrees,
  sourceBoxForCrop,
  toLocalPoint,
  type PieceBox,
} from "../entrypoints/scraps/collageGeometry";

const BOX: PieceBox = { x: 100, y: 50, width: 200, height: 100 };

describe("clamp", () => {
  it("keeps a value inside its bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it("refuses NaN rather than passing it through", () => {
    expect(() => clamp(Number.NaN, 0, 1)).toThrow(/NaN/);
  });
});

describe("rotatePoint", () => {
  it("returns the point unchanged at zero rotation", () => {
    expect(rotatePoint({ x: 3, y: 4 }, { x: 0, y: 0 }, 0)).toEqual({
      x: 3,
      y: 4,
    });
  });

  it("turns a quarter turn about the center", () => {
    const turned = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(turned.x).toBeCloseTo(0);
    expect(turned.y).toBeCloseTo(1);
  });
});

describe("toLocalPoint", () => {
  it("maps a box's own corners to its local corners", () => {
    expect(toLocalPoint({ x: 100, y: 50 }, BOX, 0)).toEqual({ x: 0, y: 0 });
    const bottomRight = toLocalPoint({ x: 300, y: 150 }, BOX, 0);
    expect(bottomRight.x).toBeCloseTo(200);
    expect(bottomRight.y).toBeCloseTo(100);
  });

  it("undoes the piece's rotation", () => {
    const center = { x: 200, y: 100 };
    const frameSpace = rotatePoint({ x: 100, y: 50 }, center, Math.PI / 6);
    const local = toLocalPoint(frameSpace, BOX, 30);
    expect(local.x).toBeCloseTo(0);
    expect(local.y).toBeCloseTo(0);
  });
});

describe("resizeFromCorner", () => {
  it("pins the opposite corner when dragging unrotated", () => {
    const next = resizeFromCorner({
      box: BOX,
      rotationDegrees: 0,
      corner: "bottom-right",
      pointer: { x: 400, y: 200 },
      keepAspect: false,
    });
    expect(next.x).toBeCloseTo(100);
    expect(next.y).toBeCloseTo(50);
    expect(next.width).toBeCloseTo(300);
    expect(next.height).toBeCloseTo(150);
  });

  it("keeps the aspect ratio when asked", () => {
    const next = resizeFromCorner({
      box: BOX,
      rotationDegrees: 0,
      corner: "bottom-right",
      pointer: { x: 500, y: 100 },
      keepAspect: true,
    });
    expect(next.width / next.height).toBeCloseTo(BOX.width / BOX.height);
  });

  it("keeps the pinned corner in place for a rotated piece", () => {
    const rotation = 37;
    const radians = (rotation * Math.PI) / 180;
    const before = rotatePoint(
      { x: BOX.x, y: BOX.y },
      { x: BOX.x + BOX.width / 2, y: BOX.y + BOX.height / 2 },
      radians,
    );
    const next = resizeFromCorner({
      box: BOX,
      rotationDegrees: rotation,
      corner: "bottom-right",
      pointer: { x: 420, y: 240 },
      keepAspect: false,
    });
    const after = rotatePoint(
      { x: next.x, y: next.y },
      { x: next.x + next.width / 2, y: next.y + next.height / 2 },
      radians,
    );
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("never shrinks a side below the minimum", () => {
    const next = resizeFromCorner({
      box: BOX,
      rotationDegrees: 0,
      corner: "bottom-right",
      pointer: { x: 100, y: 50 },
      keepAspect: false,
    });
    expect(next.width).toBeGreaterThanOrEqual(MIN_PIECE_SIDE);
    expect(next.height).toBeGreaterThanOrEqual(MIN_PIECE_SIDE);
  });
});

describe("rotation", () => {
  it("reports zero when the pointer is directly above the center", () => {
    expect(rotationToPointer(BOX, { x: 200, y: -100 })).toBeCloseTo(0);
  });

  it("reports a quarter turn when the pointer is to the right", () => {
    expect(rotationToPointer(BOX, { x: 400, y: 100 })).toBeCloseTo(90);
  });

  it("wraps negative angles into 0..360", () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(450)).toBe(90);
  });

  it("snaps to the nearest step", () => {
    expect(snapDegrees(47, 15)).toBe(45);
    expect(snapDegrees(-4, 15)).toBe(0);
  });

  it("snaps a small negative angle backwards, then wraps it", () => {
    // -8 degrees is 352; the nearest 15-degree step below it is 345.
    expect(snapDegrees(-8, 15)).toBe(345);
  });

  it("refuses a non-positive snap step", () => {
    expect(() => snapDegrees(10, 0)).toThrow(/positive step/);
  });
});

describe("crops", () => {
  it("expresses a local drag as fractions of the piece", () => {
    const crop = cropFromLocalDrag({ x: 50, y: 25 }, { x: 150, y: 75 }, BOX);
    expect(crop).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  });

  it("clamps a drag that leaves the piece", () => {
    const crop = cropFromLocalDrag(
      { x: -80, y: -40 },
      { x: 900, y: 900 },
      BOX,
    );
    expect(crop).toEqual(FULL_CROP);
    expect(isFullCrop(crop)).toBe(true);
  });

  it("normalizes a drag made from bottom-right to top-left", () => {
    const forward = cropFromLocalDrag({ x: 20, y: 10 }, { x: 120, y: 60 }, BOX);
    const backward = cropFromLocalDrag(
      { x: 120, y: 60 },
      { x: 20, y: 10 },
      BOX,
    );
    expect(backward).toEqual(forward);
  });

  it("composes a second crop back onto the original source", () => {
    const first = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    const second = { x: 0.5, y: 0, width: 0.5, height: 1 };
    expect(composeCrop(first, second)).toEqual({
      x: 0.5,
      y: 0.25,
      width: 0.25,
      height: 0.5,
    });
  });

  it("treats a hairline drag as not worth applying", () => {
    expect(isUsableCrop({ x: 0, y: 0, width: 0.001, height: 0.5 })).toBe(false);
    expect(isUsableCrop({ x: 0, y: 0, width: 0.3, height: 0.3 })).toBe(true);
  });

  it("recovers the source box a visible crop was taken from", () => {
    const visible: PieceBox = { x: 150, y: 75, width: 100, height: 50 };
    const source = sourceBoxForCrop(visible, {
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    });
    expect(source).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  });

  it("round-trips a crop through the source box", () => {
    const crop = { x: 0.1, y: 0.2, width: 0.4, height: 0.3 };
    const visible: PieceBox = { x: 40, y: 60, width: 80, height: 30 };
    const source = sourceBoxForCrop(visible, crop);
    expect(source.x + crop.x * source.width).toBeCloseTo(visible.x);
    expect(source.y + crop.y * source.height).toBeCloseTo(visible.y);
    expect(source.width * crop.width).toBeCloseTo(visible.width);
    expect(source.height * crop.height).toBeCloseTo(visible.height);
  });

  it("refuses a crop with no area rather than dividing by zero", () => {
    expect(() =>
      sourceBoxForCrop(BOX, { x: 0, y: 0, width: 0, height: 1 }),
    ).toThrow(/no area/);
  });
});

describe("dragCropGrip", () => {
  const source = { width: 200, height: 100 };
  const half = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

  it("moves one edge and leaves the opposite one alone", () => {
    const next = dragCropGrip(half, "left", { x: 10, y: 0 }, source);
    expect(next.x).toBeCloseTo(0.3);
    expect(next.width).toBeCloseTo(0.45);
    expect(next.x + next.width).toBeCloseTo(0.75);
  });

  it("moves both edges of a corner", () => {
    const next = dragCropGrip(half, "bottom-right", { x: 20, y: 10 }, source);
    expect(next.x).toBeCloseTo(0.25);
    expect(next.width).toBeCloseTo(0.6);
    expect(next.height).toBeCloseTo(0.6);
  });

  it("slides the whole box when dragged from inside", () => {
    const next = dragCropGrip(half, "inside", { x: 20, y: 0 }, source);
    expect(next.x).toBeCloseTo(0.35);
    expect(next.width).toBeCloseTo(0.5);
  });

  it("keeps a slid box inside the source", () => {
    const next = dragCropGrip(half, "inside", { x: 9999, y: 9999 }, source);
    expect(next.x).toBeCloseTo(0.5);
    expect(next.y).toBeCloseTo(0.5);
    expect(next.x + next.width).toBeCloseTo(1);
  });

  it("never lets an edge pass its opposite", () => {
    const next = dragCropGrip(half, "left", { x: 9999, y: 0 }, source);
    expect(next.width).toBeGreaterThanOrEqual(MIN_CROP_FRACTION - 1e-9);
    expect(next.x).toBeLessThan(next.x + next.width);
  });

  it("clamps an edge dragged past the source", () => {
    const next = dragCropGrip(half, "right", { x: 9999, y: 0 }, source);
    expect(next.x + next.width).toBeCloseTo(1);
  });
});

describe("modal scaling", () => {
  const center = { x: 100, y: 100 };

  it("reports no change when the pointer has not moved", () => {
    expect(scaleFromPointer(center, { x: 150, y: 100 }, { x: 150, y: 100 })).toBeCloseTo(1);
  });

  it("grows as the pointer leaves the center", () => {
    expect(scaleFromPointer(center, { x: 150, y: 100 }, { x: 200, y: 100 })).toBeCloseTo(2);
  });

  it("shrinks as the pointer approaches the center", () => {
    expect(scaleFromPointer(center, { x: 200, y: 100 }, { x: 150, y: 100 })).toBeCloseTo(0.5);
  });

  it("holds steady when the drag started on the center", () => {
    expect(scaleFromPointer(center, center, { x: 180, y: 100 })).toBe(1);
  });

  it("resizes a box about its own center", () => {
    const scaled = scaleAboutCenter(
      { x: 0, y: 0, width: 100, height: 50 },
      2,
    );
    expect(scaled).toEqual({ x: -50, y: -25, width: 200, height: 100 });
  });

  it("never shrinks a side below the minimum", () => {
    const scaled = scaleAboutCenter(
      { x: 0, y: 0, width: 100, height: 50 },
      0.001,
    );
    expect(scaled.width).toBeGreaterThanOrEqual(MIN_PIECE_SIDE);
    expect(scaled.height).toBeGreaterThanOrEqual(MIN_PIECE_SIDE);
  });
});

describe("fitWithin", () => {
  it("scales the longest side down to the limit", () => {
    expect(fitWithin(800, 400, 200)).toEqual({ width: 200, height: 100 });
  });

  it("enlarges a small scrap only as far as the upscale cap allows", () => {
    // A 32px cursor should come in grabbable, not blown up to fill the frame.
    expect(fitWithin(32, 32, 220)).toEqual({ width: 64, height: 64 });
  });

  it("keeps the aspect ratio of a small wide scrap it enlarges", () => {
    expect(fitWithin(40, 10, 220)).toEqual({ width: 80, height: 20 });
  });

  it("refuses a source with no size", () => {
    expect(() => fitWithin(0, 10, 100)).toThrow(/positive natural/);
  });
});

describe("fanOutPlacement", () => {
  const frame = { width: 1200, height: 800 };

  it("puts the first piece in the middle", () => {
    const first = fanOutPlacement(0, frame);
    expect(first.x).toBeCloseTo(600);
    expect(first.y).toBeCloseTo(400);
  });

  it("keeps every piece well clear of its neighbours", () => {
    const spots = Array.from({ length: 30 }, (_, index) =>
      fanOutPlacement(index, frame),
    );
    let closest = Infinity;
    for (let a = 0; a < spots.length; a += 1) {
      for (let b = a + 1; b < spots.length; b += 1) {
        closest = Math.min(
          closest,
          Math.hypot(spots[a].x - spots[b].x, spots[a].y - spots[b].y),
        );
      }
    }
    expect(closest).toBeGreaterThan(24);
  });

  it("spreads a long run across the frame rather than repeating", () => {
    const spots = Array.from({ length: 30 }, (_, index) =>
      fanOutPlacement(index, frame),
    );
    const xs = spots.map((spot) => spot.x);
    const ys = spots.map((spot) => spot.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(300);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(300);
  });

  it("never places a piece outside the frame", () => {
    for (let index = 0; index < 200; index += 1) {
      const spot = fanOutPlacement(index, frame);
      expect(spot.x).toBeGreaterThanOrEqual(0);
      expect(spot.x).toBeLessThanOrEqual(frame.width);
      expect(spot.y).toBeGreaterThanOrEqual(0);
      expect(spot.y).toBeLessThanOrEqual(frame.height);
    }
  });
});

describe("frameScale", () => {
  it("shrinks the frame to fit the shorter axis", () => {
    expect(
      frameScale({ width: 1200, height: 800 }, { width: 600, height: 800 }),
    ).toBeCloseTo(0.5);
  });

  it("never enlarges past one to one", () => {
    expect(
      frameScale({ width: 100, height: 100 }, { width: 900, height: 900 }),
    ).toBe(1);
  });
});
