// ABOUTME: What the extension keeps about a shared collage someone started or joined, and the page messages that carry it.
// ABOUTME: Pure parsing, shared by the shared collage page and the extension, so neither trusts the other's shape.

/**
 * Messages a shared collage page posts to its own window for the extension's
 * content script:
 *  - { source, type: "set-name", name } names this person everywhere.
 *  - { source, type: "remember", collage } keeps the collage in their list.
 * The extension only listens on shared collage pages, and the background
 * checks the tab's address again before acting.
 */
export const SHARED_COLLAGE_SOURCE = "wwo-shared-collage";
export const SHARED_COLLAGE_SET_NAME = "set-name";
export const SHARED_COLLAGE_REMEMBER = "remember";

/** The longest name someone can give themselves. */
export const MAX_NAME_LENGTH = 32;
/** Enough pieces to draw a recognizable thumbnail without storing the collage. */
export const MAX_COVER_PIECES = 16;
/** Other people shown on a card. */
export const MAX_PEOPLE = 8;

/** One piece of the card's thumbnail, placed in fractions of the frame. */
export interface SharedCollageCoverPiece {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface SharedCollagePerson {
  name?: string;
  color: string;
}

export interface SharedCollageEntry {
  id: string;
  /** The shared collage page, which is where the card opens. */
  url: string;
  title: string;
  /** Whether this person started it, rather than joined from a link. */
  startedByMe: boolean;
  joinedAt: number;
  updatedAt: number;
  pieceCount: number;
  /** Everyone else who has placed something, in their cursor colors. */
  people: SharedCollagePerson[];
  /** The frame's proportions and its topmost pieces, for the thumbnail. */
  cover: {
    width: number;
    height: number;
    pieces: SharedCollageCoverPiece[];
  };
}

export interface SetNameMessage {
  source: typeof SHARED_COLLAGE_SOURCE;
  type: typeof SHARED_COLLAGE_SET_NAME;
  name: string;
}

export interface RememberMessage {
  source: typeof SHARED_COLLAGE_SOURCE;
  type: typeof SHARED_COLLAGE_REMEMBER;
  collage: SharedCollageEntry;
}

/**
 * A collage id exactly as the shared collage page makes them: 12 characters
 * from an alphabet without look-alikes. Anything else, such as a hand-typed
 * "?c=test", is refused, so there are no guessable public rooms.
 */
export function isCollageId(value: unknown): value is string {
  return typeof value === "string" && /^[a-km-np-z2-9]{12}$/.test(value);
}

/** A name with surrounding space trimmed, or null when there is none to keep. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Control, zero-width and direction-override characters never belong in a
  // name that shows beside a cursor on every playhtml page.
  const name = value
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return name || null;
}

function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A plain color: hex, hsl() or rgb(), never another CSS value such as url(). */
export function isColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(#[0-9a-f]{3,8}|hsla?\([^)]{1,60}\)|rgba?\([^)]{1,60}\))$/i.test(value)
  );
}

/**
 * A shared collage entry as the extension keeps it, or null when the value is
 * not one. `isPageUrl` decides which addresses count as shared collage pages.
 */
export function parseSharedCollageEntry(
  value: unknown,
  isPageUrl: (url: string) => boolean,
): SharedCollageEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (
    !isCollageId(entry.id) ||
    typeof entry.url !== "string" ||
    !isPageUrl(entry.url)
  ) {
    return null;
  }
  const cover = (entry.cover ?? {}) as Record<string, unknown>;
  const coverPieces = Array.isArray(cover.pieces) ? cover.pieces : [];
  const people = Array.isArray(entry.people) ? entry.people : [];
  return {
    id: entry.id,
    url: entry.url,
    title: typeof entry.title === "string" ? entry.title.slice(0, 120) : "",
    startedByMe: entry.startedByMe === true,
    joinedAt: finite(entry.joinedAt),
    updatedAt: finite(entry.updatedAt),
    pieceCount: Math.max(0, Math.floor(finite(entry.pieceCount))),
    people: people
      .flatMap((person): SharedCollagePerson[] => {
        if (!person || typeof person !== "object") return [];
        const { name, color } = person as Record<string, unknown>;
        if (!isColor(color)) return [];
        const clean = cleanName(name);
        return [clean ? { name: clean, color } : { color }];
      })
      .slice(0, MAX_PEOPLE),
    cover: {
      width: Math.max(1, finite(cover.width, 1)),
      height: Math.max(1, finite(cover.height, 1)),
      pieces: coverPieces
        .flatMap((piece): SharedCollageCoverPiece[] => {
          if (!piece || typeof piece !== "object") return [];
          const p = piece as Record<string, unknown>;
          if (!isWebUrl(p.src)) return [];
          return [
            {
              src: p.src,
              x: finite(p.x),
              y: finite(p.y),
              width: finite(p.width),
              height: finite(p.height),
              rotation: finite(p.rotation),
            },
          ];
        })
        .slice(0, MAX_COVER_PIECES),
    },
  };
}

/** Keeps who started it once it is known, and the first time it was joined. */
export function mergeSharedCollageEntry(
  existing: SharedCollageEntry | undefined,
  incoming: SharedCollageEntry,
): SharedCollageEntry {
  if (!existing) return incoming;
  return {
    ...incoming,
    startedByMe: existing.startedByMe || incoming.startedByMe,
    joinedAt: existing.joinedAt || incoming.joinedAt,
  };
}

export function isSetNameMessage(value: unknown): value is SetNameMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<SetNameMessage>;
  return (
    message.source === SHARED_COLLAGE_SOURCE &&
    message.type === SHARED_COLLAGE_SET_NAME &&
    cleanName(message.name) !== null
  );
}

export function isRememberMessage(value: unknown): value is RememberMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<RememberMessage>;
  return (
    message.source === SHARED_COLLAGE_SOURCE &&
    message.type === SHARED_COLLAGE_REMEMBER &&
    !!message.collage &&
    typeof message.collage === "object"
  );
}
