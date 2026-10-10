// ABOUTME: Pure data and geometry helpers for the shared table collage.
// ABOUTME: Pieces live in a keyed map; positions and sizes are relative to the table.

/** One scrap placed on the table. Positions are relative to the table so every
 * screen size sees the same arrangement: x/y are the piece center (0..1 of the
 * table width/height) and width is a fraction of the table width. */
export interface Piece {
  id: string;
  src: string;
  /** The site the scrap came from, as an origin only (no path, query, or
   * hash), since everyone in the room can read it. Empty when unknown. Rooms
   * from before this rule may hold full URLs; readers only take the host. */
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
  /** The part of the source image the piece shows, as fractions of it.
   * Absent means the whole image. The fields below are all optional so rooms
   * from before the editing tools load unchanged. */
  crop?: { x: number; y: number; width: number; height: number };
  flipX?: boolean;
  flipY?: boolean;
  /** A background cutout, computed in each viewer's browser. */
  cutout?: { method: "edge-color"; tolerance: number; keep?: "subject" | "background" };
  /** A locked piece can't be moved, turned, or sized until it's unlocked. */
  locked?: boolean;
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
  /** When the admin last gathered the scraps into the shape (ms). Optional,
   * since rooms from before the gather have no value; clients use it to
   * stagger the glide so the collage assembles piece by piece. */
  arrangedAt?: number;
}

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
    pageUrl: pageOrigin(input.pageUrl),
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

/** Just the origin of a page URL, so shared data never carries the path,
 * search terms, tokens, or fragments of the page someone was on. */
export function pageOrigin(url: string | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : "";
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

/** True when a point is inside a closed polygon (even-odd rule). */
export function pointInPolygon(
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Area of a polygon in relative table units (shoelace formula). */
export function polygonArea(polygon: Array<{ x: number; y: number }>): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
  }
  return Math.abs(sum) / 2;
}

/** The shape scraps gather into when no cursor shape was captured: a soft
 * oval in the middle of the table, round on screen at any table aspect. */
export function defaultShape(tableAspect: number, sides = 24): TemplatePoint[] {
  const ry = 0.32;
  const rx = Math.min(0.42, ry / tableAspect);
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return {
      x: 0.5 + rx * Math.cos(a),
      y: 0.5 + ry * Math.sin(a),
      color: "#888888",
    };
  });
}

/** How much paper to lay down relative to the shape's area. Above 1 means the
 * scraps overlap, which reads as a collage rather than a tidy grid. */
export const SHAPE_COVERAGE = 1.6;

/**
 * Lays every piece out inside a shape: spots spread evenly across the shape
 * (farthest-point sampling), one width for all scraps sized so their paper
 * covers the shape with overlap, and a fresh tilt and stacking order so the
 * result reads as a hand-made collage. Returns the new transform and z per
 * piece. Positions are relative to the table, like everything else.
 */
export function arrangeIntoShape(
  pieces: Pieces,
  shape: TemplatePoint[],
  tableAspect: number,
  random: () => number,
): Record<string, PieceTransform & { z: number }> {
  const list = Object.values(pieces).sort((a, b) => a.placedAt - b.placedAt);
  const result: Record<string, PieceTransform & { z: number }> = {};
  if (list.length === 0) return result;

  const polygon =
    shape.length >= 3 && polygonArea(shape) > 0.002
      ? shape
      : defaultShape(tableAspect);
  const area = polygonArea(polygon);

  // Piece area as a fraction of the table is width * width * aspect * tableAspect.
  const aspectSum = list.reduce((sum, p) => sum + p.aspect, 0);
  const width = clamp(
    Math.sqrt((SHAPE_COVERAGE * area) / (tableAspect * aspectSum)),
    MIN_PIECE_WIDTH,
    MAX_PIECE_WIDTH,
  );

  // Candidate spots: random points that land inside the shape.
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const candidates: Array<{ x: number; y: number }> = [];
  const wanted = Math.max(200, list.length * 30);
  for (let tries = 0; candidates.length < wanted && tries < wanted * 20; tries++) {
    const p = {
      x: minX + random() * (maxX - minX),
      y: minY + random() * (maxY - minY),
    };
    if (pointInPolygon(p, polygon)) candidates.push(p);
  }
  if (candidates.length === 0) {
    candidates.push({
      x: xs.reduce((s, x) => s + x, 0) / xs.length,
      y: ys.reduce((s, y) => s + y, 0) / ys.length,
    });
  }

  // Farthest-point sampling, measured in on-screen proportions, so spots
  // spread across the whole shape instead of clumping.
  const spots: Array<{ x: number; y: number }> = [];
  const nearest = candidates.map(() => Infinity);
  let next = Math.floor(random() * candidates.length);
  while (spots.length < list.length) {
    const chosen = candidates[next];
    spots.push(chosen);
    let best = -1;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const d = Math.hypot((c.x - chosen.x) * tableAspect, c.y - chosen.y);
      if (d < nearest[i]) nearest[i] = d;
      if (best === -1 || nearest[i] > nearest[best]) best = i;
    }
    next = best;
  }

  // Shuffle who gets which spot and who sits on top, so one person's scraps
  // don't cluster and the stack doesn't follow placement order.
  const order = list.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const baseZ = topZ(pieces) + 1;
  list.forEach((piece, i) => {
    const spot = spots[order[i]];
    result[piece.id] = {
      x: clamp(spot.x, 0, 1),
      y: clamp(spot.y, 0, 1),
      // A little size variety keeps it from looking like a contact sheet.
      width: clamp(width * (0.85 + random() * 0.3), MIN_PIECE_WIDTH, MAX_PIECE_WIDTH),
      rotation: Math.round((random() * 16 - 8) * 10) / 10,
      z: baseZ + order[i],
    };
  });
  return result;
}
