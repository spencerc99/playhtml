// ABOUTME: Tests the bridge between table pieces and the scraps studio's piece tools.
// ABOUTME: Covers the round trip of placement, crop commits, layer moves, and duplicates.

import { describe, it, expect } from "vitest";
import { commitCropSession } from "@extension/entrypoints/scraps/collageRecord";
import {
  duplicatedPiece,
  placementFromStudio,
  reorderedZ,
  toStudioPiece,
} from "../collage/studioBridge";
import type { Piece, Pieces } from "../collage/pieces";

const piece = (id: string, overrides: Partial<Piece> = {}): Piece => ({
  id,
  src: `https://img.example.com/${id}.png`,
  pageUrl: "https://example.com",
  alt: "",
  placedByPid: "pk_a",
  placedByName: "a",
  placedByColor: "#f00",
  x: 0.5,
  y: 0.4,
  width: 0.2,
  aspect: 0.5,
  rotation: 30,
  z: 0,
  placedAt: 1,
  ...overrides,
});

const size = { width: 1000, height: 600 };

describe("toStudioPiece", () => {
  it("turns a centered fraction into a top-left pixel box", () => {
    const studio = toStudioPiece(piece("a"), size);
    expect(studio.width).toBe(200);
    expect(studio.height).toBe(100);
    expect(studio.x).toBe(400);
    expect(studio.y).toBe(190);
    expect(studio.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(studio.flipX).toBe(false);
    expect(studio.locked).toBeUndefined();
  });

  it("round-trips through placementFromStudio", () => {
    const original = piece("a");
    const back = placementFromStudio(toStudioPiece(original, size), size);
    expect(back.x).toBeCloseTo(original.x);
    expect(back.y).toBeCloseTo(original.y);
    expect(back.width).toBeCloseTo(original.width);
    expect(back.aspect).toBeCloseTo(original.aspect);
  });

  it("uses a gesture's transform over the stored one", () => {
    const studio = toStudioPiece(piece("a"), size, {
      x: 0.1,
      y: 0.1,
      width: 0.1,
      rotation: 0,
    });
    expect(studio.x).toBe(50);
    expect(studio.rotation).toBe(0);
  });
});

describe("crop commits", () => {
  it("shrinks the piece to the kept part and keeps that part in place", () => {
    const original = piece("a", { rotation: 0 });
    const studio = toStudioPiece(original, size);
    const kept = { x: 0.5, y: 0, width: 0.5, height: 1 };
    const placement = placementFromStudio(commitCropSession(studio, kept), size);
    expect(placement.crop).toEqual(kept);
    expect(placement.width).toBeCloseTo(0.1);
    // The right half stays where it was: its center moves right by a quarter
    // of the old width.
    expect(placement.x).toBeCloseTo(0.55);
    expect(placement.y).toBeCloseTo(original.y);
    expect(placement.aspect).toBeCloseTo(1);
  });
});

describe("reorderedZ", () => {
  const pieces: Pieces = {
    a: piece("a", { z: 3 }),
    b: piece("b", { z: 7 }),
    c: piece("c", { z: 9 }),
  };

  it("sends a piece to the back with only the changed z values", () => {
    expect(reorderedZ(pieces, "c", "back")).toEqual({ a: 1, b: 2, c: 0 });
  });

  it("steps a piece forward past its neighbor", () => {
    expect(reorderedZ(pieces, "a", "forward")).toEqual({ a: 1, b: 0, c: 2 });
  });

  it("keeps tied pieces in the order the table paints them", () => {
    // Tied on z: the table paints the earlier-placed piece first.
    const tied: Pieces = {
      later: piece("later", { z: 1, placedAt: 20 }),
      earlier: piece("earlier", { z: 1, placedAt: 10 }),
      other: piece("other", { z: 0 }),
    };
    // "later" keeps z 1, so only the other two are written.
    expect(reorderedZ(tied, "other", "front")).toEqual({
      earlier: 0,
      other: 2,
    });
  });

  it("writes nothing when the piece is already in front", () => {
    const stacked: Pieces = {
      a: piece("a", { z: 0 }),
      b: piece("b", { z: 1 }),
    };
    expect(reorderedZ(stacked, "b", "front")).toEqual({});
  });
});

describe("duplicatedPiece", () => {
  it("copies the edits, nudges it, and hands it to the copier unlocked", () => {
    const source = piece("a", {
      locked: true,
      crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      flipX: true,
    });
    const copy = duplicatedPiece(
      source,
      { pid: "pk_b", name: "b", color: "#0f0" },
      { id: "copy", now: 5, z: 10 },
    );
    expect(copy.id).toBe("copy");
    expect(copy.placedByPid).toBe("pk_b");
    expect(copy.z).toBe(10);
    expect(copy.x).toBeCloseTo(0.52);
    expect(copy.flipX).toBe(true);
    expect(copy.crop).toEqual(source.crop);
    expect(copy.crop).not.toBe(source.crop);
    expect("locked" in copy).toBe(false);
  });
});
