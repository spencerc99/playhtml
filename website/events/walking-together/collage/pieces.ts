// ABOUTME: Pure data and geometry helpers for the shared table collage.
// ABOUTME: Pieces live in a keyed map; positions and sizes are relative to the table.

/** One scrap placed on the table. Positions are relative to the table so every
 * screen size sees the same arrangement: x/y are the piece center (0..1 of the
 * table width/height) and width is a fraction of the table width. */
export interface Piece {
  id: string;
  src: string;
  /** The page the scrap came from, when the input knew it. Empty when unknown. */
  pageUrl: string;
  alt: string;
  placedByPid: string;
  placedByName: string;
  placedByColor: string;
  x: number;
  y: number;
  width: number;
  /** Image height / width, so height follows width at any table size. */
  aspect: number;
  /** Degrees, clockwise. */
  rotation: number;
  z: number;
  placedAt: number;
}

export type Pieces = Record<string, Piece>;

/** One cursor position from the admin's shape capture, relative to the table. */
export interface TemplatePoint {
  x: number;
  y: number;
  color: string;
}

export type TemplatePoints = Record<string, TemplatePoint>;

/** Everything the collage stores in shared data. Each field is a keyed map or
 * a scalar so concurrent writes merge per key instead of appending. */
export interface CollageData {
  pieces: Pieces;
  templatePoints: TemplatePoints;
  locked: boolean;
}

/** Soft cap on how many scraps one person can have on the table at once. */
export const MAX_PIECES_PER_PERSON = 12;

/** Default width of a newly placed scrap, as a fraction of the table width. */
export const DEFAULT_PIECE_WIDTH = 0.16;
/** Smallest and largest width a scrap can be resized to. */
export const MIN_PIECE_WIDTH = 0.04;
export const MAX_PIECE_WIDTH = 0.7;
/** A new scrap is never taller than this fraction of the table height. */
const MAX_NEW_PIECE_HEIGHT = 0.4;
/** Aspect used when an image never reports its size (e.g. it failed to load). */
export const FALLBACK_ASPECT = 0.75;

/** Null-safe view of the pieces map, tolerant of a room that predates it. */
export function piecesOf(data: Partial<CollageData> | undefined): Pieces {
  return data?.pieces ?? {};
}

/** Pieces in paint order: lowest z first, ties broken by placement time. */
export function sortedPieces(pieces: Pieces): Piece[] {
  return Object.values(pieces).sort(
    (a, b) => a.z - b.z || a.placedAt - b.placedAt,
  );
}

/** The highest z on the table, 0 when empty. */
export function topZ(pieces: Pieces): number {
  let max = 0;
  for (const piece of Object.values(pieces)) {
    if (piece.z > max) max = piece.z;
  }
  return max;
}

/** True when this piece is already painted above every other piece. */
export function isOnTop(pieces: Pieces, id: string): boolean {
  const piece = pieces[id];
  if (!piece) return false;
  return Object.values(pieces).every(
    (other) => other.id === id || other.z < piece.z,
  );
}

export function countPlacedBy(pieces: Pieces, pid: string): number {
  return Object.values(pieces).filter((p) => p.placedByPid === pid).length;
}

