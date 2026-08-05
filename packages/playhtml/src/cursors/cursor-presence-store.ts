// ABOUTME: Cursor view over the shared PeerStore: decodes folded channels into
// ABOUTME: cursor presence and collapses multiple tabs of one player.

import type {
  Cursor,
  CursorPresence,
  CursorZonePosition,
  PlayerIdentity,
} from "@playhtml/common";
import type { PeerChannels, PeerStore } from "../peer-store";
import {
  getNullableString,
  getOptionalString,
  isCursor,
  isPlayerIdentity,
  isPresenceCursorChannelValue,
} from "../presence-utils";

export type StoredCursorPresence = CursorPresence & {
  cursor: Cursor | null;
  playerIdentity: PlayerIdentity;
};

/**
 * Reads the shared PeerStore's folded peer map and shapes it into cursor
 * presence. Owns cursor-specific concerns only: decoding the identity/cursor/
 * message channels and collapsing multiple tabs of one player (preferring an
 * active cursor, then the newest frame). Stale-cursor expiry is no longer this
 * view's job — PeerStore drops any peer channel whose stamped `at` ages out
 * (shared with element/presence); a swept `cursor` channel simply disappears
 * from the folded map, leaving the identity-only peer, exactly as before.
 */
export class CursorPresenceStore {
  constructor(private peerStore: PeerStore) {}

  private get peers(): Map<string, PeerChannels> {
    return this.peerStore.getPeers();
  }

  getRemotePresences(localPublicKey: string): Map<string, StoredCursorPresence> {
    const presences = new Map<string, StoredCursorPresence>();
    const connectionIds = Array.from(this.peers.keys()).sort();

    for (const connectionId of connectionIds) {
      const presence = this.getPresenceForConnection(connectionId);
      if (!presence) continue;
      if (presence.playerIdentity.publicKey === localPublicKey) continue;
      const publicKey = presence.playerIdentity.publicKey;
      const existing = presences.get(publicKey);
      if (!existing || shouldReplacePresence(existing, presence)) {
        presences.set(publicKey, presence);
      }
    }

    return presences;
  }

  getPresenceByStableId(stableId: string): StoredCursorPresence | null {
    let bestPresence: StoredCursorPresence | null = null;
    for (const connectionId of Array.from(this.peers.keys()).sort()) {
      const presence = this.getPresenceForConnection(connectionId);
      if (presence?.playerIdentity.publicKey !== stableId) continue;
      if (!bestPresence || shouldReplacePresence(bestPresence, presence)) {
        bestPresence = presence;
      }
    }
    return bestPresence;
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

// Multi-tab winner selection: when one player has several open tabs (same
// publicKey, different connections), the cursor view keeps the tab with an
// active cursor, tie-broken by recency (newest `at`). This differs on purpose
// from the presence and element-awareness views, which collapse by iterating
// connection ids in sorted order and taking the last publicKey match — recency
// is meaningless for their non-cursor state, whereas a cursor should follow the
// tab you're actually moving in.
function shouldReplacePresence(
  current: StoredCursorPresence,
  candidate: StoredCursorPresence,
): boolean {
  if (candidate.cursor && !current.cursor) return true;
  if (!candidate.cursor && current.cursor) return false;

  const currentLastSeen = getFiniteNumber(current.lastSeen);
  const candidateLastSeen = getFiniteNumber(candidate.lastSeen);
  return candidateLastSeen > currentLastSeen;
}

function getFiniteNumber(value: unknown): number {
  return Number.isFinite(value) ? Number(value) : Number.NEGATIVE_INFINITY;
}
