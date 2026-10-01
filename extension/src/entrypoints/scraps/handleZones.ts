// ABOUTME: Where the grips around a selection sit: edges scale, corners scale, just past corners turn.
// ABOUTME: Also the cursor each grip shows: the nearest system resize cursor, or a drawn rotate arrow.

import {
  boxCenter,
  cornerPoint,
  normalizeDegrees,
  pinInside,
  rotatePoint,
  type Bounds,
  type BoxEdge,
  type Point,
  type ResizeCorner,
} from "./collageGeometry";
import type { PlacedBox } from "./groupGeometry";

/** How far an edge's grip reaches either side of the line, in screen pixels. */
export const EDGE_GRIP_REACH = 5;
/** The corner handle's size on screen, which the edge grips stop short of. */
export const CORNER_HANDLE_SIZE = 13;
/** The side of the square just past each corner that turns the piece, in screen pixels. */
export const ROTATE_GRIP_SIZE = 22;
/**
 * How far the grips reach outside the box, in screen pixels. A panel floating
 * beside the selection keeps at least this far off so it never covers them.
 */
export const GRIP_REACH = ROTATE_GRIP_SIZE;

export const BOX_EDGES: readonly BoxEdge[] = ["top", "right", "bottom", "left"];
export const BOX_CORNERS: readonly ResizeCorner[] = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
];

/** Which way a corner points out of the box, in the box's own axes. */
function cornerSigns(corner: ResizeCorner): { x: -1 | 1; y: -1 | 1 } {
  return {
    x: corner === "top-left" || corner === "bottom-left" ? -1 : 1,
    y: corner === "top-left" || corner === "top-right" ? -1 : 1,
  };
}

/**
 * The direction of a resize cursor's arrow, in degrees with 0 pointing along
 * the screen's horizontal. An edge's arrow crosses the edge; a corner's runs
 * along the diagonal through it. Both turn with the piece.
 */
export function resizeCursorAngle(
  grip: BoxEdge | ResizeCorner,
  rotationDegrees: number,
): number {
  const base =
    grip === "left" || grip === "right"
      ? 0
      : grip === "top" || grip === "bottom"
        ? 90
        : grip === "top-left" || grip === "bottom-right"
          ? 45
          : 135;
  // A double-headed arrow reads the same half a turn round.
  return normalizeDegrees(base + rotationDegrees) % 180;
}

/**
 * Which way a rotate cursor faces for a corner, in degrees: its curve wraps
 * round the corner it sits beyond. The drawing faces the top-right corner at
 * zero, and each corner clockwise from there adds a quarter turn.
 */
export function rotateCursorAngle(
  corner: ResizeCorner,
  rotationDegrees: number,
): number {
  const base = {
    "top-right": 0,
    "bottom-right": 90,
    "bottom-left": 180,
    "top-left": 270,
  }[corner];
  return normalizeDegrees(base + rotationDegrees);
}

/** The browser's own resize cursors, one for each 45 degree direction. */
export type StandardResizeCursor =
  | "ew-resize"
  | "nwse-resize"
  | "ns-resize"
  | "nesw-resize";

/**
 * The browser's own resize cursor nearest to an arrow direction. The four
 * cursors are 45 degrees apart, so each covers the directions within 22.5
 * degrees of its own; a direction exactly on the boundary goes to the next
 * one round.
 */
