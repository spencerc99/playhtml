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
};

export type CursorPresence = {
  cursor?: Cursor | null;
  playerIdentity?: PlayerIdentity;
  lastSeen?: number;
  message?: string | null;
};

export type CursorMetadata = {
  country: string | null;
  connectionId: string;
};

export type CursorUser = {
  presence: CursorPresence;
  metadata: CursorMetadata;
};

// Message types
export type CursorPartyMessage =
  | {
      type: "cursor-sync";
      users: { [connectionId: string]: CursorUser };
    }
  | {
      type: "cursor-changes";
      add?: { [connectionId: string]: CursorUser };
      presence?: { [connectionId: string]: CursorPresence };
      remove?: string[];
    }
  | {
      type: "proximity-entered";
      connectionId: string;
      otherConnectionId: string;
      playerIdentity?: PlayerIdentity;
    }
  | {
      type: "proximity-left";
      connectionId: string;
      otherConnectionId: string;
    };

export type CursorClientMessage = {
  type: "cursor-update";
  presence: CursorPresence;
};

// Constants
export const PROXIMITY_THRESHOLD = 150; // pixels
export const VISIBILITY_THRESHOLD = 300; // pixels

// Utility functions
export function calculateDistance(cursor1: Cursor, cursor2: Cursor): number {
  return Math.sqrt(
    Math.pow(cursor1.x - cursor2.x, 2) + Math.pow(cursor1.y - cursor2.y, 2)
  );
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
  };
}
