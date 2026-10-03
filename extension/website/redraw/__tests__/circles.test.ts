// ABOUTME: Verifies rough-circle detection inside longer cursor paths.
// ABOUTME: Covers false positives, multiple gestures, and deterministic arrangement.

import { describe, expect, it } from "vitest";
import {
  arrangeCircularGestures,
  detectCircularGestures,
} from "../circles";
import { LibraryItem } from "../draw";

function circlePoints({
  centerX = 300,
  centerY = 220,
  radiusX = 120,
  radiusY = 105,
  samples = 25,
  startAngle = 0,
}: {
  centerX?: number;
  centerY?: number;
  radiusX?: number;
  radiusY?: number;
  samples?: number;
  startAngle?: number;
} = {}) {
  return Array.from({ length: samples }, (_, index) => {
    const angle = startAngle + (index / (samples - 1)) * Math.PI * 2;
    const wobble = index % 3 === 0 ? 4 : -2;
    return {
      x: centerX + Math.cos(angle) * (radiusX + wobble),
      y: centerY + Math.sin(angle) * (radiusY - wobble),
    };
  });
}

function trail(points: Array<{ x: number; y: number }>, id = "trail"): LibraryItem {
  return { points, color: "#ef476f", id };
}

describe("detectCircularGestures", () => {
  it("finds a rough ellipse embedded between approach and exit movements", () => {
    const points = [
      { x: 20, y: 20 },
      { x: 80, y: 80 },
      ...circlePoints(),
      { x: 500, y: 400 },
      { x: 560, y: 460 },
    ];

    const detected = detectCircularGestures([trail(points)]);

    expect(detected).toHaveLength(1);
    expect(detected[0].score).toBeGreaterThan(0.58);
    expect(detected[0].points.length).toBeGreaterThanOrEqual(20);
  });

  it("finds a circle from sparse archival samples", () => {
    const detected = detectCircularGestures([
      trail(circlePoints({ samples: 10 })),
    ]);

    expect(detected).toHaveLength(1);
  });

  it("rejects open arcs, rectangles, and back-and-forth browsing motion", () => {
    const arc = circlePoints({ samples: 20 }).slice(0, 12);
    const rectangle = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 300, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 200 },
      { x: 400, y: 300 },
      { x: 400, y: 400 },
      { x: 300, y: 400 },
      { x: 200, y: 400 },
      { x: 100, y: 400 },
      { x: 100, y: 300 },
      { x: 100, y: 200 },
      { x: 100, y: 100 },
    ];
    const zigzag = Array.from({ length: 30 }, (_, index) => ({
      x: 40 + index * 18,
      y: index % 2 === 0 ? 80 : 260,
    }));

    expect(
      detectCircularGestures([
        trail(arc, "arc"),
        trail(rectangle, "rectangle"),
        trail(zigzag, "zigzag"),
      ]),
    ).toEqual([]);
  });

  it("rejects closed loops with long straight sides", () => {
    const top = Array.from({ length: 8 }, (_, index) => ({
      x: 100 + index * 35,
      y: 100,
    }));
    const roundedEnd = Array.from({ length: 12 }, (_, index) => {
      const angle = -Math.PI / 2 + (index / 11) * Math.PI;
      return {
        x: 345 + Math.cos(angle) * 150,
        y: 250 + Math.sin(angle) * 150,
      };
    });
    const bottom = Array.from({ length: 8 }, (_, index) => ({
      x: 345 - index * 35,
      y: 400,
    }));
    const left = Array.from({ length: 10 }, (_, index) => ({
      x: 100,
      y: 400 - index * (300 / 9),
    }));

    expect(
      detectCircularGestures([
        trail([...top, ...roundedEnd, ...bottom, ...left], "flat-loop"),
      ]),
    ).toEqual([]);
  });

  it("selects two non-overlapping circles from one continuous trail", () => {
    const points = [
      ...circlePoints({ centerX: 220, centerY: 240 }),
      { x: 400, y: 240 },
      { x: 520, y: 240 },
      ...circlePoints({
        centerX: 650,
        centerY: 240,
        radiusX: 105,
        radiusY: 115,
        startAngle: Math.PI,
      }),
    ];

    const detected = detectCircularGestures([trail(points)]);

    expect(detected).toHaveLength(2);
  });
});

describe("arrangeCircularGestures", () => {
  it("keeps detected shapes distinct while clustering their centers", () => {
    const detected = detectCircularGestures([
      trail(circlePoints(), "one"),
      trail(
        circlePoints({
          centerX: 600,
          centerY: 400,
          radiusX: 95,
          radiusY: 110,
        }),
        "two",
      ),
    ]);

    const arranged = arrangeCircularGestures(detected, {
      width: 1200,
      height: 800,
    }, {
      maxCircles: 2,
      spatialOverlap: 1,
    });

    expect(arranged).toHaveLength(2);
    for (const item of arranged) {
      const centerX =
        item.points.reduce((total, point) => total + point.x, 0) /
        item.points.length;
      const centerY =
        item.points.reduce((total, point) => total + point.y, 0) /
        item.points.length;
      expect(Math.abs(centerX - 600)).toBeLessThan(4);
      expect(Math.abs(centerY - 400)).toBeLessThan(4);
    }
  });
});
