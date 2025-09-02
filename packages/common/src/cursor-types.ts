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
