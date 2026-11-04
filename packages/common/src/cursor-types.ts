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

export const MAX_PLAYER_IDENTITY_COLORS = 16;
export const MAX_PLAYER_IDENTITY_STRING_LENGTH = 512;

const PLAYER_IDENTITY_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type CursorZonePosition = {
  zoneId: string;       // matches element.id of the zone element
  relX: number;         // 0-1, percentage within zone element's bounding box
  relY: number;         // 0-1
};

export type CursorPresence = {
  cursor?: Cursor | null;
  /** Who this cursor belongs to. */
  user?: User;
  /** @deprecated Use `user`. */
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
  /** Who this cursor belongs to. */
  user?: User;
  /** @deprecated Use `user` (`user.pid`, `user.name`, `user.color`). */
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

// Who someone is: their stable `pid` (the identity publicKey), `name`, and
// `color` (playerStyle.colorPalette[0]). A `Person` adds their `presence`.
export type User = {
  pid: string;
  name?: string;
  color: string;
  isMe: boolean;
};

/**
 * Flattens a PlayerIdentity into the public `User` shape. Unlike the users
 * module's strict conversion, a missing color becomes "" so a partially
 * populated remote identity still yields a usable view.
 */
export function playerIdentityToUser(
  identity: PlayerIdentity,
  isMe: boolean,
): User {
  const user: User = {
    pid: identity.publicKey,
    color: toHexColor(identity.playerStyle?.colorPalette?.[0] ?? ""),
    isMe,
  };
  if (identity.name !== undefined) user.name = identity.name;
  return user;
}

/**
 * Returns `color` as a lowercase hex string when it's a hex, `hsl()`, or
 * `rgb()` color: `#rrggbb` for opaque colors, so they work in
 * `<input type="color">` (which only accepts that form), and `#rrggbbaa` when
 * the color is see-through, so alpha is kept. Other CSS colors (like `"red"`)
 * are returned unchanged.
 */
export function toHexColor(color: string): string {
  const value = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    const digits =
      hex[1].length <= 4
        ? [...hex[1]].map((digit) => digit + digit).join("")
        : hex[1];
    return digits.length === 8 && digits.endsWith("ff")
      ? `#${digits.slice(0, 6)}`
      : `#${digits}`;
  }
  const toHex = (channel: number) =>
    Math.round(Math.min(255, Math.max(0, channel)))
      .toString(16)
      .padStart(2, "0");
  // Appends an alpha byte only when the color is see-through.
  const withAlpha = (rgbHex: string, alpha: string | undefined) => {
    if (alpha === undefined) return rgbHex;
    const amount = alpha.endsWith("%")
      ? parseFloat(alpha) / 100
      : parseFloat(alpha);
    const byte = toHex(Math.min(1, Math.max(0, amount)) * 255);
    return byte === "ff" ? rgbHex : `${rgbHex}${byte}`;
  };
  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(
      value,
    );
  if (rgb) {
    return withAlpha(
      `#${toHex(+rgb[1])}${toHex(+rgb[2])}${toHex(+rgb[3])}`,
      rgb[4],
    );
  }
  const hsl =
    /^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(
      value,
    );
  if (hsl) {
    const hue = (((+hsl[1] % 360) + 360) % 360) / 360;
    const saturation = Math.min(100, +hsl[2]) / 100;
    const lightness = Math.min(100, +hsl[3]) / 100;
    const q =
      lightness < 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;
    const channel = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return withAlpha(
      `#${toHex(channel(hue + 1 / 3) * 255)}${toHex(channel(hue) * 255)}${toHex(channel(hue - 1 / 3) * 255)}`,
      hsl[4],
    );
  }
  return color;
}

// Default person colors are tuned in HSL (fixed saturation and lightness, any
// hue) and saved as hex, so they work in native color inputs.
function defaultColor(hue: number): string {
  return toHexColor(`hsl(${hue % 360}, 70%, 60%)`);
}

// Constants
export const PROXIMITY_THRESHOLD = 150; // pixels

/** Returns a random hex color (used as default primary color when none exists). */
function randomPrimaryColor(): string {
  return defaultColor(Math.floor(Math.random() * 360));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function toPublicPlayerIdentity(value: unknown): PlayerIdentity | null {
  if (!isRecord(value)) return null;
  if (!isValidPlayerIdentityString(value.publicKey)) {
    return null;
  }

  const sourceStyle = isRecord(value.playerStyle) ? value.playerStyle : {};
  const colorPalette = Array.isArray(sourceStyle.colorPalette)
    ? sourceStyle.colorPalette
        .filter(isValidPlayerIdentityString)
        .slice(0, MAX_PLAYER_IDENTITY_COLORS)
    : [];

  const identity: PlayerIdentity = {
    publicKey: value.publicKey,
    playerStyle: { colorPalette },
  };

  const name = toOptionalPlayerIdentityString(value.name);
  if (name !== undefined) {
    identity.name = name;
  }

  const cursorStyle = toOptionalPlayerIdentityString(sourceStyle.cursorStyle);
  if (cursorStyle !== undefined) {
    identity.playerStyle.cursorStyle = cursorStyle;
  }

  if (Number.isFinite(value.createdAt)) {
    identity.createdAt = Number(value.createdAt);
  }

  return identity;
}

function isValidPlayerIdentityString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PLAYER_IDENTITY_STRING_LENGTH &&
    !PLAYER_IDENTITY_CONTROL_CHARACTERS.test(value)
  );
}

function toOptionalPlayerIdentityString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (PLAYER_IDENTITY_CONTROL_CHARACTERS.test(value)) return undefined;
  return value.slice(0, MAX_PLAYER_IDENTITY_STRING_LENGTH);
}

export function generatePlayerIdentity(): PlayerIdentity {
  const publicKey = crypto
    .getRandomValues(new Uint8Array(16))
    .reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "");

  const hue = Math.floor(Math.random() * 360);
  const colorPalette = [
    defaultColor(hue),
    defaultColor(hue + 120),
    defaultColor(hue + 240),
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

export function savePlayerIdentityToStorage(identity: PlayerIdentity): void {
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