export function resizeCursor(degrees: number): StandardResizeCursor {
  const step = Math.round(normalizeDegrees(degrees) / 45) % 4;
  return (["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const)[
    step
  ];
}

const CURSOR_INK = "#3d3833";
const CURSOR_HALO = "#fffdf9";
/** The rotate cursor's canvas, in pixels: the size a system cursor reads at. */
export const ROTATE_CURSOR_SIZE = 32;

/**
 * A curved arrow with a head at each end, wrapping round the corner its grip
 * sits beyond; `degrees` turns it to face that corner. It is drawn at a
 * system cursor's size, thick and ringed in white so it reads on dark and
 * light pictures alike, with its hotspot at its middle.
 */
export function rotateCursor(degrees: number): string {
  const middle = ROTATE_CURSOR_SIZE / 2;
  // A quarter circle about (9, 23), bulging toward the top-right; each head
  // points along the arc where it ends. The drawing spans (4, 6) to (26, 28),
  // so it is moved by (1, -1) to sit centered on the hotspot.
  const arc = `M9 11 A12 12 0 0 1 21 23`;
  const heads = `M3.5 11 L10.5 5 L10.5 17 Z M21 28.5 L15 21.5 L27 21.5 Z`;
  const body =
    `<g transform="translate(1 -1)">` +
    `<path d="${arc}" fill="none" stroke="${CURSOR_HALO}" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="${heads}" fill="${CURSOR_INK}" stroke="${CURSOR_HALO}" stroke-width="3" ` +
    `stroke-linejoin="round" paint-order="stroke"/>` +
    `<path d="${arc}" fill="none" stroke="${CURSOR_INK}" stroke-width="3" stroke-linecap="round"/>` +
    `</g>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ROTATE_CURSOR_SIZE}" height="${ROTATE_CURSOR_SIZE}" ` +
    `viewBox="0 0 ${ROTATE_CURSOR_SIZE} ${ROTATE_CURSOR_SIZE}">` +
    `<g transform="rotate(${Math.round(degrees)} ${middle} ${middle})">${body}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${middle} ${middle}, grab`;
}

/** One grip around the selection, laid out in frame space. */
export type HandleZone =
  | {
      kind: "edge";
      edge: BoxEdge;
      /** The grip's middle, in frame units. */
      center: Point;
      /** Its size on screen, in pixels, before it is turned. */
      width: number;
      height: number;
      rotation: number;
      cursor: string;
    }
  | {
      kind: "corner";
      corner: ResizeCorner;
      center: Point;
      /** Held at the edge of the view because the corner itself is out of it. */
      pinned: boolean;
      rotation: number;
      cursor: string;
    }
  | {
      kind: "rotate";
      corner: ResizeCorner;
      center: Point;
      width: number;
      height: number;
      rotation: number;
      cursor: string;
    };

/**
 * Every grip around a selection box. Edge grips run along each edge between
 * the corner handles, a few screen pixels either side of the line. Corner
 * handles sit on the corners, pinned into view when a corner is out of it.
 * Rotate grips are squares just past each corner, outside the box, and ride
 * with a pinned corner so it can still be turned. Sizes are in screen pixels
 * so the grips stay the same size at any zoom; an edge too short to hold a
 * grip between its corners has none.
 */
export function handleZones(
  box: PlacedBox,
  scale: number,
  inView: Bounds | null,
): HandleZone[] {
  if (scale <= 0) throw new Error("handleZones needs a positive zoom");
  const { rotation } = box;
  const radians = (rotation * Math.PI) / 180;
  const center = boxCenter(box);
  const zones: HandleZone[] = [];

  for (const edge of BOX_EDGES) {
    const side = edge === "left" || edge === "right";
    const length = (side ? box.height : box.width) * scale - CORNER_HANDLE_SIZE;
    if (length <= 0) continue;
    const middle = {
      x:
        edge === "left"
          ? box.x
          : edge === "right"
            ? box.x + box.width
            : center.x,
      y:
        edge === "top"
          ? box.y
          : edge === "bottom"
            ? box.y + box.height
            : center.y,
    };
    zones.push({
      kind: "edge",
      edge,
      center: rotatePoint(middle, center, radians),
      width: side ? EDGE_GRIP_REACH * 2 : length,
      height: side ? length : EDGE_GRIP_REACH * 2,
      rotation,
      cursor: resizeCursor(resizeCursorAngle(edge, rotation)),
    });
  }

  for (const corner of BOX_CORNERS) {
    const actual = cornerPoint(box, rotation, corner);
    const at = inView ? pinInside(actual, inView) : actual;
    const pinned = at.x !== actual.x || at.y !== actual.y;
    const out = cornerSigns(corner);
    // The square's middle sits half its side out along both of the box's
    // axes, so its inner corner touches the box's corner.
    const reach = ROTATE_GRIP_SIZE / 2 / scale;
    const offset = rotatePoint(
      { x: out.x * reach, y: out.y * reach },
      { x: 0, y: 0 },
      radians,
    );
    zones.push({
      kind: "rotate",
      corner,
      center: { x: at.x + offset.x, y: at.y + offset.y },
      width: ROTATE_GRIP_SIZE,
      height: ROTATE_GRIP_SIZE,
      rotation,
      cursor: rotateCursor(rotateCursorAngle(corner, rotation)),
    });
    zones.push({
      kind: "corner",
      corner,
      center: at,
      pinned,
      rotation,
      cursor: resizeCursor(resizeCursorAngle(corner, rotation)),
    });
  }
  return zones;
}
