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
import {
  isCursor,
  isPlayerIdentity,
  isPresenceCursorChannelValue,
} from "../presence-utils";

type PeerChannels = Record<string, unknown>;

export type StoredCursorPresence = CursorPresence & {
  cursor: Cursor | null;
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
    let cursor: Cursor | null = null;
    let lastSeen: number | undefined;
    let page = getOptionalString(channels.page);
    let zone: CursorZonePosition | null = null;

    if (cursorChannel !== undefined) {
      if (!isPresenceCursorChannelValue(cursorChannel)) return null;
      if (cursorChannel.cursor !== null) {
        if (!isCursor(cursorChannel.cursor)) return null;
        cursor = cursorChannel.cursor;
      }
      lastSeen = cursorChannel.at;
      page = cursorChannel.page ?? page;
      zone = cursorChannel.zone ?? null;
    }

    return {
      cursor,
      playerIdentity: identity,
      lastSeen,
      message: getNullableString(channels.message),
      page,
      zone,
    };
  }
}

function getNullableString(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : null;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
