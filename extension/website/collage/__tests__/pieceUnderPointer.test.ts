import { describe, expect, it } from "vitest";
import { pieceUnderPointer, type PieceBox } from "../pieceUnderPointer";

function box(overrides: Partial<PieceBox>): PieceBox {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    z: 0,
    seeThrough: false,
    ...overrides,
  };
}

describe("pieceUnderPointer", () => {
  it("picks the topmost piece holding the point", () => {
    const boxes = [
      box({ width: 400, height: 300, z: 0 }),
      box({ x: 50, y: 50, width: 40, height: 40, z: 1 }),
    ];
    expect(pieceUnderPointer(boxes, 60, 60)).toBe(1);
    expect(pieceUnderPointer(boxes, 200, 200)).toBe(0);
    expect(pieceUnderPointer(boxes, 500, 500)).toBeNull();
  });

  it("lets a small piece show through a big see-through piece on top", () => {
    const boxes = [
      box({ x: 50, y: 50, width: 40, height: 40, z: 0 }),
      box({ width: 400, height: 300, z: 1, seeThrough: true }),
    ];
    expect(pieceUnderPointer(boxes, 60, 60)).toBe(0);
    expect(pieceUnderPointer(boxes, 200, 200)).toBe(1);
  });

  it("keeps an opaque piece on top over what it covers", () => {
    const boxes = [
      box({ x: 50, y: 50, width: 40, height: 40, z: 0 }),
      box({ width: 400, height: 300, z: 1 }),
    ];
    expect(pieceUnderPointer(boxes, 60, 60)).toBe(1);
  });

  it("follows a piece's rotation", () => {
    const boxes = [box({ x: 0, y: 0, width: 200, height: 20, rotation: 90 })];
    // Turned upright about its centre (100, 10), it spans x 90..110, y -90..110.
    expect(pieceUnderPointer(boxes, 100, 100)).toBe(0);
    expect(pieceUnderPointer(boxes, 10, 10)).toBeNull();
  });
});
