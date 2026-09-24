// ABOUTME: Places the peek labels inside the frame and gives each piece a quiet tint.
// ABOUTME: Pure geometry, deterministic, so a held peek never shuffles its labels.

import { boxCenter, rotatePoint, type PieceBox } from "./collageGeometry";
import { spreadTags, type TagBox } from "./pieceStack";

/** An axis-aligned rectangle in frame units. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The upright rectangle a piece covers once it is turned, so a label can be
 * set against what is actually drawn.
 */
export function pieceBounds(piece: PieceBox & { rotation: number }): Rect {
  const center = boxCenter(piece);
  const radians = (piece.rotation * Math.PI) / 180;
  const corners = [
    { x: piece.x, y: piece.y },
    { x: piece.x + piece.width, y: piece.y },
    { x: piece.x, y: piece.y + piece.height },
    { x: piece.x + piece.width, y: piece.y + piece.height },
  ].map((corner) => rotatePoint(corner, center, radians));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** What one label needs placing: its piece's covered area and its own size. */
export interface TagRequest {
  pieceId: string;
  piece: Rect;
  width: number;
  height: number;
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function within(tag: Rect, bounds: Rect): boolean {
  return (
    tag.x >= bounds.x &&
    tag.y >= bounds.y &&
    tag.x + tag.width <= bounds.x + bounds.width &&
    tag.y + tag.height <= bounds.y + bounds.height
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function clampInto(tag: TagBox, bounds: Rect): TagBox {
  const x = Math.min(
    Math.max(tag.x, bounds.x),
    bounds.x + bounds.width - tag.width,
  );
  const y = Math.min(
    Math.max(tag.y, bounds.y),
    bounds.y + bounds.height - tag.height,
  );
  // A tag wider or taller than the frame starts at the frame's edge.
  return { ...tag, x: Math.max(bounds.x, x), y: Math.max(bounds.y, y) };
}

/**
 * The spots a label is tried at, in order: above the piece's top-left, below
 * its bottom-left, inside the top-left of the part of it that shows, then the
 * other corners.
 */
function candidates(request: TagRequest, bounds: Rect): TagBox[] {
  const { pieceId, piece, width, height } = request;
  const shown = intersect(piece, bounds) ?? piece;
  const at = (x: number, y: number): TagBox => ({ pieceId, x, y, width, height });
  const right = piece.x + piece.width - width;
  const shownRight = shown.x + shown.width - width;
  const shownBottom = shown.y + shown.height - height;
  return [
    at(piece.x, piece.y - height),
    at(piece.x, piece.y + piece.height),
    at(shown.x, shown.y),
    at(right, piece.y - height),
    at(right, piece.y + piece.height),
    at(shownRight, shown.y),
    at(shown.x, shownBottom),
    at(shownRight, shownBottom),
  ];
}

/**
 * Places every label inside `bounds`, so a piece hanging off the frame still
 * shows where it came from. Each label takes the first of its spots that stays
 * in bounds and clear of the labels already placed. When none does, it is
 * pulled into bounds and nudged clear of the others.
 */
export function placeTags(
  requests: readonly TagRequest[],
  bounds: Rect,
): TagBox[] {
  const placed: TagBox[] = [];
  for (const request of requests) {
    const spots = candidates(request, bounds);
    const free = spots.find(
      (spot) =>
        within(spot, bounds) && !placed.some((other) => overlaps(other, spot)),
    );
    if (free) {
      placed.push(free);
      continue;
    }
    const pulledIn = clampInto(spots[0], bounds);
    const nudged = spreadTags([...placed, pulledIn])[placed.length];
    placed.push(
      within(nudged, bounds) ? nudged : nudgedUp(pulledIn, placed, bounds),
    );
  }
  return placed;
}

/**
 * Moves a label upward past the labels it meets, for when there is no room
 * left below. It stays in bounds even if that means resting on another label.
 */
function nudgedUp(
  tag: TagBox,
  placed: readonly TagBox[],
  bounds: Rect,
): TagBox {
  let candidate = tag;
  for (let guard = 0; guard < placed.length; guard += 1) {
    const hit = placed.find((other) => overlaps(other, candidate));
    if (!hit) break;
    candidate = { ...candidate, y: hit.y - candidate.height };
  }
  return clampInto(candidate, bounds);
}

/** The muted inks a piece and its label are tinted with while peeking. */
export const PEEK_TINTS = [
  "#4a9a8a",
  "#c4724e",
  "#5b8db8",
  "#d4b85c",
  "#827a72",
] as const;

function near(a: Rect, b: Rect, gap: number): boolean {
  return overlaps(
    {
      x: a.x - gap,
      y: a.y - gap,
      width: a.width + gap * 2,
      height: a.height + gap * 2,
    },
    b,
  );
}

/**
 * Gives each piece a tint that differs from the pieces overlapping it or within
 * `gap` of it, so a label set between two pieces is not mistaken for the
 * other's. Tints already given are kept, so a held peek never recolors a
 * piece; only a piece without one is given the first tint its neighbours are
 * not using, or the one they use least when all are taken.
 */
export function tintPieces(
  pieces: readonly { id: string; bounds: Rect }[],
  given: ReadonlyMap<string, string>,
  gap: number,
): Map<string, string> {
  const tints = new Map<string, string>();
  for (const piece of pieces) {
    const kept = given.get(piece.id);
    if (kept) tints.set(piece.id, kept);
  }
  for (const piece of pieces) {
    if (tints.has(piece.id)) continue;
    const used = new Map<string, number>();
    for (const other of pieces) {
      const tint = tints.get(other.id);
      if (other.id === piece.id || !tint) continue;
      if (near(piece.bounds, other.bounds, gap)) {
        used.set(tint, (used.get(tint) ?? 0) + 1);
      }
    }
    let choice: string = PEEK_TINTS[0];
    let fewest = Number.POSITIVE_INFINITY;
    for (const tint of PEEK_TINTS) {
      const count = used.get(tint) ?? 0;
      if (count < fewest) {
        fewest = count;
        choice = tint;
      }
    }
    tints.set(piece.id, choice);
  }
  return tints;
}
