// ABOUTME: Verifies the shared cinder-block state shape and physics sync thresholds.
// ABOUTME: Covers initial construction, spawn placement, and transform filtering.

import { describe, expect, it } from "vitest";
import {
  createBlock,
  createDefaultYard,
  getChangedTransforms,
  roundTransform,
} from "./model";

describe("cinder-block yard model", () => {
  it("creates a mixed nine-block wall keyed by stable ids", () => {
    const yard = createDefaultYard();

    expect(Object.keys(yard.blocks)).toHaveLength(9);
    expect(yard.blocks["block-1"]).toEqual({
      x: 180,
      y: 642,
      angle: 0,
      style: "photo",
    });
    expect(
      new Set(Object.values(yard.blocks).map((block) => block.style)),
    ).toEqual(new Set(["css", "photo"]));
  });

  it("spawns added blocks across the top of the yard", () => {
    expect(createBlock("one", "css", 0)).toEqual({
      id: "one",
      transform: { x: 180, y: 100, angle: 0, style: "css" },
    });
    expect(createBlock("six", "photo", 5)).toEqual({
      id: "six",
      transform: { x: 180, y: 128, angle: 0, style: "photo" },
    });
  });

  it("rounds physics transforms before they enter shared state", () => {
    expect(
      roundTransform({
        position: { x: 101.256, y: 222.244 },
        angle: Math.PI / 2,
      }),
    ).toEqual({ x: 101.3, y: 222.2, angle: 1.5708 });
  });

  it("publishes only transforms with meaningful movement", () => {
    const previous = {
      quiet: { x: 100, y: 100, angle: 0 },
      moved: { x: 200, y: 200, angle: 0 },
    };
    const current = {
      quiet: { x: 100.2, y: 99.8, angle: 0.002 },
      moved: { x: 202, y: 200, angle: 0 },
      added: { x: 300, y: 100, angle: 0 },
    };

    expect(getChangedTransforms(current, previous)).toEqual({
      moved: current.moved,
      added: current.added,
    });
  });
});
