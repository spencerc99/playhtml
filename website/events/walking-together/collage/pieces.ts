// ABOUTME: Pure data and geometry helpers for the shared table collage.
// ABOUTME: Pieces live in a keyed map; positions and sizes are relative to the table.

/** One scrap placed on the table. Positions are relative to the table so every
 * screen size sees the same arrangement: x/y are the piece center (0..1 of the
 * table width/height) and width is a fraction of the table width. */
export interface Piece {
  id: string;
  src: string;
  /** The page the scrap came from, so people can get back to it. Pieces
   * placed during the first walk hold only the site's origin. Empty when
   * unknown. */
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

/** Smallest and largest width a scrap can be resized to. */
export const MIN_PIECE_WIDTH = 0.04;
export const MAX_PIECE_WIDTH = 0.7;
/** Aspect used when an image never reports its size (e.g. it failed to load). */
export const FALLBACK_ASPECT = 0.75;

/** Null-safe view of the pieces map, tolerant of a room that predates it. */
export function piecesOf(data: Partial<CollageData> | undefined): Pieces {
  return data?.pieces ?? {};
}

/** Most pieces a table shows; anything past it in the room is ignored. */
export const MAX_TABLE_PIECES = 400;

function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** A piece rebuilt field by field from whatever the room holds, or null when
 * it can't be shown. Anyone can write to the room, so nothing is trusted. */
export function safePiece(id: string, value: unknown): Piece | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!isWebUrl(raw.src) || raw.src.length > 4000) return null;
  const piece: Piece = {
    id: id.slice(0, 200),
    src: raw.src,
    pageUrl: isWebUrl(raw.pageUrl) ? raw.pageUrl.slice(0, 2000) : "",
    alt: text(raw.alt, 500),
    placedByPid: text(raw.placedByPid, 100),
    placedByName: text(raw.placedByName, 40),
    placedByColor: /^#[0-9a-f]{3,8}$/i.test(text(raw.placedByColor, 9))
      ? (raw.placedByColor as string)
      : "#888888",
    x: clamp(finite(raw.x, 0.5), -1, 2),
    y: clamp(finite(raw.y, 0.5), -1, 2),
    width: clamp(finite(raw.width, 0.2), MIN_PIECE_WIDTH, MAX_PIECE_WIDTH),
    aspect: clamp(finite(raw.aspect, FALLBACK_ASPECT), 0.01, 100),
    rotation: finite(raw.rotation, 0) % 360,
    z: clamp(finite(raw.z, 0), -1e9, 1e9),
    placedAt: finite(raw.placedAt, 0),
  };
  const crop = raw.crop as Record<string, unknown> | undefined;
  if (crop && typeof crop === "object") {
    piece.crop = {
      x: clamp(finite(crop.x, 0), 0, 1),
      y: clamp(finite(crop.y, 0), 0, 1),
      width: clamp(finite(crop.width, 1), 0.001, 1),
      height: clamp(finite(crop.height, 1), 0.001, 1),
    };
  }
  if (raw.flipX === true) piece.flipX = true;
  if (raw.flipY === true) piece.flipY = true;
  if (raw.locked === true) piece.locked = true;
  const cutout = raw.cutout as Record<string, unknown> | undefined;
  if (cutout && typeof cutout === "object" && cutout.method === "edge-color") {
    piece.cutout = {
      method: "edge-color",
      tolerance: clamp(finite(cutout.tolerance, 0), 0, 1),
      ...(cutout.keep === "subject" || cutout.keep === "background"
        ? { keep: cutout.keep }
        : {}),
    };
  }
  return piece;
}

/** The room's pieces, each rebuilt by `safePiece`, at most `MAX_TABLE_PIECES`. */
export function safePieces(pieces: Record<string, unknown>): Pieces {
  const safe: Pieces = {};
  let count = 0;
  for (const [id, value] of Object.entries(pieces)) {
    if (count >= MAX_TABLE_PIECES) break;
    const piece = safePiece(id, value);
    if (!piece) continue;
    safe[id] = piece;
    count++;
  }
  return safe;
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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface Placer {
  pid: string;
  name: string;
  color: string;
}

/** The part of a piece that places it on the table. */
export interface PieceTransform {
  x: number;
  y: number;
  width: number;
  rotation: number;
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

/** The page a scrap came from, so anyone at the table can get back to it.
 * Only web pages count. Pieces placed before this kept just the site's
 * origin, which still reads as a link to the site. */
export function pageLink(url: string | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
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
/** What one person is part way through changing, shared live so everyone
 * can watch a drag, turn or resize as it happens. Never persisted. */
/**
 * One piece someone is part way through changing: just the fields they have
 * changed so far, or the whole piece when it is new to the table.
 */
export interface DraftPatch {
  id: string;
  set: Partial<Piece>;
  unset?: string[];
}

export interface CollageLive {
  draft: DraftPatch[] | null;
}

function isWholePiece(value: Partial<Piece>): value is Piece {
  return typeof value.src === "string" && typeof value.x === "number";
}

/**
 * Other people's in-progress pieces laid over the stored ones, keyed by piece
 * id. Each draft only overrides the fields its author is changing, so a field
 * someone else changed meanwhile still shows. Presence from an older page (or
 * anything malformed) is skipped.
 */
export function remoteDrafts(
  users: Array<{ user: { isMe: boolean }; live: Partial<CollageLive> | undefined }>,
  stored: Pieces,
): Record<string, Piece> {
  const byPiece: Record<string, Piece> = {};
  for (const { user, live } of users) {
    if (user.isMe || !Array.isArray(live?.draft)) continue;
    for (const patch of live.draft) {
      if (!patch || typeof patch.id !== "string") continue;
      if (!patch.set || typeof patch.set !== "object") continue;
      const base = byPiece[patch.id] ?? stored[patch.id];
      if (!base) {
        if (isWholePiece(patch.set)) byPiece[patch.id] = patch.set;
        continue;
      }
      const next = { ...base } as unknown as Record<string, unknown>;
      for (const key of Array.isArray(patch.unset) ? patch.unset : []) delete next[key];
      Object.assign(next, patch.set);
      byPiece[patch.id] = next as unknown as Piece;
    }
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
