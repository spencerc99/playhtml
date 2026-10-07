// ABOUTME: Tests the grips around a collage selection: where each sits, what a point lands in, which cursor shows.
// ABOUTME: Also the edge-drag math, including an edge dragged past its opposite side.

import { describe, expect, it } from "vitest";
import {
  MIN_PIECE_SIDE,
  boxCenter,
  cornerPoint,
  dragEdge,
  edgeGrabOffset,
  rotatePoint,
  type Point,
} from "../entrypoints/scraps/collageGeometry";
import {
  CORNER_HANDLE_SIZE,
  EDGE_GRIP_REACH,
  ROTATE_GRIP_SIZE,
  handleZones,
  resizeCursor,
  resizeCursorAngle,
  rotateCursor,
  rotateCursorAngle,
  type HandleZone,
} from "../entrypoints/scraps/handleZones";
import { groupScaleFromEdge } from "../entrypoints/scraps/groupGeometry";

const box = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };

/** Whether a frame-space point falls inside a grip, as the page would hit it. */
function holds(zone: HandleZone, point: Point, scale: number): boolean {
  const width = zone.kind === "corner" ? CORNER_HANDLE_SIZE : zone.width;
  const height = zone.kind === "corner" ? CORNER_HANDLE_SIZE : zone.height;
  const local = rotatePoint(point, zone.center, (-zone.rotation * Math.PI) / 180);
  return (
    Math.abs(local.x - zone.center.x) <= width / 2 / scale &&
    Math.abs(local.y - zone.center.y) <= height / 2 / scale
  );
}

/** The grip a point lands in, taking the stacking into account. */
function gripAt(zones: HandleZone[], point: Point, scale: number): string | null {
  for (const kind of ["corner", "edge", "rotate"] as const) {
    const found = zones.find((zone) => zone.kind === kind && holds(zone, point, scale));
    if (found) {
      return found.kind === "edge" ? `edge-${found.edge}` : `${found.kind}-${found.corner}`;
    }
  }
  return null;
}

describe("the grips around a selection", () => {
  it("has four edges, four corner handles and four rotate squares", () => {
    const zones = handleZones(box, 1, null);
    expect(zones.filter((zone) => zone.kind === "edge")).toHaveLength(4);
    expect(zones.filter((zone) => zone.kind === "corner")).toHaveLength(4);
    expect(zones.filter((zone) => zone.kind === "rotate")).toHaveLength(4);
  });

  it("runs each edge grip along its edge between the corner handles", () => {
    const zones = handleZones(box, 1, null);
    const top = zones.find((zone) => zone.kind === "edge" && zone.edge === "top");
    if (top?.kind !== "edge") throw new Error("no top edge");
    expect(top.center).toEqual({ x: 200, y: 100 });
    expect(top.width).toBe(200 - CORNER_HANDLE_SIZE);
    expect(top.height).toBe(EDGE_GRIP_REACH * 2);
  });

  it("sends a point on an edge to that edge and a point on a corner to the handle", () => {
    const zones = handleZones(box, 1, null);
    expect(gripAt(zones, { x: 200, y: 103 }, 1)).toBe("edge-top");
    expect(gripAt(zones, { x: 297, y: 150 }, 1)).toBe("edge-right");
    expect(gripAt(zones, { x: 300, y: 200 }, 1)).toBe("corner-bottom-right");
  });

  it("turns from just outside a corner, and nowhere far off", () => {
    const zones = handleZones(box, 1, null);
    expect(gripAt(zones, { x: 88, y: 88 }, 1)).toBe("rotate-top-left");
    expect(gripAt(zones, { x: 315, y: 215 }, 1)).toBe("rotate-bottom-right");
    expect(gripAt(zones, { x: 100 - ROTATE_GRIP_SIZE - 4, y: 70 }, 1)).toBeNull();
    // The middle of the piece is left to the piece.
    expect(gripAt(zones, { x: 200, y: 150 }, 1)).toBeNull();
  });

  it("keeps every grip the same size on screen at any zoom", () => {
    const zones = handleZones(box, 0.5, null);
    // At half zoom 15 screen pixels past the corner is 30 frame units out.
    expect(gripAt(zones, { x: 70, y: 70 }, 0.5)).toBe("rotate-top-left");
    const top = zones.find((zone) => zone.kind === "edge" && zone.edge === "top");
    if (top?.kind !== "edge") throw new Error("no top edge");
    expect(top.height).toBe(EDGE_GRIP_REACH * 2);
    expect(top.width).toBe(200 * 0.5 - CORNER_HANDLE_SIZE);
  });

  it("turns with a turned piece", () => {
    const turned = { ...box, rotation: 90 };
    const zones = handleZones(turned, 1, null);
    // Turned a quarter, the piece's own top edge runs down its right side.
    const center = boxCenter(turned);
    expect(gripAt(zones, { x: center.x + 50, y: center.y }, 1)).toBe("edge-top");
    const corner = cornerPoint(turned, 90, "top-left");
    expect(gripAt(zones, corner, 1)).toBe("corner-top-left");
    // Past the turned corner, out along both of the piece's own axes.
    const past = rotatePoint(
      { x: turned.x - 10, y: turned.y - 10 },
      center,
      Math.PI / 2,
    );
    expect(gripAt(zones, past, 1)).toBe("rotate-top-left");
  });

  it("drops an edge too short to hold a grip between its corners", () => {
    const small = { x: 0, y: 0, width: 10, height: 100, rotation: 0 };
    const edges = handleZones(small, 1, null).filter((zone) => zone.kind === "edge");
    expect(edges.map((zone) => zone.kind === "edge" && zone.edge).sort()).toEqual([
      "left",
      "right",
    ]);
  });

  it("pins a corner out of view and keeps its rotate square beside it", () => {
    const inView = { x: 0, y: 0, width: 250, height: 500 };
    const zones = handleZones(box, 1, inView);
    const corner = zones.find(
      (zone) => zone.kind === "corner" && zone.corner === "top-right",
    );
    const turn = zones.find(
      (zone) => zone.kind === "rotate" && zone.corner === "top-right",
    );
    if (corner?.kind !== "corner" || turn?.kind !== "rotate") throw new Error("missing");
    expect(corner.pinned).toBe(true);
    expect(corner.center).toEqual({ x: 250, y: 100 });
    expect(turn.center).toEqual({
      x: 250 + ROTATE_GRIP_SIZE / 2,
      y: 100 - ROTATE_GRIP_SIZE / 2,
    });
  });

  it("refuses a zoom of zero", () => {
    expect(() => handleZones(box, 0, null)).toThrow();
  });
});

