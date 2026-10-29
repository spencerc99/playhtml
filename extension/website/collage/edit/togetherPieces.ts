// ABOUTME: How a shared collage's pieces are stored in its room and handed to the scraps studio.
// ABOUTME: Pure helpers: field-level writes, others' drags laid over what is stored, and the card summary.

import type { CollagePiece } from "@extension/entrypoints/scraps/collageRecord";
import type { PiecesChange } from "@extension/entrypoints/scraps/sharedCollage";
import { parseCutout } from "@extension/entrypoints/scraps/backgroundCutout";
import {
  MAX_COVER_PIECES,
  cleanName,
  isColor,
  MAX_PEOPLE,
  type SharedCollageEntry,
  type SharedCollagePerson,
} from "@extension/features/sharedCollages/sharedCollageEntry";

/** Everyone lays pieces out on a postcard, the studio's own default frame. */
export const TOGETHER_FRAME = { width: 1500, height: 1000 };

/** Who put a piece down. */
export interface Placer {
  pid: string;
  name?: string;
  color: string;
}

/** A studio piece as the room keeps it, with who placed it. */
export type StoredPiece = CollagePiece & { by?: Placer };

export interface TogetherData {
  title: string;
  pieces: Record<string, StoredPiece>;
}

export const EMPTY_TOGETHER: TogetherData = { title: "", pieces: {} };

/** One person's drag in progress: the pieces as they stand mid-gesture. */
export type TogetherLive = {
  draft: CollagePiece[] | null;
};

/** One write to one piece: the fields to set and the fields to take away. */
export interface PieceWrite {
  id: string;
  /** Present when the piece is new to the room: the whole piece. */
  whole?: StoredPiece;
  set: Record<string, unknown>;
  unset: string[];
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The most pieces drawn from a room, so a room flooded with pieces stays
 * usable. Well past what one collage holds.
 */
export const MAX_ROOM_PIECES = 400;
/** The most pieces one person's drag in progress can move. */
export const MAX_DRAFT_PIECES = 60;
/** Who placed a piece, when the room's record of it is unusable. */
const UNKNOWN_COLOR = "#888888";

function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function shortText(value: unknown, max = 200): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** A crop as four fractions of the source, or the whole picture. */
function safeCrop(value: unknown): CollagePiece["crop"] {
  const crop = (value ?? {}) as Record<string, unknown>;
  const { x, y, width, height } = crop;
  if (
    finite(x) &&
    finite(y) &&
    finite(width) &&
    finite(height) &&
    width > 0 &&
    height > 0
  ) {
    return { x, y, width, height };
  }
  return { x: 0, y: 0, width: 1, height: 1 };
}

/** Who placed a piece, cleaned: a name and color fit to show, never markup or CSS. */
export function safePlacer(value: unknown): Placer | undefined {
  if (!value || typeof value !== "object") return undefined;
  const by = value as Record<string, unknown>;
  if (typeof by.pid !== "string" || !by.pid || by.pid.length > 200)
    return undefined;
  const name = cleanName(by.name);
  return {
    pid: by.pid,
    ...(name ? { name } : {}),
    color: isColor(by.color) ? by.color : UNKNOWN_COLOR,
  };
}

/**
 * A piece from the room rebuilt from known fields, or null when it is not a
 * placed picture. Anyone with the link can write to the room, so nothing
 * from it reaches the studio unchecked: only image scraps with a web address
 * and finite geometry, never markup.
 */
export function safePiece(id: string, value: unknown): StoredPiece | null {
  if (!value || typeof value !== "object" || id.length > 200) return null;
  const piece = value as Record<string, unknown>;
  const scrap = (piece.scrap ?? {}) as Record<string, unknown>;
  if (scrap.kind !== "image" || !isWebUrl(scrap.src)) return null;
  const { x, y, width, height, rotation, z } = piece;
  if (
    !finite(x) ||
    !finite(y) ||
    !finite(width) ||
    !finite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  let cutout: CollagePiece["cutout"];
  try {
    cutout = parseCutout(piece.cutout);
  } catch {
    cutout = undefined;
  }
  const by = safePlacer(piece.by);
  return {
    id,
    scrapId: shortText(piece.scrapId) || id,
    scrap: {
      kind: "image",
      id: shortText(scrap.id) || id,
      key: shortText(scrap.key) || id,
      src: scrap.src,
      ...(typeof scrap.alt === "string" && scrap.alt
        ? { alt: scrap.alt.slice(0, 500) }
        : {}),
      naturalWidth:
        finite(scrap.naturalWidth) && scrap.naturalWidth > 0
          ? scrap.naturalWidth
          : 400,
      naturalHeight:
        finite(scrap.naturalHeight) && scrap.naturalHeight > 0
          ? scrap.naturalHeight
          : 300,
      pageTitle: shortText(scrap.pageTitle, 300),
      domain: shortText(scrap.domain),
      pageUrl: isWebUrl(scrap.pageUrl) ? scrap.pageUrl : "",
      ts: finite(scrap.ts) ? scrap.ts : 0,
    },
    x,
    y,
    width,
    height,
    rotation: finite(rotation) ? rotation : 0,
    z: finite(z) ? z : 0,
    crop: safeCrop(piece.crop),
    flipX: piece.flipX === true,
    flipY: piece.flipY === true,
    ...(cutout ? { cutout } : {}),
    ...(piece.locked === true ? { locked: true as const } : {}),
    ...(by ? { by } : {}),
  };
}

/** The room's pieces, each rebuilt by `safePiece`, at most `MAX_ROOM_PIECES` of them. */
export function safePieces(value: unknown): Record<string, StoredPiece> {
  if (!value || typeof value !== "object") return {};
  const pieces: Record<string, StoredPiece> = {};
  let count = 0;
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_ROOM_PIECES) break;
    const piece = safePiece(id, raw);
    if (!piece) continue;
    pieces[id] = piece;
    count += 1;
  }
  return pieces;
}

