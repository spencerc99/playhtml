// Basic cursor types shared between client and server

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
  discoveredSites?: string[];
  createdAt?: number;
};

export type CursorPresence = {
  cursor?: Cursor | null;
  playerIdentity?: PlayerIdentity;
  lastSeen?: number;
  message?: string | null;
  page?: string;
};

// Slim cursor presence type for rendering (excludes internal fields)
export type CursorPresenceView = {
  cursor: Cursor | null;
  playerIdentity?: PlayerIdentity;
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
    discoveredSites: [],
    createdAt: Date.now(),
  };
}

/** Returns true if identity has a non-empty primary color. */
function hasValidPrimaryColor(identity: PlayerIdentity): boolean {
  const color = identity.playerStyle?.colorPalette?.[0];
  return typeof color === "string" && color.length > 0;
}

/** Ensures identity has a primary color (assigns random if missing), then saves to localStorage. */
function ensurePrimaryColorAndSave(identity: PlayerIdentity): void {
  if (!hasValidPrimaryColor(identity)) {
    if (!identity.playerStyle) identity.playerStyle = { colorPalette: [] };
    if (!Array.isArray(identity.playerStyle.colorPalette)) {
      identity.playerStyle.colorPalette = [];
    }
    identity.playerStyle.colorPalette[0] = randomPrimaryColor();
    try {
      localStorage.setItem(
        PLAYER_IDENTITY_STORAGE_KEY,
        JSON.stringify(identity),
      );
    } catch (e) {
      console.warn("Failed to save player identity to localStorage:", e);
    }
  }
}

export const PLAYER_IDENTITY_STORAGE_KEY = "playhtml_player_identity";
/**
 * Loads player identity from localStorage, or generates a new one with a random
 * primary color. Ensures primary color always exists (assigns random and saves if missing).
 * Identity is persisted so the same publicKey and color are reused across sessions.
 */
export function generatePersistentPlayerIdentity(): PlayerIdentity {
  const stored = localStorage.getItem(PLAYER_IDENTITY_STORAGE_KEY);
  if (stored) {
    try {
      const identity = JSON.parse(stored) as PlayerIdentity;
      if (identity.publicKey) {
        // If stored identity has no valid primary color, assign random and persist
        if (!hasValidPrimaryColor(identity)) {
          ensurePrimaryColorAndSave(identity);
        }
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
  try {
    localStorage.setItem(PLAYER_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch (e) {
    console.warn("Failed to save player identity to localStorage:", e);
  }
  return identity;
}
