import { describe, expect, it } from "vitest";
import { snapMove } from "../entrypoints/scraps/moveSnap";

const frame = { width: 1000, height: 800 };
const moving = { x: 100, y: 100, width: 100, height: 100 };

describe("snapMove", () => {
  it("leaves the travel alone when nothing is within reach", () => {
    const snap = snapMove({
      moving,
      travel: { x: 37, y: 41 },
      others: [],
      frame,
      reach: 6,
    });
    expect(snap.delta).toEqual({ x: 37, y: 41 });
    expect(snap.guides).toEqual([]);
    expect(snap.caught).toEqual({ x: null, y: null });
  });

  it("butts an edge against another piece's edge", () => {
    // Carried right so its right edge (200 + 296) nears the other's left at 500.
    const snap = snapMove({
      moving,
      travel: { x: 296, y: 33 },
      others: [{ x: 500, y: 300, width: 80, height: 80 }],
      frame: { width: 1200, height: 800 },
      reach: 6,
    });
    expect(snap.delta.x).toBe(300);
    expect(snap.delta.y).toBe(33);
    expect(snap.guides).toEqual([{ axis: "x", at: 500, from: 133, to: 380 }]);
    expect(snap.caught.x).not.toBeNull();
  });

  it("centers on the frame's middle", () => {
    const snap = snapMove({
      moving,
      travel: { x: 352, y: 0 },
      others: [],
      frame,
      reach: 6,
    });
    // Middle of the piece (150 + 352 = 502) catches the frame's middle at 500.
    expect(snap.delta.x).toBe(350);
  });

  it("snaps only along the locked axis on a shift-drag", () => {
    const snap = snapMove({
      moving,
      travel: { x: 0, y: 302 },
      others: [{ x: 203, y: 500, width: 80, height: 80 }],
      frame,
      reach: 6,
      lock: "y",
    });
    expect(snap.delta).toEqual({ x: 0, y: 300 });
  });
});
