// ABOUTME: Works out which pieces lie under a point and which one a click takes.
// ABOUTME: Pure geometry, so reaching a buried piece behaves the same everywhere.

import { toLocalPoint, type Point } from "./collageGeometry";
import type { CollagePiece } from "./collageRecord";

/**
 * Whether a frame-space point falls inside a piece, taking its rotation into
 * account. The box is the piece's visible area, so this matches what a click
 * on screen would hit.
 */
export function pieceHoldsPoint(piece: CollagePiece, point: Point): boolean {
  const local = toLocalPoint(point, piece, piece.rotation);
  return (
    local.x >= 0 &&
    local.y >= 0 &&
    local.x <= piece.width &&
    local.y <= piece.height
  );
}

/**
 * Every piece under a point, frontmost first. That is the order a person reads
 * a stack in, and the order a click walks down through.
 */
export function piecesUnder(
  pieces: readonly CollagePiece[],
  point: Point,
): CollagePiece[] {
  return pieces
    .filter((piece) => pieceHoldsPoint(piece, point))
    .sort((a, b) => b.z - a.z);
}

/** The piece a plain click lands on: whatever is in front at that point. */
export function topPieceUnder(
  pieces: readonly CollagePiece[],
  point: Point,
): CollagePiece | null {
  return piecesUnder(pieces, point)[0] ?? null;
}

/**
 * What a click at this point selects, given what is already in hand. Clicking
 * the same spot again reaches the next piece down and wraps back to the top,
 * so a buried piece can be got at without moving anything. Selection never
 * changes the stacking order.
 */
export function nextSelectionAt(
  pieces: readonly CollagePiece[],
  point: Point,
  selectedId: string | null,
): string | null {
  const stack = piecesUnder(pieces, point);
  if (stack.length === 0) return null;
  const index = stack.findIndex((piece) => piece.id === selectedId);
  // Clicking somewhere the selection is not starts again at the front.
  if (index === -1) return stack[0].id;
  return stack[(index + 1) % stack.length].id;
}

/**
 * The piece one step below or above the selected one in the whole stack, for
 * stepping down into a pile from the keyboard.
 */
export function neighborInStack(
  pieces: readonly CollagePiece[],
  selectedId: string | null,
  direction: "below" | "above",
): string | null {
  const ordered = [...pieces].sort((a, b) => b.z - a.z);
  if (ordered.length === 0) return null;
  const index = ordered.findIndex((piece) => piece.id === selectedId);
  if (index === -1) return ordered[0].id;
  const step = direction === "below" ? 1 : -1;
  return ordered[(index + step + ordered.length) % ordered.length].id;
}

/** A tag's box in frame space, used to keep two of them from overlapping. */
export interface TagBox {
  pieceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: TagBox, b: TagBox): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * Pushes overlapping tags apart by stacking them downward in z order. It is a
 * single pass on purpose: a tag only ever moves below the ones already placed,
 * which is enough to keep two labels off each other without a layout solver.
 */
export function spreadTags(tags: readonly TagBox[]): TagBox[] {
  const placed: TagBox[] = [];
  for (const tag of tags) {
    let candidate = { ...tag };
    // Each collision drops it by one tag height, and the scan restarts so a
    // tag pushed down cannot land on something it has already cleared.
    for (let guard = 0; guard < tags.length; guard += 1) {
      const hit = placed.find((other) => overlaps(other, candidate));
      if (!hit) break;
      candidate = { ...candidate, y: hit.y + hit.height };
    }
    placed.push(candidate);
  }
  return placed;
}
