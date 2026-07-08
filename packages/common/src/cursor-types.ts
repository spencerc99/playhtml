// ABOUTME: Shared cursor types for real-time collaborative cursor rendering.
// ABOUTME: Includes presence, identity, zone positioning, and event payloads.

export type Cursor = {
  x: number;
  y: number;
  pointer: "mouse" | "touch" | string;
};

export type PlayerIdentity = {
  publicKey: string;
  name?: string;
  playerStyle: {
    colorPalette: string[];
    cursorStyle?: string;
  };
  createdAt?: number;
};

export type CursorZonePosition = {
  zoneId: string;       // matches element.id of the zone element
  relX: number;         // 0-1, percentage within zone element's bounding box
  relY: number;         // 0-1
};

export type CursorPresence = {
  cursor?: Cursor | null;
  playerIdentity?: PlayerIdentity;
  lastSeen?: number;
  message?: string | null;
  page?: string;
  zone?: CursorZonePosition | null;
};

// Slim cursor presence type for rendering (excludes internal fields).
// `page` is the reader's pathname at the time their awareness was broadcast
// — exposed so UI can tell "who is on the same page" from "who is reading the
// docs, but on a different page". Consumers should treat it as advisory:
// single-page apps can set it to anything they want to group presences by.
export type CursorPresenceView = {
  cursor: Cursor | null;
  playerIdentity?: PlayerIdentity;
  zone?: CursorZonePosition | null;
  page?: string;
};

// Event payloads for cursor-related global API updates
export interface CursorEvents {
  allColors: string[];
  color: string;
  name: string | undefined;
}

// Constants
export const PROXIMITY_THRESHOLD = 150; // pixels

/** Returns a random HSL color string (used as default primary color when none exists). */
function randomPrimaryColor(): string {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 70%, 60%)`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function toPublicPlayerIdentity(value: unknown): PlayerIdentity | null {
  if (!isRecord(value)) return null;
  if (typeof value.publicKey !== "string" || value.publicKey.length === 0) {
    return null;
  }

  const sourceStyle = isRecord(value.playerStyle) ? value.playerStyle : {};
  const colorPalette = Array.isArray(sourceStyle.colorPalette)
    ? sourceStyle.colorPalette.filter(
        (color): color is string =>
          typeof color === "string" && color.length > 0,
      )
    : [];

  const identity: PlayerIdentity = {
    publicKey: value.publicKey,
    playerStyle: { colorPalette },
  };

  if (typeof value.name === "string") {
    identity.name = value.name;
  }

  if (typeof sourceStyle.cursorStyle === "string") {
    identity.playerStyle.cursorStyle = sourceStyle.cursorStyle;
  }

  if (Number.isFinite(value.createdAt)) {
    identity.createdAt = Number(value.createdAt);
  }

  return identity;
}

export function generatePlayerIdentity(): PlayerIdentity {
  const publicKey = crypto
    .getRandomValues(new Uint8Array(16))
    .reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "");

  const hue = Math.floor(Math.random() * 360);
  const colorPalette = [
    `hsl(${hue}, 70%, 60%)`,
    `hsl(${(hue + 120) % 360}, 70%, 60%)`,
    `hsl(${(hue + 240) % 360}, 70%, 60%)`,
  ];

  return {
    publicKey,
    playerStyle: {
      colorPalette,
    },
    createdAt: Date.now(),
  };
}

/** Returns true if identity has a non-empty primary color. */
function hasValidPrimaryColor(identity: PlayerIdentity): boolean {
  const color = identity.playerStyle?.colorPalette?.[0];
  return typeof color === "string" && color.length > 0;
}

function savePlayerIdentityToStorage(identity: PlayerIdentity): void {
  try {
    localStorage.setItem(
      PLAYER_IDENTITY_STORAGE_KEY,
      JSON.stringify(identity),
    );
  } catch (e) {
    console.warn("Failed to save player identity to localStorage:", e);
  }
}

/** Ensures identity has a primary color, assigning one when missing. */
function ensurePrimaryColor(identity: PlayerIdentity): boolean {
  if (!hasValidPrimaryColor(identity)) {
    if (!identity.playerStyle) identity.playerStyle = { colorPalette: [] };
    if (!Array.isArray(identity.playerStyle.colorPalette)) {
      identity.playerStyle.colorPalette = [];
    }
    identity.playerStyle.colorPalette[0] = randomPrimaryColor();
    return true;
  }
  return false;
}

export const PLAYER_IDENTITY_STORAGE_KEY = "playhtml_player_identity";

// Module-level cache so repeated calls return a reference-stable identity.
// Identity is set-once per tab: JSON.parse allocates a new object on each
// localStorage read, which would otherwise cause React effect deps and memo
// comparisons keyed on identity to invalidate on every render.
let cachedPlayerIdentity: PlayerIdentity | null = null;

/**
 * Loads player identity from localStorage, or generates a new one with a random
 * primary color. Ensures primary color always exists (assigns random and saves if missing).
 * Identity is persisted so the same publicKey and color are reused across sessions.
 *
 * The returned reference is cached for the lifetime of the JS context —
 * subsequent calls return the same object, not a fresh parse.
 */
export function generatePersistentPlayerIdentity(): PlayerIdentity {
  if (cachedPlayerIdentity) return cachedPlayerIdentity;

  const stored = localStorage.getItem(PLAYER_IDENTITY_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const identity = toPublicPlayerIdentity(parsed);
      if (identity) {
        const shouldSave =
          ensurePrimaryColor(identity) ||
          JSON.stringify(identity) !== JSON.stringify(parsed);
        if (shouldSave) savePlayerIdentityToStorage(identity);
        cachedPlayerIdentity = identity;
        return identity;
      }
    } catch (e) {
      console.warn(
        "Failed to parse stored player identity, generating new one",
      );
    }
  }

  // No valid stored identity: generate new one (includes random primary color) and save
  const identity = generatePlayerIdentity();
  savePlayerIdentityToStorage(identity);
  cachedPlayerIdentity = identity;
  return identity;
}
