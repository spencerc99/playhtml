// ABOUTME: Converts generic realtime presence channels into cursor presence state.
// ABOUTME: Collapses per-connection socket state into stable player identities.

import type {
  Cursor,
  CursorPresence,
  CursorZonePosition,
  PlayerIdentity,
  PresenceChangesMessage,
  PresenceSnapshot,
} from "@playhtml/common";

type PeerChannels = Record<string, unknown>;

type CursorChannelValue = {
  cursor?: Cursor | null;
  zone?: CursorZonePosition | null;
  page?: string;
  at?: number;
};

export type StoredCursorPresence = CursorPresence & {
  cursor: Cursor;
  playerIdentity: PlayerIdentity;
};

export class CursorPresenceStore {
  private peers = new Map<string, PeerChannels>();

  applySync(snapshot: PresenceSnapshot): void {
    this.peers.clear();
    for (const [connectionId, channels] of Object.entries(snapshot)) {
      this.peers.set(connectionId, { ...channels });
    }
  }

  applyChanges(message: PresenceChangesMessage): void {
    for (const [connectionId, channels] of Object.entries(message.updates)) {
      const peer = this.peers.get(connectionId) ?? {};
      this.peers.set(connectionId, peer);
      for (const [channel, value] of Object.entries(channels)) {
        peer[channel] = value;
      }
    }

    for (const [connectionId, channels] of Object.entries(message.removes)) {
      const peer = this.peers.get(connectionId);
      if (!peer) continue;
      for (const channel of channels) {
        delete peer[channel];
      }
      if (Object.keys(peer).length === 0) {
        this.peers.delete(connectionId);
      }
    }
  }

  getRemotePresences(localPublicKey: string): Map<string, StoredCursorPresence> {
    const presences = new Map<string, StoredCursorPresence>();
    const connectionIds = Array.from(this.peers.keys()).sort();

    for (const connectionId of connectionIds) {
      const presence = this.getPresenceForConnection(connectionId);
      if (!presence) continue;
      if (presence.playerIdentity.publicKey === localPublicKey) continue;
      presences.set(presence.playerIdentity.publicKey, presence);
    }

    return presences;
  }

  getPresenceByStableId(stableId: string): StoredCursorPresence | null {
    for (const connectionId of Array.from(this.peers.keys()).sort()) {
      const presence = this.getPresenceForConnection(connectionId);
      if (presence?.playerIdentity.publicKey === stableId) return presence;
    }
    return null;
  }

  getConnectionCount(): number {
    return this.peers.size;
  }

  private getPresenceForConnection(
    connectionId: string,
  ): StoredCursorPresence | null {
    const channels = this.peers.get(connectionId);
    if (!channels) return null;

    const identity = channels.identity;
    if (!isPlayerIdentity(identity)) return null;

    const cursorChannel = channels.cursor;
    if (!isCursorChannelValue(cursorChannel)) return null;
    if (!isCursor(cursorChannel.cursor)) return null;

    return {
      cursor: cursorChannel.cursor,
      playerIdentity: identity,
      lastSeen: cursorChannel.at,
      message: getNullableString(channels.message),
      page: cursorChannel.page ?? getOptionalString(channels.page),
      zone: cursorChannel.zone ?? null,
    };
  }
}

function isPlayerIdentity(value: unknown): value is PlayerIdentity {
  if (!isRecord(value)) return false;
  if (typeof value.publicKey !== "string" || value.publicKey.length === 0) {
    return false;
  }
  const style = value.playerStyle;
  return (
    isRecord(style) &&
    Array.isArray(style.colorPalette) &&
    typeof style.colorPalette[0] === "string" &&
    style.colorPalette[0].length > 0
  );
}

function isCursorChannelValue(value: unknown): value is CursorChannelValue {
  return isRecord(value) && "cursor" in value;
}

function isCursor(value: unknown): value is Cursor {
  return (
    isRecord(value) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    typeof value.pointer === "string" &&
    value.pointer.length > 0
  );
}

function getNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : null;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
