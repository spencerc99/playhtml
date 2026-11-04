// ABOUTME: Tests where a rotated piece's corners sit and how an out-of-view corner is pinned.
// ABOUTME: A pinned handle must land on the nearest in-view point and leave in-view corners alone.

import { describe, expect, it } from "vitest";
import { cornerPoint, pinInside } from "../entrypoints/scraps/collageGeometry";

const box = { x: 100, y: 100, width: 200, height: 100 };

describe("cornerPoint", () => {
  it("names the box's own corners when unrotated", () => {
    expect(cornerPoint(box, 0, "top-left")).toEqual({ x: 100, y: 100 });
    expect(cornerPoint(box, 0, "bottom-right")).toEqual({ x: 300, y: 200 });
  });

  it("turns the corners about the box's center", () => {
    const turned = cornerPoint(box, 90, "top-left");
    // A quarter turn clockwise carries the top-left to where the top-right
    // of a box standing on end would be.
    expect(turned.x).toBeCloseTo(250);
    expect(turned.y).toBeCloseTo(50);
  });
});

describe("pinInside", () => {
  const view = { x: 0, y: 0, width: 500, height: 400 };

  it("leaves a point in view where it is", () => {
    expect(pinInside({ x: 120, y: 80 }, view)).toEqual({ x: 120, y: 80 });
  });

  it("moves a point out of view to the nearest edge", () => {
    expect(pinInside({ x: 900, y: 80 }, view)).toEqual({ x: 500, y: 80 });
    expect(pinInside({ x: -40, y: 700 }, view)).toEqual({ x: 0, y: 400 });
  });
});