export function hasReachedLimit(pieces: Pieces, pid: string): boolean {
  return countPlacedBy(pieces, pid) >= MAX_PIECES_PER_PERSON;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Width for a new scrap: the default, shrunk when a tall image would
 * otherwise run off the table. */
export function initialWidth(aspect: number, tableAspect: number): number {
  // Piece height as a fraction of table height = width * aspect * tableAspect,
  // where tableAspect is table width / table height.
  const maxForHeight = MAX_NEW_PIECE_HEIGHT / (aspect * tableAspect);
  return clamp(
    Math.min(DEFAULT_PIECE_WIDTH, maxForHeight),
    MIN_PIECE_WIDTH,
    MAX_PIECE_WIDTH,
  );
}

export interface Placer {
  pid: string;
  name: string;
  color: string;
}

export interface NewPieceInput {
  src: string;
  pageUrl?: string;
  alt?: string;
  aspect: number;
}

/** Builds a piece for the table at a relative point, on top of everything,
 * with a slight random tilt so it reads as a dropped scrap of paper. */
export function makePiece(
  input: NewPieceInput,
  placer: Placer,
  at: { x: number; y: number },
  pieces: Pieces,
  tableAspect: number,
  options: { id: string; now: number; random: () => number },
): Piece {
  const aspect =
    Number.isFinite(input.aspect) && input.aspect > 0
      ? input.aspect
      : FALLBACK_ASPECT;
  return {
    id: options.id,
    src: input.src,
    pageUrl: input.pageUrl ?? "",
    alt: input.alt ?? "",
    placedByPid: placer.pid,
    placedByName: placer.name,
    placedByColor: placer.color,
    x: clamp(at.x, 0, 1),
    y: clamp(at.y, 0, 1),
    width: initialWidth(aspect, tableAspect),
    aspect,
    rotation: Math.round((options.random() * 12 - 6) * 10) / 10,
    z: topZ(pieces) + 1,
    placedAt: options.now,
  };
}

/** The part of a piece a gesture changes. */
export interface PieceTransform {
  x: number;
  y: number;
  width: number;
  rotation: number;
}

export function transformOf(piece: Piece): PieceTransform {
  return {
    x: piece.x,
    y: piece.y,
    width: piece.width,
    rotation: piece.rotation,
  };
}

/** A move gesture: the piece follows the pointer by the same relative delta,
 * keeping its center on the table. */
export function movedTransform(
  start: PieceTransform,
  delta: { dx: number; dy: number },
): PieceTransform {
  return {
    ...start,
    x: clamp(start.x + delta.dx, 0, 1),
    y: clamp(start.y + delta.dy, 0, 1),
  };
}

/**
 * The corner-handle gesture, which rotates and resizes together. All points
 * are in table pixels. The piece turns by the angle the pointer has swept
 * around the piece center, and scales by how much farther from (or closer to)
 * the center the pointer is than where the gesture began.
 */
export function rotateResizeTransform(
  start: PieceTransform,
  centerPx: { x: number; y: number },
  startPointerPx: { x: number; y: number },
  pointerPx: { x: number; y: number },
): PieceTransform {
  const startDx = startPointerPx.x - centerPx.x;
  const startDy = startPointerPx.y - centerPx.y;
  const dx = pointerPx.x - centerPx.x;
  const dy = pointerPx.y - centerPx.y;
  const startDistance = Math.hypot(startDx, startDy);
  const distance = Math.hypot(dx, dy);
  if (startDistance < 1 || distance < 1) return start;

  const sweptDeg =
    ((Math.atan2(dy, dx) - Math.atan2(startDy, startDx)) * 180) / Math.PI;
  return {
    ...start,
    width: clamp(
      start.width * (distance / startDistance),
      MIN_PIECE_WIDTH,
      MAX_PIECE_WIDTH,
    ),
    rotation: normalizeDegrees(start.rotation + sweptDeg),
  };
}

/** Folds an angle into (-180, 180]. */
export function normalizeDegrees(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** True when two transforms differ enough to be worth a shared write. */
export function transformChanged(a: PieceTransform, b: PieceTransform): boolean {
  const EPS = 1e-4;
  return (
    Math.abs(a.x - b.x) > EPS ||
    Math.abs(a.y - b.y) > EPS ||
    Math.abs(a.width - b.width) > EPS ||
    Math.abs(a.rotation - b.rotation) > 0.05
  );
}

/** Host name of a URL without a leading "www.", or "" when it isn't a URL. */
export function domainOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The site a piece came from: its page when known, otherwise its image host. */
export function sourceDomain(piece: Pick<Piece, "pageUrl" | "src">): string {
  return domainOf(piece.pageUrl) || domainOf(piece.src);
}

/**
 * Converts a snapshot of cursor positions (viewport pixels, keyed by player)
 * into template points relative to the table. Cursors outside the table and
 * the excluded player (the admin pressing the capture button) are skipped.
 */
export function templatePointsFromCursors(
  cursors: Array<{ key: string; x: number; y: number; color: string }>,
  tableRect: { left: number; top: number; width: number; height: number },
  excludeKey: string | undefined,
): TemplatePoints {
  const points: TemplatePoints = {};
  if (tableRect.width <= 0 || tableRect.height <= 0) return points;
  for (const cursor of cursors) {
    if (cursor.key === excludeKey) continue;
    const x = (cursor.x - tableRect.left) / tableRect.width;
    const y = (cursor.y - tableRect.top) / tableRect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) continue;
    points[cursor.key] = { x, y, color: cursor.color };
  }
  return points;
}

/**
 * Orders template points around their centroid so they can be joined into one
 * closed outline. Cursors held in a shape arrive in no particular order;
 * sweeping by angle turns a ring of cursors into the ring's outline.
 * `tableAspect` (width / height) keeps the sweep true to on-screen angles.
 */
export function orderAroundCentroid(
  points: TemplatePoint[],
  tableAspect = 1,
): TemplatePoint[] {
  if (points.length < 3) return [...points];
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return [...points].sort(
    (a, b) =>
      Math.atan2(a.y - cy, (a.x - cx) * tableAspect) -
      Math.atan2(b.y - cy, (b.x - cx) * tableAspect),
  );
}

/** What each person broadcasts while dragging a piece, so others see it move
 * live before the gesture is committed to shared data. */
export interface CollageLive {
  drag: { id: string; transform: PieceTransform } | null;
}

/** In-progress transforms from other people's drags, keyed by piece id. */
export function remoteDragTransforms(
  users: Array<{ user: { isMe: boolean }; live: CollageLive | undefined }>,
): Record<string, PieceTransform> {
  const byPiece: Record<string, PieceTransform> = {};
  for (const { user, live } of users) {
    if (user.isMe || !live?.drag) continue;
    byPiece[live.drag.id] = live.drag.transform;
  }
  return byPiece;
}
