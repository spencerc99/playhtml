// ABOUTME: Snapping for pieces being carried: edges and middles catch on other pieces and the frame.
// ABOUTME: Returns the nudge that lines them up and the guide lines to draw while they hold.

import type { Bounds, Point } from "./collageGeometry";

/** A line drawn while a snap holds, in frame units. */
export interface SnapGuide {
  axis: "x" | "y";
  /** Where the line sits across its axis: an x for a vertical line. */
  at: number;
  /** Where it starts and ends along the other axis. */
  from: number;
  to: number;
}

export interface MoveSnap {
  /** The travel after snapping, to use in place of the raw travel. */
  delta: Point;
  guides: SnapGuide[];
  /**
   * Names what each axis caught on, so a caller can tell a fresh catch from
   * one that is still holding; null where that axis is free.
   */
  caught: { x: string | null; y: string | null };
}

interface Line {
  at: number;
  /** The span of the box the line belongs to, along the other axis. */
  from: number;
  to: number;
  key: string;
}

function linesAcross(box: Bounds, axis: "x" | "y", key: string): Line[] {
  const start = axis === "x" ? box.x : box.y;
  const size = axis === "x" ? box.width : box.height;
  const from = axis === "x" ? box.y : box.x;
  const to = from + (axis === "x" ? box.height : box.width);
  return [
    { at: start, from, to, key: `${key}:start` },
    { at: start + size / 2, from, to, key: `${key}:middle` },
    { at: start + size, from, to, key: `${key}:end` },
  ];
}

/**
 * Finds the closest line on one axis the moving box can catch on, within
 * `reach`. Edges catch edges and middles catch middles, as well as edges on
 * middles, so a piece can be lined up, centered or butted against another.
 */
function catchOn(
  moving: Bounds,
  targets: readonly Line[],
  axis: "x" | "y",
  reach: number,
): { shift: number; target: Line; own: Line } | null {
  let best: { shift: number; target: Line; own: Line } | null = null;
  for (const own of linesAcross(moving, axis, "moving")) {
    for (const target of targets) {
      const shift = target.at - own.at;
      if (Math.abs(shift) > reach) continue;
      if (!best || Math.abs(shift) < Math.abs(best.shift)) {
        best = { shift, target, own };
      }
    }
  }
  return best;
}

/**
 * Snaps a carried group so its edges or middle line up with another piece or
 * the frame. `moving` is the group's upright bounds before the travel;
 * `others` are the upright bounds of the pieces staying put. `lock` keeps a
 * shift-drag on its axis, so only that axis snaps.
 */
export function snapMove(options: {
  moving: Bounds;
  travel: Point;
  others: readonly Bounds[];
  frame: { width: number; height: number };
  reach: number;
  lock?: "x" | "y" | null;
}): MoveSnap {
  const { moving, travel, others, frame, reach, lock = null } = options;
  const moved: Bounds = {
    ...moving,
    x: moving.x + travel.x,
    y: moving.y + travel.y,
  };
  const frameBox: Bounds = { x: 0, y: 0, ...frame };
  const delta = { ...travel };
  const caught: MoveSnap["caught"] = { x: null, y: null };
  const held: { axis: "x" | "y"; target: Line }[] = [];

  for (const axis of ["x", "y"] as const) {
    if (lock && lock !== axis) continue;
    const targets = [
      ...linesAcross(frameBox, axis, "frame"),
      ...others.flatMap((box, i) => linesAcross(box, axis, `piece${i}`)),
    ];
    const hit = catchOn(moved, targets, axis, reach);
    if (!hit) continue;
    delta[axis] += hit.shift;
    caught[axis] = `${hit.target.key}~${hit.own.key}`;
    held.push({ axis, target: hit.target });
  }

  // Each guide runs across both boxes where they ended up, so it shows what
  // lined up with what.
  const landed: Bounds = {
    ...moving,
    x: moving.x + delta.x,
    y: moving.y + delta.y,
  };
  const guides: SnapGuide[] = held.map(({ axis, target }) => {
    const from = axis === "x" ? landed.y : landed.x;
    const to = from + (axis === "x" ? landed.height : landed.width);
    return {
      axis,
      at: target.at,
      from: Math.min(target.from, from),
      to: Math.max(target.to, to),
    };
  });
  return { delta, guides, caught };
}
