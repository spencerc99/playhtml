// ABOUTME: Arrangement edits applied to several pieces at once: replace, remove, copy, restack.
// ABOUTME: Restacking keeps the chosen pieces in the order they already had among themselves.

import { normalizeStack, type CollagePiece } from "./collageRecord";
import { stackOrder } from "./pieceStack";

/**
 * Puts changed pieces back into the arrangement in their places. Every
 * changed piece must already be in it.
 */
export function replacePieces(
  pieces: readonly CollagePiece[],
  changed: readonly CollagePiece[],
): CollagePiece[] {
  const byId = new Map(changed.map((piece) => [piece.id, piece] as const));
  for (const id of byId.keys()) {
    if (!pieces.some((piece) => piece.id === id)) {
      throw new Error(`Collage has no piece ${id}`);
    }
  }
  return pieces.map((piece) => byId.get(piece.id) ?? piece);
}

/** The arrangement with the given pieces taken out and the stack closed up. */
export function removePieces(
  pieces: readonly CollagePiece[],
  ids: readonly string[],
): CollagePiece[] {
  const leaving = new Set(ids);
  return normalizeStack(pieces.filter((piece) => !leaving.has(piece.id)));
}

/** The given pieces as they stand, back to front. Unknown ids are an error. */
export function piecesById(
  pieces: readonly CollagePiece[],
  ids: readonly string[],
): CollagePiece[] {
  const wanted = new Set(ids);
  const found = stackOrder(pieces).filter((piece) => wanted.has(piece.id));
  if (found.length !== wanted.size) {
    const missing = ids.filter((id) => !found.some((piece) => piece.id === id));
    throw new Error(`Collage has no piece ${missing.join(", ")}`);
  }
  return found;
}

/**
 * Copies of the given pieces, shifted by `offset` and laid on top of the
 * whole stack in the same order the originals had among themselves.
 */
export function copiesOnTop(
  pieces: readonly CollagePiece[],
  originals: readonly CollagePiece[],
  offset: number | { x: number; y: number },
  newId: () => string,
): CollagePiece[] {
  const top = pieces.reduce((highest, piece) => Math.max(highest, piece.z), -1);
  const step = typeof offset === "number" ? { x: offset, y: offset } : offset;
  return stackOrder(originals).map((piece, index) => ({
    ...piece,
    id: newId(),
    x: piece.x + step.x,
    y: piece.y + step.y,
    z: top + 1 + index,
  }));
}

/**
 * Moves each chosen piece one step toward the front or the back, past the
 * nearest piece that is not chosen. Chosen pieces never pass each other, and
 * a run of them already at that end of the stack stays where it is.
 */
function stepGroup(
  pieces: readonly CollagePiece[],
  ids: readonly string[],
  direction: 1 | -1,
): CollagePiece[] {
  const chosen = new Set(ids);
  const ordered = normalizeStack(pieces);
  const indices = ordered.map((_, index) => index);
  // Walking from the end the pieces move toward means each chosen piece sees
  // the neighbour it would pass before that neighbour itself can move.
  if (direction === 1) indices.reverse();
  for (const index of indices) {
    if (!chosen.has(ordered[index].id)) continue;
    const target = index + direction;
    if (target < 0 || target >= ordered.length) continue;
    if (chosen.has(ordered[target].id)) continue;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  }
  return ordered.map((piece, index) => ({ ...piece, z: index }));
}

export function moveGroupForward(
  pieces: readonly CollagePiece[],
  ids: readonly string[],
): CollagePiece[] {
  return stepGroup(pieces, ids, 1);
}

export function moveGroupBackward(
  pieces: readonly CollagePiece[],
  ids: readonly string[],
): CollagePiece[] {
  return stepGroup(pieces, ids, -1);
}

/** Lifts the chosen pieces to one end of the stack, keeping their order. */
function liftGroup(
  pieces: readonly CollagePiece[],
  ids: readonly string[],
  end: "front" | "back",
): CollagePiece[] {
  const chosen = new Set(ids);
  const ordered = normalizeStack(pieces);
  const moving = ordered.filter((piece) => chosen.has(piece.id));
  const rest = ordered.filter((piece) => !chosen.has(piece.id));
  const stacked = end === "front" ? [...rest, ...moving] : [...moving, ...rest];
  return stacked.map((piece, index) => ({ ...piece, z: index }));
}

export function moveGroupToFront(
  pieces: readonly CollagePiece[],
  ids: readonly string[],
): CollagePiece[] {
  return liftGroup(pieces, ids, "front");
}

export function moveGroupToBack(
  pieces: readonly CollagePiece[],
  ids: readonly string[],
): CollagePiece[] {
  return liftGroup(pieces, ids, "back");
}

/** Which piece each copy of the last duplicate was made from. */
export type DuplicateTrail = ReadonlyMap<string, string>;

/**
 * Where the next duplicate lands. Duplicating the copies the last duplicate
 * made repeats how far those copies now sit from their originals, so a copy
 * dragged into place and duplicated again steps on by the same amount. Any
 * other duplicate lands `fallback` down and to the right.
 */
export function nextDuplicateOffset(
  pieces: readonly CollagePiece[],
  originals: readonly CollagePiece[],
  trail: DuplicateTrail | null,
  fallback: number,
): { x: number; y: number } {
  const plain = { x: fallback, y: fallback };
  if (!trail || originals.length === 0) return plain;
  let step: { x: number; y: number } | null = null;
  for (const copy of originals) {
    const sourceId = trail.get(copy.id);
    const source = sourceId
      ? pieces.find((piece) => piece.id === sourceId)
      : undefined;
    if (!source) return plain;
    const delta = { x: copy.x - source.x, y: copy.y - source.y };
    if (!step) step = delta;
    // Copies moved apart from each other no longer share one step.
    else if (Math.abs(step.x - delta.x) > 0.5 || Math.abs(step.y - delta.y) > 0.5)
      return plain;
  }
  return step ?? plain;
}

/** Pairs each copy with the original it came from, in the order copies are made. */
export function duplicateTrail(
  originals: readonly CollagePiece[],
  copies: readonly CollagePiece[],
): DuplicateTrail {
  const ordered = stackOrder(originals);
  return new Map(copies.map((copy, index) => [copy.id, ordered[index].id]));
}