/** A stored piece without the room's own bookkeeping, as the studio sees it. */
export function studioPiece(stored: StoredPiece): CollagePiece {
  const { by: _by, ...piece } = stored;
  return piece;
}

/** The room's pieces in stacking order, as the studio edits them. */
export function studioPieces(
  pieces: Record<string, StoredPiece>,
): CollagePiece[] {
  return Object.values(pieces)
    .map(studioPiece)
    .sort((a, b) => a.z - b.z);
}

/**
 * What one settled edit writes to the room. A new piece is written whole and
 * marked with who placed it. An edited piece writes only the fields this edit
 * changed, so someone else's edit to another part of it survives.
 */
export function pieceWrites(
  change: PiecesChange,
  stored: Record<string, StoredPiece>,
  me: Placer,
): { writes: PieceWrite[]; removedIds: string[] } {
  const writes = change.upserts.map((piece): PieceWrite => {
    const existing = stored[piece.id];
    if (!existing) {
      return { id: piece.id, whole: { ...piece, by: me }, set: {}, unset: [] };
    }
    const before = (change.before?.get(piece.id) ??
      studioPiece(existing)) as unknown as Record<string, unknown>;
    const after = piece as unknown as Record<string, unknown>;
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(after)) {
      if (!same(before[key], value)) set[key] = value;
    }
    const unset = Object.keys(before).filter(
      (key) => !(key in after) && key !== "by",
    );
    return { id: piece.id, set, unset };
  });
  return {
    writes: writes.filter(
      (write) =>
        write.whole || Object.keys(write.set).length || write.unset.length,
    ),
    removedIds: change.removedIds.filter((id) => id in stored),
  };
}

/** Applies writes to the room's pieces in place. */
export function applyWrites(
  pieces: Record<string, StoredPiece>,
  writes: PieceWrite[],
  removedIds: string[],
): void {
  for (const write of writes) {
    const target = pieces[write.id] as unknown as
      | Record<string, unknown>
      | undefined;
    if (!target) {
      if (write.whole) pieces[write.id] = write.whole;
      continue;
    }
    for (const key of write.unset) delete target[key];
    for (const [key, value] of Object.entries(write.set)) target[key] = value;
  }
  for (const id of removedIds) delete pieces[id];
}

/**
 * The stored pieces with everyone else's drags in progress laid over them. A
 * drag only moves, turns, resizes, crops or flips a piece already in the
 * room: what the piece shows and who placed it always come from the room.
 */
