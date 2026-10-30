// ABOUTME: Finds which collage piece the pointer is over, by each piece's own rotated box and stacking order.
// ABOUTME: A small piece showing through a cutout or lettering still wins over the big piece whose box covers it.

export interface PieceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, turned about the box's centre. */
  rotation: number;
  z: number;
  /**
   * The box has see-through parts (a cutout, a heading, a button): what lies
   * under it can show through, so a smaller piece beneath may be what the
   * pointer is really on.
   */
  seeThrough: boolean;
}

function contains(box: PieceBox, x: number, y: number): boolean {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const turn = (-box.rotation * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  const localX = dx * Math.cos(turn) - dy * Math.sin(turn);
  const localY = dx * Math.sin(turn) + dy * Math.cos(turn);
  return (
    Math.abs(localX) <= box.width / 2 && Math.abs(localY) <= box.height / 2
  );
}

/**
 * The index of the piece under a point in the collage's own coordinates, or
 * null. The topmost box wins, unless it is see-through, in which case the
 * smallest piece beneath it that also holds the point wins: small things set
 * among a cutout's empty corners stay reachable.
 */
export function pieceUnderPointer(
  boxes: readonly PieceBox[],
  x: number,
  y: number,
): number | null {
  const under = boxes
    .map((box, index) => ({ box, index }))
    .filter(({ box }) => contains(box, x, y))
    .sort((a, b) => b.box.z - a.box.z || b.index - a.index);
  if (under.length === 0) return null;
  const [top, ...rest] = under;
  if (!top.box.seeThrough) return top.index;
  const area = (box: PieceBox) => box.width * box.height;
  let pick = top;
  for (const entry of rest) {
    if (area(entry.box) < area(pick.box)) pick = entry;
  }
  return pick.index;
}
