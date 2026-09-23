// ABOUTME: Works out which pieces lie under a point and which one a press takes.
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
 * The whole collage back to front, the order it is drawn in. Pieces that share
 * a z keep their order in the list, the later one in front, which is what the
 * page does with two elements of equal z-index. Drawing and hit-testing both
 * read this, so a click always lands on the piece that is visibly on top.
 */
export function stackOrder(pieces: readonly CollagePiece[]): CollagePiece[] {
  return pieces
    .map((piece, index) => ({ piece, index }))
    .sort((a, b) => a.piece.z - b.piece.z || a.index - b.index)
    .map(({ piece }) => piece);
}

/**
 * Every piece under a point, frontmost first. That is the order a person reads
 * a stack in, and the order a deep click walks down through.
 */
export function piecesUnder(
  pieces: readonly CollagePiece[],
  point: Point,
): CollagePiece[] {
  return stackOrder(pieces)
    .reverse()
    .filter((piece) => pieceHoldsPoint(piece, point));
}

/** The piece a plain click lands on: whatever is in front at that point. */
export function topPieceUnder(
  pieces: readonly CollagePiece[],
  point: Point,
): CollagePiece | null {
  return piecesUnder(pieces, point)[0] ?? null;
}

/**
 * The piece one below the selection at this point, wrapping back to the front
 * after the bottom one. When the selection is not under the point the walk
 * starts at the front. Selection never changes the stacking order.
 */
export function deeperPieceAt(
  pieces: readonly CollagePiece[],
  point: Point,
  selectedId: string | null,
): string | null {
  const stack = piecesUnder(pieces, point);
  if (stack.length === 0) return null;
  const index = stack.findIndex((piece) => piece.id === selectedId);
  if (index === -1) return stack[0].id;
  return stack[(index + 1) % stack.length].id;
}

/** What one press on the collage does, settled the moment it lands. */
export interface PressPlan {
  /** Selected as soon as the pointer goes down. */
  selectOnDown: string;
  /** The piece a drag from this press moves. */
  dragId: string;
  /** Selected when the press ends without travelling, which makes it a click. */
  selectOnClick: string;
}

/**
 * Decides a press. A click on an unselected spot takes the frontmost piece
 * under the pointer. A click on the piece already in hand steps one piece
 * down the pile at that point, wrapping back to the front, so a buried piece
 * can be reached without a modifier. A press that becomes a drag never
 * changes the selection: it moves the piece already in hand whenever the
 * press is inside it, even where another piece lies on top. With deep set
 * (cmd or ctrl held) the press takes the next piece down straight away and a
 * drag moves that one.
 */
export function planPress(
  pieces: readonly CollagePiece[],
  point: Point,
  selectedId: string | null,
  deep: boolean,
): PressPlan | null {
  const stack = piecesUnder(pieces, point);
  if (stack.length === 0) return null;
  if (deep) {
    const deeper = deeperPieceAt(pieces, point, selectedId);
    if (!deeper) return null;
    return { selectOnDown: deeper, dragId: deeper, selectOnClick: deeper };
  }
  const front = stack[0].id;
  if (selectedId && stack.some((piece) => piece.id === selectedId)) {
    const deeper = deeperPieceAt(pieces, point, selectedId) ?? front;
    return { selectOnDown: selectedId, dragId: selectedId, selectOnClick: deeper };
  }
  return { selectOnDown: front, dragId: front, selectOnClick: front };
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
  const ordered = stackOrder(pieces).reverse();
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
