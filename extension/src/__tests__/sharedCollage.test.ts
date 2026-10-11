// ABOUTME: Tests how the studio trades edits on a shared collage.
// ABOUTME: Covers diffing settled arrangements and folding others' edits into undo history.

import { describe, expect, it } from "vitest";
import {
  createHistory,
  recordArrangement,
  undo,
} from "../entrypoints/scraps/arrangementHistory";
import type { CollagePiece } from "../entrypoints/scraps/collageRecord";
import {
  applyChange,
  piecesChange,
  piecesMap,
  rebaseHistory,
  samePiece,
} from "../entrypoints/scraps/sharedCollage";

const piece = (id: string, overrides: Partial<CollagePiece> = {}): CollagePiece => ({
  id,
  scrapId: id,
  scrap: {
    kind: "image",
    id,
    key: id,
    src: `https://img.test/${id}.png`,
    naturalWidth: 100,
    naturalHeight: 100,
    pageTitle: "",
    domain: "img.test",
    pageUrl: "https://img.test",
    ts: 0,
  },
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  z: 0,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  flipX: false,
  flipY: false,
  ...overrides,
});

describe("piecesChange", () => {
  it("reports edits, additions and removals", () => {
    const base = piecesMap([piece("a"), piece("b")]);
    const change = piecesChange(base, [piece("a", { x: 5 }), piece("c")]);
    expect(change.upserts.map((p) => p.id)).toEqual(["a", "c"]);
    expect(change.removedIds).toEqual(["b"]);
  });

  it("ignores rounding noise from a conversion round trip", () => {
    const a = piece("a", { x: 10 });
    expect(samePiece(a, { ...a, x: 10.0000001 })).toBe(true);
    expect(piecesChange(piecesMap([a]), [{ ...a, x: 10.0000001 }]).upserts).toEqual([]);
  });
});

describe("applyChange", () => {
  it("edits in place and adds new pieces on the end", () => {
    const next = applyChange([piece("a"), piece("b")], {
      upserts: [piece("b", { x: 3 }), piece("c")],
      removedIds: ["a"],
    });
    expect(next.map((p) => [p.id, p.x])).toEqual([
      ["b", 3],
      ["c", 0],
    ]);
  });
});

describe("rebaseHistory", () => {
  it("lets undo take back only this person's own edit", () => {
    // This person moves a; someone else then moves b. Undo returns a and
    // leaves b where they put it.
    let history = createHistory([piece("a"), piece("b")]);
    history = recordArrangement(history, [piece("a", { x: 50 }), piece("b")]);
    history = rebaseHistory(history, { upserts: [piece("b", { y: 80 })], removedIds: [] });
    const undone = undo(history).present;
    expect(undone.find((p) => p.id === "a")?.x).toBe(0);
    expect(undone.find((p) => p.id === "b")?.y).toBe(80);
  });

  it("never brings back a piece someone else removed", () => {
    let history = createHistory([piece("a"), piece("b")]);
    history = recordArrangement(history, [piece("a", { x: 50 }), piece("b")]);
    history = rebaseHistory(history, { upserts: [], removedIds: ["b"] });
    expect(undo(history).present.map((p) => p.id)).toEqual(["a"]);
  });
});
