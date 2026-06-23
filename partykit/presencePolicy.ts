// ABOUTME: Maintains generic realtime presence room state and batched deltas.
// ABOUTME: Coalesces volatile channel updates before the Worker broadcasts them.

import type {
  PresenceClientMessage,
  PresenceChangesMessage,
  PresenceSnapshot,
  PresenceSyncMessage,
} from "@playhtml/common";

export type PresenceRoomState = {
  peers: Map<string, Map<string, unknown>>;
  dirtyUpdates: Map<string, Map<string, unknown>>;
  dirtyRemoves: Map<string, Set<string>>;
};

export function createPresenceRoomState(): PresenceRoomState {
  return {
    peers: new Map(),
    dirtyUpdates: new Map(),
    dirtyRemoves: new Map(),
  };
}

export function recordPresenceUpdate(
  state: PresenceRoomState,
  connectionId: string,
  channel: string,
  value: unknown,
): void {
  let peer = state.peers.get(connectionId);
  if (!peer) {
    peer = new Map();
    state.peers.set(connectionId, peer);
  }
  peer.set(channel, value);

  let updates = state.dirtyUpdates.get(connectionId);
  if (!updates) {
    updates = new Map();
    state.dirtyUpdates.set(connectionId, updates);
  }
  updates.set(channel, value);

  const removes = state.dirtyRemoves.get(connectionId);
  if (removes) {
    removes.delete(channel);
    if (removes.size === 0) state.dirtyRemoves.delete(connectionId);
  }
}

export function recordPresenceClear(
  state: PresenceRoomState,
  connectionId: string,
  channel: string,
): void {
  const peer = state.peers.get(connectionId);
  if (!peer?.has(channel)) return;

  peer.delete(channel);
  if (peer.size === 0) state.peers.delete(connectionId);

  const updates = state.dirtyUpdates.get(connectionId);
  if (updates) {
    updates.delete(channel);
    if (updates.size === 0) state.dirtyUpdates.delete(connectionId);
  }

  let removes = state.dirtyRemoves.get(connectionId);
  if (!removes) {
    removes = new Set();
    state.dirtyRemoves.set(connectionId, removes);
  }
  removes.add(channel);
}

export function recordPresenceRemoval(
  state: PresenceRoomState,
  connectionId: string,
): void {
  const peer = state.peers.get(connectionId);
  if (!peer) return;

  const channels = Array.from(peer.keys());
  state.peers.delete(connectionId);
  state.dirtyUpdates.delete(connectionId);

  let removes = state.dirtyRemoves.get(connectionId);
  if (!removes) {
    removes = new Set();
    state.dirtyRemoves.set(connectionId, removes);
  }
  for (const channel of channels) {
    removes.add(channel);
  }
}

export function getPresenceSyncSnapshot(
  state: PresenceRoomState,
): PresenceSnapshot {
  return snapshotFromPeers(state.peers);
}

export function createPresenceSyncMessage(
  state: PresenceRoomState,
): PresenceSyncMessage {
  return {
    type: "presence-sync",
    peers: getPresenceSyncSnapshot(state),
  };
}

export function applyPresenceClientMessage(
  state: PresenceRoomState,
  connectionId: string,
  message: PresenceClientMessage,
): void {
  switch (message.type) {
    case "presence-join":
      if (message.identity !== undefined) {
        recordPresenceUpdate(state, connectionId, "identity", message.identity);
      }
      if (message.page !== undefined) {
        recordPresenceUpdate(state, connectionId, "page", message.page);
      }
      return;
    case "presence-update":
      recordPresenceUpdate(state, connectionId, message.channel, message.value);
      return;
    case "presence-clear":
      recordPresenceClear(state, connectionId, message.channel);
      return;
    case "presence-ping":
      return;
  }
}

export function takePresenceChanges(
  state: PresenceRoomState,
): PresenceChangesMessage | null {
  if (state.dirtyUpdates.size === 0 && state.dirtyRemoves.size === 0) {
    return null;
  }

  const changes: PresenceChangesMessage = {
    type: "presence-changes",
    updates: snapshotFromPeers(state.dirtyUpdates),
    removes: removalsFromPeers(state.dirtyRemoves),
  };

  state.dirtyUpdates.clear();
  state.dirtyRemoves.clear();

  return changes;
}

function snapshotFromPeers(
  peers: Map<string, Map<string, unknown>>,
): PresenceSnapshot {
  const snapshot: PresenceSnapshot = {};
  for (const [connectionId, channels] of peers) {
    if (channels.size === 0) continue;
    snapshot[connectionId] = {};
    for (const [channel, value] of channels) {
      snapshot[connectionId][channel] = value;
    }
  }
  return snapshot;
}

function removalsFromPeers(
  peers: Map<string, Set<string>>,
): Record<string, string[]> {
  const removes: Record<string, string[]> = {};
  for (const [connectionId, channels] of peers) {
    if (channels.size === 0) continue;
    removes[connectionId] = Array.from(channels);
  }
  return removes;
}
