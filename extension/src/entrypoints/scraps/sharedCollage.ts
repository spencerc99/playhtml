// ABOUTME: Lets the collage studio edit pieces other people are editing too, such as a shared table.
// ABOUTME: Diffs settled arrangements into writes and folds other people's writes into undo history.

import type { ReactNode } from "react";
import type { ArrangementHistory, Arrangement } from "./arrangementHistory";
import type { CollagePiece } from "./collageRecord";

/** Who put a piece down, in the color their cursor carries. */
export interface PieceOwner {
  name: string;
  color: string;
}

/** What one person changed: pieces added or edited, and pieces taken away. */
export interface PiecesChange {
  upserts: CollagePiece[];
  removedIds: string[];
  /**
   * Each edited piece as it stood before this person's edit, so a shared
   * store can write only the parts that changed and keep someone else's
   * concurrent edit to the rest of that piece.
   */
  before?: ReadonlyMap<string, CollagePiece>;
}

/**
 * Hands the studio a collage that lives somewhere shared instead of in this
 * browser's own store. The studio edits it as usual, then reports each settled
 * edit instead of saving, and takes in everyone else's edits as they arrive.
 */
export interface SharedCollage {
  /** The frame everyone lays pieces out in, in frame units. */
  frame: { width: number; height: number };
  /** The pieces as they stand for everyone, including others' edits in progress. */
  pieces: readonly CollagePiece[];
  /** Called once an edit settles, with only what this person changed. */
  onChange: (change: PiecesChange) => void;
  /**
   * The pieces this person is part way through changing, so others can watch
   * a drag as it happens; null once nothing is in progress.
   */
  onDraft?: (draft: PiecesChange | null) => void;
  /** Why this person may not remove a piece, or null when they may. */
  removalRefusal?: (piece: CollagePiece) => string | null;
  /**
   * Who added a piece, or null when unknown. Their name and color mark the
   * piece on hover and in the sources view.
   */
  pieceOwner?: (piece: CollagePiece) => PieceOwner | null;
  /** Drawn over the frame, in frame units, under the selection and tools. */
  overlay?: ReactNode;
  /** Extra controls for the bar along the bottom. */
  toolbar?: ReactNode;
  /** Shown on the mat under the frame in place of the collage's title. */
  caption?: ReactNode;
}

const EMPTY_CHANGE: PiecesChange = { upserts: [], removedIds: [] };

/**
 * A piece's fields with numbers rounded, so a piece that has been through a
 * conversion and back reads as unchanged.
 */
function fingerprint(piece: CollagePiece): string {
  return JSON.stringify(piece, (_key, value: unknown) =>
    typeof value === "number" ? Math.round(value * 1000) / 1000 : value,
  );
}

export function samePiece(a: CollagePiece, b: CollagePiece): boolean {
  return a === b || fingerprint(a) === fingerprint(b);
}

/** The pieces as a lookup by id. */
export function piecesMap(
  pieces: readonly CollagePiece[],
): Map<string, CollagePiece> {
  return new Map(pieces.map((piece) => [piece.id, piece]));
}

/** How `next` differs from `base`: what was added or edited, and what is gone. */
export function piecesChange(
  base: ReadonlyMap<string, CollagePiece>,
  next: readonly CollagePiece[],
): PiecesChange {
  const upserts: CollagePiece[] = [];
  const edited = new Map<string, CollagePiece>();
  const present = new Set<string>();
  for (const piece of next) {
    present.add(piece.id);
    const before = base.get(piece.id);
    if (before && samePiece(before, piece)) continue;
    upserts.push(piece);
    if (before) edited.set(piece.id, before);
  }
  const removedIds = [...base.keys()].filter((id) => !present.has(id));
  if (upserts.length === 0 && removedIds.length === 0) return EMPTY_CHANGE;
  return { upserts, removedIds, before: edited };
}

export function isEmptyChange(change: PiecesChange): boolean {
  return change.upserts.length === 0 && change.removedIds.length === 0;
}

/**
 * A piece with only the fields someone else changed taken from their version,
 * so this person's own edit to another field of the same piece stays.
 */
function mergePiece(
  mine: CollagePiece,
  before: CollagePiece,
  theirs: CollagePiece,
): CollagePiece {
  const merged = { ...mine } as Record<string, unknown>;
  const was = before as unknown as Record<string, unknown>;
  const now = theirs as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (JSON.stringify(was[key]) === JSON.stringify(now[key])) continue;
    if (key in now) merged[key] = now[key];
    else delete merged[key];
  }
  return merged as unknown as CollagePiece;
}

/** An arrangement with a change applied: edits in place, additions on the end. */
export function applyChange(
  pieces: Arrangement,
  change: PiecesChange,
): Arrangement {
  if (isEmptyChange(change)) return pieces;
  const gone = new Set(change.removedIds);
  const incoming = piecesMap(change.upserts);
  const kept = pieces
    .filter((piece) => !gone.has(piece.id))
    .map((piece) => {
      const replacement = incoming.get(piece.id);
      if (!replacement) return piece;
      incoming.delete(piece.id);
      const before = change.before?.get(piece.id);
      return before ? mergePiece(piece, before, replacement) : replacement;
    });
  return [...kept, ...incoming.values()];
}

/**
 * Folds someone else's change into every step of the undo history. Undo then
 * only ever takes back this person's own edits: it never returns a piece
 * someone else moved, nor brings back one they removed or takes away one they
 * added.
 */
export function rebaseHistory(
  history: ArrangementHistory,
  change: PiecesChange,
): ArrangementHistory {
  if (isEmptyChange(change)) return history;
  return {
    ...history,
    past: history.past.map((step) => applyChange(step, change)),
    present: applyChange(history.present, change),
    future: history.future.map((step) => applyChange(step, change)),
  };
}
