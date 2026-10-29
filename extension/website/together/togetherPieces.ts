// ABOUTME: How a shared collage's pieces are stored in its room and handed to the scraps studio.
// ABOUTME: Pure helpers: field-level writes, others' drags laid over what is stored, and the card summary.

import type { CollagePiece } from "@extension/entrypoints/scraps/collageRecord";
import type { PiecesChange } from "@extension/entrypoints/scraps/sharedCollage";
import {
  MAX_COVER_PIECES,
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

/** The stored pieces with everyone else's drags in progress laid over them. */
export function withDrafts(
  pieces: Record<string, StoredPiece>,
  peers: Array<{ isMe: boolean; live?: Partial<TogetherLive> }>,
): Record<string, StoredPiece> {
  let merged = pieces;
  for (const peer of peers) {
    const draft = peer.live?.draft;
    if (peer.isMe || !Array.isArray(draft)) continue;
    for (const piece of draft) {
      if (!piece || typeof piece.id !== "string") continue;
      // A draft only moves pieces still in the room, never brings one back.
      const stored = pieces[piece.id];
      if (!stored) continue;
      if (merged === pieces) merged = { ...pieces };
      merged[piece.id] = { ...piece, by: stored.by };
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
