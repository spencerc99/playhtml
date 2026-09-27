// ABOUTME: The set of pieces in hand in the collage studio and how clicks, shift and marquees change it.
// ABOUTME: Pure decisions, so a press settles the same way in the studio and in tests.

import type { Bounds, Point } from "./collageGeometry";
import type { CollagePiece } from "./collageRecord";
import { piecesUnder, planPress } from "./pieceStack";

/**
 * The pieces in hand. `ids` keeps the order they were taken in; `primary` is
 * the one taken last, which keyboard stepping and single-piece tools start from.
 */
export interface Selection {
  readonly ids: readonly string[];
  readonly primary: string | null;
}

export const EMPTY_SELECTION: Selection = { ids: [], primary: null };

export function selectOnly(id: string): Selection {
  return { ids: [id], primary: id };
}

/** Takes several pieces at once; the last one given becomes the primary. */
export function selectMany(ids: readonly string[]): Selection {
  const unique = [...new Set(ids)];
  return { ids: unique, primary: unique[unique.length - 1] ?? null };
}

export function isSelected(selection: Selection, id: string): boolean {
  return selection.ids.includes(id);
}

/**
 * Adds a piece to the hand, or puts it down when it is already held. Putting
 * down the primary hands that role to the piece taken most recently before it.
 */
export function toggleInSelection(selection: Selection, id: string): Selection {
  if (!isSelected(selection, id)) {
    return { ids: [...selection.ids, id], primary: id };
  }
  const ids = selection.ids.filter((held) => held !== id);
  const primary =
    selection.primary === id ? (ids[ids.length - 1] ?? null) : selection.primary;
  return { ids, primary };
}

/**
 * What a marquee holds while it is drawn. A plain marquee takes exactly what
 * it touches; a shift marquee adds what it touches to what was already held
 * when it began, so dragging it back off a piece puts only that piece down.
 */
export function marqueeSelection(
  base: Selection,
  touched: readonly string[],
  additive: boolean,
): Selection {
  if (!additive) return selectMany(touched);
  const added = touched.filter((id) => !isSelected(base, id));
  if (added.length === 0) return base;
  return {
    ids: [...base.ids, ...added],
    primary: added[added.length - 1],
  };
}

/**
 * The pieces a click, a marquee, select-all or a step can take. A locked
 * piece is held in place and passed over by all of them; it is reached again
 * only from the list of pieces under a point.
 */
export function selectablePieces<T extends { locked?: true }>(
  pieces: readonly T[],
): T[] {
  return pieces.filter((piece) => piece.locked !== true);
}

/** Takes every piece that can be taken, skipping locked ones. */
export function selectAll(
  pieces: readonly { id: string; locked?: true }[],
): Selection {
  return selectMany(selectablePieces(pieces).map((piece) => piece.id));
}

/**
 * Drops pieces that are no longer in `pieces`, as after an undo or a delete,
 * or when a piece is locked and `pieces` holds only the selectable ones,
 * keeping the rest in the order they were taken.
 */
export function pruneSelection(
  selection: Selection,
  pieces: readonly { id: string }[],
): Selection {
  const present = new Set(pieces.map((piece) => piece.id));
  if (selection.ids.every((id) => present.has(id))) return selection;
  const ids = selection.ids.filter((id) => present.has(id));
  const primary =
    selection.primary && present.has(selection.primary)
      ? selection.primary
      : (ids[ids.length - 1] ?? null);
  return { ids, primary };
}

/** The one piece in hand, or null when none or several are held. */
export function soleSelected(selection: Selection): string | null {
  return selection.ids.length === 1 ? selection.ids[0] : null;
}

/** Whether an upright box holds a point, edges included. */
function boxHolds(box: Bounds, point: Point): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** What one press on the collage does to the hand, settled as it lands. */
export interface SelectionPressPlan {
  /** Held as soon as the pointer goes down. */
  selectOnDown: Selection;
  /** The pieces a drag from this press moves. */
  dragIds: readonly string[];
  /** Held when the press ends without travelling, which makes it a click. */
  selectOnClick: Selection;
}

/**
 * Decides a press on the pieces.
 *
 * Shift adds the frontmost piece under the pointer, or, when that piece is
 * already held, a click puts it down while a drag still moves the whole hand.
 *
 * With several pieces held, a press anywhere inside the box around them keeps
 * the hand so a drag moves them all: on a held piece, on an unheld piece lying
 * over one, or on an unheld piece that only sits inside the box. A click there
 * without a drag takes the frontmost piece at that spot alone, the one the eye
 * sees clicked. A press outside the box takes the frontmost piece alone.
 *
 * With one piece or none held, the single-piece rules apply (see planPress):
 * clicking the held piece again steps down the pile, and cmd or ctrl reaches
 * the next piece down straight away.
 */
export function planSelectionPress(
  pieces: readonly CollagePiece[],
  point: Point,
  selection: Selection,
  /** The box around the hand when several pieces are held, else null. */
  groupBox: Bounds | null,
  modifiers: { deep: boolean; additive: boolean },
): SelectionPressPlan | null {
  const stack = piecesUnder(pieces, point);
  if (stack.length === 0) return null;

  if (modifiers.additive) {
    const front = stack[0].id;
    if (isSelected(selection, front)) {
      return {
        selectOnDown: selection,
        dragIds: selection.ids,
        selectOnClick: toggleInSelection(selection, front),
      };
    }
    const grown = toggleInSelection(selection, front);
    return { selectOnDown: grown, dragIds: grown.ids, selectOnClick: grown };
  }

  if (selection.ids.length > 1 && !modifiers.deep) {
    if (
      stack.some((piece) => isSelected(selection, piece.id)) ||
      (groupBox !== null && boxHolds(groupBox, point))
    ) {
      return {
        selectOnDown: selection,
        dragIds: selection.ids,
        selectOnClick: selectOnly(stack[0].id),
      };
    }
  }

  const single = planPress(
    pieces,
    point,
    selection.ids.length === 1 ? selection.ids[0] : selection.primary,
    modifiers.deep,
  );
  if (!single) return null;
  return {
    selectOnDown: selectOnly(single.selectOnDown),
    dragIds: [single.dragId],
    selectOnClick: selectOnly(single.selectOnClick),
  };
}

/** What a press on bare paper does: carry the hand, or sweep a marquee. */
export type BarePressPlan =
  | {
      kind: "drag";
      /** The pieces a drag from this press moves. */
      dragIds: readonly string[];
      /** Held when the press ends without travelling. */
      selectOnClick: Selection;
    }
  | {
      kind: "marquee";
      /** Held as the marquee begins, and still held if it never travels. */
      base: Selection;
      additive: boolean;
    };

/**
 * Decides a press on bare paper. With several pieces held, a press inside the
 * box around them grabs the box, shift or not, so a drag moves them all the
 * way it does in Figma; a click there without a drag lets go of everything,
 * as any click on bare paper does, unless shift is held. Anywhere else the
 * press starts a marquee: a plain one lets go of what was held, a shift one
 * keeps it and adds to it.
 */
export function planBarePress(
  point: Point,
  selection: Selection,
  groupBox: Bounds | null,
  additive: boolean,
): BarePressPlan {
  const insideGroup =
    selection.ids.length > 1 && groupBox !== null && boxHolds(groupBox, point);
  if (insideGroup) {
    return {
      kind: "drag",
      dragIds: selection.ids,
      selectOnClick: additive ? selection : EMPTY_SELECTION,
    };
  }
  return {
    kind: "marquee",
    base: additive ? selection : EMPTY_SELECTION,
    additive,
  };
}
