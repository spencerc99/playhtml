// ABOUTME: Tests the two-finger pinch on collage pieces: spreading grows, turning rotates, sliding moves.
// ABOUTME: Checks one piece and a group, and that a pinch that has not moved changes nothing.

import { describe, expect, it } from "vitest";
import {
  pinchChange,
  pinchedPieces,
  type FingerPair,
} from "../entrypoints/scraps/pinchGesture";

function piece(x: number, y: number, width: number, height: number) {
  return { x, y, width, height, rotation: 0, flipX: false, flipY: false };
}

const start: FingerPair = { a: { x: 100, y: 100 }, b: { x: 200, y: 100 } };

describe("pinch on collage pieces", () => {
  it("leaves the pieces as they were while the fingers stay put", () => {
    const before = [piece(50, 50, 200, 100)];
    const [after] = pinchedPieces(before, start, start);
    expect(after.x).toBeCloseTo(50);
    expect(after.y).toBeCloseTo(50);
    expect(after.width).toBeCloseTo(200);
    expect(after.height).toBeCloseTo(100);
    expect(after.rotation).toBeCloseTo(0);
  });

  it("grows a piece about its middle as the fingers spread", () => {
    const before = [piece(50, 50, 200, 100)];
    const now: FingerPair = { a: { x: 50, y: 100 }, b: { x: 250, y: 100 } };
    const [after] = pinchedPieces(before, start, now);
    expect(after.width).toBeCloseTo(400);
    expect(after.height).toBeCloseTo(200);
    // The middle of the piece and of the fingers both stay at (150, 100).
    expect(after.x + after.width / 2).toBeCloseTo(150);
    expect(after.y + after.height / 2).toBeCloseTo(100);
  });

  it("turns a piece by as much as the fingers turn", () => {
    const before = [piece(50, 50, 200, 100)];
    const now: FingerPair = { a: { x: 150, y: 50 }, b: { x: 150, y: 150 } };
    const [after] = pinchedPieces(before, start, now);
    expect(after.rotation).toBeCloseTo(90);
    expect(after.width).toBeCloseTo(200);
  });

  it("carries the pieces with the point between the fingers", () => {
    const before = [piece(50, 50, 200, 100)];
    const now: FingerPair = { a: { x: 130, y: 140 }, b: { x: 230, y: 140 } };
    const [after] = pinchedPieces(before, start, now);
    expect(after.x).toBeCloseTo(80);
    expect(after.y).toBeCloseTo(90);
  });

  it("spreads a group apart about the group's middle", () => {
    const before = [piece(0, 0, 100, 100), piece(200, 0, 100, 100)];
    const now: FingerPair = { a: { x: 50, y: 100 }, b: { x: 250, y: 100 } };
    const [left, right] = pinchedPieces(before, start, now);
    // The group's middle is (150, 50); each piece's middle moves twice as far from it.
    expect(left.x + left.width / 2).toBeCloseTo(-50);
    expect(right.x + right.width / 2).toBeCloseTo(350);
    expect(left.width).toBeCloseTo(200);
  });

  it("does not let a pinch shrink pieces to nothing", () => {
    const now: FingerPair = { a: { x: 150, y: 100 }, b: { x: 150, y: 100 } };
    expect(pinchChange(start, now).factor).toBeGreaterThan(0);
  });
});