export function withDrafts(
  pieces: Record<string, StoredPiece>,
  peers: Array<{ isMe: boolean; live?: Partial<TogetherLive> }>,
): Record<string, StoredPiece> {
  let merged = pieces;
  for (const peer of peers) {
    const draft = peer.live?.draft;
    if (peer.isMe || !Array.isArray(draft)) continue;
    for (const raw of draft.slice(0, MAX_DRAFT_PIECES)) {
      if (!raw || typeof raw !== "object") continue;
      const piece = raw as unknown as Record<string, unknown>;
      if (typeof piece.id !== "string") continue;
      const stored = pieces[piece.id];
      if (!stored) continue;
      const { x, y, width, height, rotation, z } = piece;
      if (
        !finite(x) ||
        !finite(y) ||
        !finite(width) ||
        !finite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        continue;
      }
      if (merged === pieces) merged = { ...pieces };
      merged[piece.id] = {
        ...stored,
        x,
        y,
        width,
        height,
        rotation: finite(rotation) ? rotation : stored.rotation,
        z: finite(z) ? z : stored.z,
        crop: piece.crop === undefined ? stored.crop : safeCrop(piece.crop),
        flipX: typeof piece.flipX === "boolean" ? piece.flipX : stored.flipX,
        flipY: typeof piece.flipY === "boolean" ? piece.flipY : stored.flipY,
      };
    }
  }
  return merged;
}

/** Why this person may not remove a piece, or null when they may. */
export function removalRefusal(
  piece: StoredPiece | undefined,
  myPid: string | undefined,
): string | null {
  if (!piece?.by || !myPid || piece.by.pid === myPid) return null;
  return `only ${piece.by.name || "whoever added it"} can remove this scrap`;
}

/** Everyone else who has placed something, once each, in their colors. */
export function peopleOf(
  pieces: Record<string, StoredPiece>,
  myPid: string | undefined,
): SharedCollagePerson[] {
  const people = new Map<string, SharedCollagePerson>();
  for (const piece of Object.values(pieces)) {
    const by = piece.by;
    if (!by || by.pid === myPid || people.has(by.pid)) continue;
    people.set(
      by.pid,
      by.name ? { name: by.name, color: by.color } : { color: by.color },
    );
  }
  return [...people.values()].slice(0, MAX_PEOPLE);
}

/**
 * What the extension keeps to show this collage in someone's list: its name,
 * who else is in it, and its topmost pieces as a small thumbnail.
 */
export function collageEntry(options: {
  id: string;
  url: string;
  data: TogetherData;
  myPid: string | undefined;
  startedByMe: boolean;
  now: number;
}): SharedCollageEntry {
  const { id, url, data, myPid, startedByMe, now } = options;
  const pieces = studioPieces(data.pieces ?? {});
  const frame = TOGETHER_FRAME;
  return {
    id,
    url,
    title: data.title ?? "",
    startedByMe,
    joinedAt: now,
    updatedAt: now,
    pieceCount: pieces.length,
    people: peopleOf(data.pieces ?? {}, myPid),
    cover: {
      width: frame.width,
      height: frame.height,
      pieces: pieces
        .filter(
          (piece) =>
            piece.scrap.kind === "image" && /^https?:/.test(piece.scrap.src),
        )
        .slice(-MAX_COVER_PIECES)
        .map((piece) => ({
          src: (piece.scrap as { src: string }).src,
          x: piece.x / frame.width,
          y: piece.y / frame.height,
          width: piece.width / frame.width,
          height: piece.height / frame.height,
          rotation: piece.rotation,
        })),
    },
  };
}

/** A fresh collage id: short and hard to guess, since the link is the invite. */
export function newCollageId(
  bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(12)),
): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/** Someone else in a shared collage, as the bar along the bottom shows them. */
export interface Member {
  pid: string;
  name?: string;
  color: string;
  here: boolean;
}

/**
 * Everyone else in the collage: whoever is here now first, then whoever has
 * placed a piece. Names and colors come from the room, so they are cleaned.
 */
export function membersOf(
  pieces: Record<string, StoredPiece>,
  here: { pid: string; name?: string; color: string; isMe: boolean }[],
  myPid: string | undefined,
): Member[] {
  const members = new Map<string, Member>();
  for (const user of here) {
    const placer = safePlacer(user);
    if (!placer || user.isMe || placer.pid === myPid) continue;
    if (!members.has(placer.pid))
      members.set(placer.pid, { ...placer, here: true });
  }
  for (const piece of Object.values(pieces)) {
    const by = piece.by;
    if (!by || by.pid === myPid || members.has(by.pid)) continue;
    members.set(by.pid, { ...by, here: false });
  }
  return [...members.values()];
}

/** A shared collage's editing link on the site. */
export function collagePath(id: string): string {
  return `/collage/${id}/edit`;
}

/**
 * The collage an address names, `/collage/<id>/edit`, or null for one that
 * names none, such as `/collage/new`, which starts a new collage.
 */
export function collageIdFromAddress(
  pathname: string,
  isId: (value: unknown) => value is string,
): string | null {
  const named = /^\/collage\/([^/]+)\/edit\/?$/.exec(pathname)?.[1];
  return isId(named) ? named : null;
}
