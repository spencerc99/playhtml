import { describe, expect, it } from "vitest";
import type { CollagePiece } from "@extension/entrypoints/scraps/collageRecord";
import {
  applyWrites,
  collageEntry,
  newCollageId,
  peopleOf,
  pieceWrites,
  removalRefusal,
  studioPieces,
  withDrafts,
  type StoredPiece,
} from "../togetherPieces";

function piece(
  id: string,
  overrides: Partial<CollagePiece> = {},
): CollagePiece {
  return {
    id,
    scrapId: id,
    scrap: {
      kind: "image",
      id,
      key: id,
      src: `https://example.com/${id}.jpg`,
      naturalWidth: 400,
      naturalHeight: 300,
      pageTitle: "",
      domain: "example.com",
      pageUrl: "https://example.com",
      ts: 1,
    },
    x: 100,
    y: 100,
    width: 300,
    height: 200,
    rotation: 0,
    z: 1,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
    ...overrides,
  } as CollagePiece;
}

const ME = { pid: "me", name: "spencer", color: "#ffae00" };
const MIRA = { pid: "mira", name: "mira", color: "#e0752d" };

describe("pieceWrites", () => {
  it("writes a new piece whole, marked with who placed it", () => {
    const { writes } = pieceWrites(
      { upserts: [piece("a")], removedIds: [] },
      {},
      ME,
    );
    expect(writes).toHaveLength(1);
    expect(writes[0].whole?.by).toEqual(ME);
  });

  it("writes only the fields an edit changed, so a concurrent edit to another field survives", () => {
    const before = piece("a");
    const stored: Record<string, StoredPiece> = { a: { ...before, by: MIRA } };
    const moved = { ...before, x: 400 };
    const { writes } = pieceWrites(
      { upserts: [moved], removedIds: [], before: new Map([["a", before]]) },
      stored,
      ME,
    );
    expect(writes).toEqual([{ id: "a", set: { x: 400 }, unset: [] }]);

    // Someone else rotated it meanwhile; applying the move keeps their rotation.
    stored.a.rotation = 12;
    applyWrites(stored, writes, []);
    expect(stored.a.x).toBe(400);
    expect(stored.a.rotation).toBe(12);
    expect(stored.a.by).toEqual(MIRA);
  });

  it("takes away a field the edit removed, and skips removals of pieces already gone", () => {
    const before = piece("a", { locked: true });
    const { locked: _locked, ...after } = before;
    const stored = { a: { ...before, by: ME } };
    const result = pieceWrites(
      {
        upserts: [after as CollagePiece],
        removedIds: ["gone"],
        before: new Map([["a", before]]),
      },
      stored,
      ME,
    );
    expect(result.writes).toEqual([{ id: "a", set: {}, unset: ["locked"] }]);
    expect(result.removedIds).toEqual([]);
  });
});

describe("withDrafts", () => {
  it("lays another person's drag over the stored piece but never brings back a removed one", () => {
    const stored = { a: { ...piece("a"), by: MIRA } };
    const shown = withDrafts(stored, [
      {
        isMe: false,
        live: { draft: [piece("a", { x: 900 }), piece("removed")] },
      },
      { isMe: true, live: { draft: [piece("a", { x: 5 })] } },
    ]);
    expect(shown.a.x).toBe(900);
    expect(shown.a.by).toEqual(MIRA);
    expect(shown.removed).toBeUndefined();
    expect(stored.a.x).toBe(100);
  });
});

describe("removalRefusal", () => {
  it("lets only the placer remove a piece", () => {
    const stored = { ...piece("a"), by: MIRA };
    expect(removalRefusal(stored, "mira")).toBeNull();
    expect(removalRefusal(stored, "me")).toBe(
      "only mira can remove this scrap",
    );
  });
});

describe("collageEntry", () => {
  it("summarizes the collage for the extension's list", () => {
    const pieces = {
      a: { ...piece("a", { z: 2 }), by: ME },
      b: { ...piece("b", { z: 1, x: 750, y: 500 }), by: MIRA },
    };
    const entry = collageEntry({
      id: "abcd1234",
      url: "https://wewere.online/together/?c=abcd1234",
      data: { title: "buttons", pieces },
      myPid: "me",
      startedByMe: true,
      now: 10,
    });
    expect(entry.pieceCount).toBe(2);
    expect(entry.people).toEqual([{ name: "mira", color: "#e0752d" }]);
    expect(entry.cover.pieces.map((p) => p.src)).toEqual([
      "https://example.com/b.jpg",
      "https://example.com/a.jpg",
    ]);
    expect(entry.cover.pieces[0]).toMatchObject({
      x: 0.5,
      y: 0.5,
      width: 0.2,
      height: 0.2,
    });
  });

  it("names each other person once", () => {
    const pieces = {
      a: { ...piece("a"), by: MIRA },
      b: { ...piece("b"), by: MIRA },
      c: { ...piece("c"), by: { pid: "x", color: "#123456" } },
    };
    expect(peopleOf(pieces, "me")).toEqual([
      { name: "mira", color: "#e0752d" },
      { color: "#123456" },
    ]);
  });
});

describe("studioPieces and newCollageId", () => {
  it("orders pieces by stacking order and strips who placed them", () => {
    const shown = studioPieces({
      a: { ...piece("a", { z: 3 }), by: ME },
      b: { ...piece("b", { z: 1 }), by: ME },
    });
    expect(shown.map((p) => p.id)).toEqual(["b", "a"]);
    expect("by" in shown[0]).toBe(false);
  });

  it("makes url-safe ids", () => {
    expect(newCollageId(new Uint8Array(12).fill(7))).toMatch(/^[a-z0-9]{12}$/);
  });
});
