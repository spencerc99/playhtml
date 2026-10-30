// ABOUTME: Tests the bridge between table pieces and the scraps studio's piece tools.
// ABOUTME: Covers the round trip of placement, crop commits, and turning studio edits into table writes.

import { describe, it, expect } from "vitest";
import { commitCropSession } from "@extension/entrypoints/scraps/collageRecord";
import {
  TABLE_FRAME,
  placementFromStudio,
  studioPieces,
  piecePatch,
  tableChange,
  tablePiece,
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

describe("tablePiece", () => {
  const placer = { pid: "pk_b", name: "b", color: "#0f0" };

  it("keeps who placed an existing piece and writes the edit", () => {
    const original = piece("a", { crop: { x: 0.1, y: 0, width: 0.5, height: 1 } });
    const [studio] = studioPieces({ a: original });
    const edited = { ...studio, rotation: 12, flipX: true, crop: { x: 0, y: 0, width: 1, height: 1 } };
    const back = tablePiece(edited, original, placer, 99);
    expect(back.placedByPid).toBe("pk_a");
    expect(back.placedAt).toBe(1);
    expect(back.rotation).toBe(12);
    expect(back.flipX).toBe(true);
    expect(back.x).toBeCloseTo(original.x);
    // A whole crop is left out rather than stored.
    expect("crop" in back).toBe(false);
  });

  it("hands a new piece to whoever made it, with the page it came from", () => {
    const [studio] = studioPieces({ a: piece("a") });
    const copy = {
      ...studio,
      id: "copy",
      scrap: { ...studio.scrap, pageUrl: "https://example.com/private/path?q=1" },
      locked: true as const,
    };
    const made = tablePiece(copy, undefined, placer, 99);
    expect(made).toMatchObject({
      id: "copy",
      placedByPid: "pk_b",
      placedByName: "b",
      placedAt: 99,
      pageUrl: "https://example.com/private/path?q=1",
      locked: true,
    });
  });

  it("drops cutout and lock when the studio took them off", () => {
    const original = piece("a", {
      locked: true,
      cutout: { method: "edge-color", tolerance: 30 },
    });
    const [studio] = studioPieces({ a: original });
    const { cutout: _cutout, locked: _locked, ...plain } = studio;
    const back = tablePiece(plain, original, placer, 0);
    expect("cutout" in back).toBe(false);
    expect("locked" in back).toBe(false);
  });
});

describe("tableChange", () => {
  it("writes upserts and removes only pieces the table has", () => {
    const pieces: Pieces = { a: piece("a"), b: piece("b") };
    const [studioA] = studioPieces({ a: pieces.a });
    const change = tableChange(
      { upserts: [{ ...studioA, rotation: 0 }], removedIds: ["b", "ghost"] },
      pieces,
      { pid: "pk_a", name: "a", color: "#f00" },
      5,
    );
    expect(change.write.map((p) => p.id)).toEqual(["a"]);
    expect(change.remove).toEqual(["b"]);
  });

  it("patches only the fields an edit changed", () => {
    const stored = piece("a");
    const [before] = studioPieces({ a: stored });
    const placer = { pid: "pk_b", name: "b", color: "#00f" };
    // Turning a scrap writes its rotation and nothing else.
    const turned = piecePatch(before, { ...before, rotation: 75 }, stored, placer, 9);
    expect(turned).toEqual({ set: { rotation: 75 }, unset: [] });
    // Moving it writes its position, leaving a rotation someone else just set.
    const moved = piecePatch(before, { ...before, x: before.x + 160 }, stored, placer, 9);
    expect(Object.keys(moved.set)).toEqual(["x"]);
    expect(moved.unset).toEqual([]);
  });

  it("takes away a field the edit removed", () => {
    const stored = piece("a", { locked: true });
    const [before] = studioPieces({ a: stored });
    const { locked: _locked, ...unlocked } = before;
    const patch = piecePatch(before, unlocked, stored, { pid: "pk_a", name: "a", color: "#f00" }, 9);
    expect(patch).toEqual({ set: {}, unset: ["locked"] });
  });

  it("lays the table out at one shared frame", () => {
    expect(TABLE_FRAME.width / TABLE_FRAME.height).toBeCloseTo(1.6);
  });
});