describe("the cursor over each grip", () => {
  it("points a resize arrow across an edge and along a corner's diagonal", () => {
    expect(resizeCursorAngle("left", 0)).toBe(0);
    expect(resizeCursorAngle("top", 0)).toBe(90);
    expect(resizeCursorAngle("top-left", 0)).toBe(45);
    expect(resizeCursorAngle("top-right", 0)).toBe(135);
  });

  it("turns the arrow with the piece, reading the same half a turn round", () => {
    expect(resizeCursorAngle("left", 30)).toBe(30);
    expect(resizeCursorAngle("top", 120)).toBe(30);
    expect(resizeCursorAngle("bottom-right", 150)).toBe(15);
  });

  it("faces the rotate curve round its own corner", () => {
    expect(rotateCursorAngle("top-right", 0)).toBe(0);
    expect(rotateCursorAngle("bottom-right", 0)).toBe(90);
    expect(rotateCursorAngle("bottom-left", 0)).toBe(180);
    expect(rotateCursorAngle("top-left", 0)).toBe(270);
    expect(rotateCursorAngle("top-left", 100)).toBe(10);
  });

  it("uses the system resize cursor nearest each arrow direction", () => {
    expect(resizeCursor(0)).toBe("ew-resize");
    expect(resizeCursor(45)).toBe("nwse-resize");
    expect(resizeCursor(90)).toBe("ns-resize");
    expect(resizeCursor(135)).toBe("nesw-resize");
    expect(resizeCursor(180)).toBe("ew-resize");
    expect(resizeCursor(-45)).toBe("nesw-resize");
  });

  it("switches cursor exactly at the 22.5 degree boundaries", () => {
    expect(resizeCursor(22.4)).toBe("ew-resize");
    expect(resizeCursor(22.6)).toBe("nwse-resize");
    expect(resizeCursor(67.4)).toBe("nwse-resize");
    expect(resizeCursor(67.6)).toBe("ns-resize");
    expect(resizeCursor(112.4)).toBe("ns-resize");
    expect(resizeCursor(112.6)).toBe("nesw-resize");
    expect(resizeCursor(157.4)).toBe("nesw-resize");
    expect(resizeCursor(157.6)).toBe("ew-resize");
    expect(resizeCursor(359.9)).toBe("ew-resize");
  });

  it("picks the cursor for a grip on a turned selection", () => {
    // A left edge turned 20 degrees still reads across; turned 30 it reads
    // along the down-right diagonal.
    expect(resizeCursor(resizeCursorAngle("left", 20))).toBe("ew-resize");
    expect(resizeCursor(resizeCursorAngle("left", 30))).toBe("nwse-resize");
    expect(resizeCursor(resizeCursorAngle("top", 0))).toBe("ns-resize");
    expect(resizeCursor(resizeCursorAngle("top-left", 30))).toBe("ns-resize");
    expect(resizeCursor(resizeCursorAngle("top-right", 0))).toBe("nesw-resize");
    expect(resizeCursor(resizeCursorAngle("bottom-left", 90))).toBe("nwse-resize");
  });

  it("gives each grip its cursor", () => {
    const zones = handleZones({ ...box, rotation: 30 }, 1, null);
    const cursorOf = (name: string) =>
      zones.find((zone) =>
        zone.kind === "edge" ? `edge-${zone.edge}` === name : `${zone.kind}-${zone.corner}` === name,
      )?.cursor;
    expect(cursorOf("edge-left")).toBe("nwse-resize");
    expect(cursorOf("corner-top-left")).toBe("ns-resize");
    expect(cursorOf("rotate-top-left")).toMatch(/^url\("data:image\/svg\+xml,/);
  });

  it("draws the rotate cursor at a system cursor's size with its hotspot in the middle", () => {
    const cursor = rotateCursor(90);
    expect(cursor).toMatch(/ 16 16, grab$/);
    const svg = decodeURIComponent(cursor);
    expect(svg).toContain('width="32" height="32"');
    expect(svg).toContain("rotate(90 16 16)");
    // A white ring under the ink so it reads on any picture.
    expect(svg).toContain('stroke="#fffdf9" stroke-width="7"');
  });

  it("uses no emoji", () => {
    const text = decodeURIComponent(resizeCursor(10) + rotateCursor(10));
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });
});

describe("dragging an edge", () => {
  const piece = { x: 100, y: 100, width: 200, height: 100 };

  it("scales the whole piece evenly by default, growing from the opposite edge", () => {
    const drag = dragEdge({
      box: piece,
      rotationDegrees: 0,
      edge: "right",
      pointer: { x: 500, y: 130 },
      keepAspect: true,
      aboutCenter: false,
    });
    expect(drag.box).toEqual({ x: 100, y: 50, width: 400, height: 200 });
    expect(drag.flippedX || drag.flippedY).toBe(false);
  });

  it("stretches along one axis with the aspect freed", () => {
    const drag = dragEdge({
      box: piece,
      rotationDegrees: 0,
      edge: "bottom",
      pointer: { x: 0, y: 300 },
      keepAspect: false,
      aboutCenter: false,
    });
    expect(drag.box).toEqual({ x: 100, y: 100, width: 200, height: 200 });
  });

  it("grows about the center with alt", () => {
    const drag = dragEdge({
      box: piece,
      rotationDegrees: 0,
      edge: "left",
      pointer: { x: 0, y: 150 },
      keepAspect: false,
      aboutCenter: true,
    });
    expect(drag.box).toEqual({ x: 0, y: 100, width: 400, height: 100 });
  });

  it("turns the piece over when dragged past the opposite edge", () => {
    const drag = dragEdge({
      box: piece,
      rotationDegrees: 0,
      edge: "right",
      pointer: { x: 0, y: 150 },
      keepAspect: true,
      aboutCenter: false,
    });
    expect(drag.flippedX).toBe(true);
    expect(drag.flippedY).toBe(false);
    // Half as wide on the far side, and half as tall about the same middle.
    expect(drag.box).toEqual({ x: 0, y: 125, width: 100, height: 50 });
  });

  it("scales a turned piece along its own axis and keeps the far edge still", () => {
    const rotation = 30;
    const farBefore = cornerPoint(piece, rotation, "top-left");
    // A point three hundred units out along the piece's own x axis from its left edge.
    const out = rotatePoint(
      { x: piece.x + 300, y: piece.y + 50 },
      boxCenter(piece),
      (rotation * Math.PI) / 180,
    );
    const drag = dragEdge({
      box: piece,
      rotationDegrees: rotation,
      edge: "right",
      pointer: out,
      keepAspect: false,
      aboutCenter: false,
    });
    expect(drag.box.width).toBeCloseTo(300, 6);
    expect(drag.box.height).toBeCloseTo(100, 6);
    const farAfter = cornerPoint(drag.box, rotation, "top-left");
    expect(farAfter.x).toBeCloseTo(farBefore.x, 6);
    expect(farAfter.y).toBeCloseTo(farBefore.y, 6);
  });

  it("never shrinks below the smallest side", () => {
    const drag = dragEdge({
      box: piece,
      rotationDegrees: 0,
      edge: "right",
      pointer: { x: 100, y: 150 },
      keepAspect: false,
      aboutCenter: false,
    });
    expect(drag.box.width).toBeCloseTo(MIN_PIECE_SIDE, 6);
  });

  it("measures a press from the edge line, whichever way the piece is turned", () => {
    const offset = edgeGrabOffset(piece, 0, "right", { x: 296, y: 170 });
    expect(offset).toEqual({ x: 4, y: 0 });
    const turned = edgeGrabOffset(piece, 90, "right", rotatePoint({ x: 296, y: 150 }, boxCenter(piece), Math.PI / 2));
    expect(turned.x).toBeCloseTo(0, 6);
    expect(turned.y).toBeCloseTo(4, 6);
  });
});

describe("dragging an edge of a group's box", () => {
  const bounds = { x: 0, y: 0, width: 200, height: 100 };

  it("scales the group evenly about the middle of the opposite edge", () => {
    expect(
      groupScaleFromEdge({ bounds, edge: "right", pointer: { x: 400, y: 20 }, keepAspect: true, aboutCenter: false }),
    ).toEqual({ anchor: { x: 0, y: 50 }, x: 2, y: 2 });
  });

  it("stretches one axis with the aspect freed and turns over past the far edge", () => {
    const grow = groupScaleFromEdge({
      bounds,
      edge: "top",
      pointer: { x: 0, y: 150 },
      keepAspect: false,
      aboutCenter: false,
    });
    expect(grow).toEqual({ anchor: { x: 100, y: 100 }, x: 1, y: -0.5 });
  });
});
