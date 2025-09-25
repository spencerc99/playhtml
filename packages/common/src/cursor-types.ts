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
};

// Event payloads for cursor-related global API updates
export interface CursorEvents {
  allColors: string[];
  color: string;
  name: string | undefined;
}

// Constants
export const PROXIMITY_THRESHOLD = 150; // pixels

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

export const PLAYER_IDENTITY_STORAGE_KEY = "playhtml_player_identity";
export function generatePersistentPlayerIdentity(): PlayerIdentity {
  // Try to load existing identity from localStorage
  const stored = localStorage.getItem(PLAYER_IDENTITY_STORAGE_KEY);
  if (stored) {
    try {
      const identity = JSON.parse(stored);
      // Validate that it has the required structure
      if (identity.publicKey && identity.playerStyle?.colorPalette) {
        return identity;
      }
    } catch (e) {
      // If parsing fails, generate new identity
      console.warn(
        "Failed to parse stored player identity, generating new one"
      );
    }
  }

  // Generate new identity if none exists or stored one is invalid
  const identity = generatePlayerIdentity();

  // Save to localStorage
  try {
    localStorage.setItem(PLAYER_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch (e) {
    console.warn("Failed to save player identity to localStorage:", e);
  }

  return identity;
}
