// ABOUTME: Maintains generic realtime presence room state and batched deltas.
// ABOUTME: Coalesces volatile channel updates before the Worker broadcasts them.

import type {
  PresenceClientMessage,
  PresenceChannelCadence,
  PresenceChangesMessage,
  PresenceSnapshot,
  PresenceSyncMessage,
} from "@playhtml/common";
import { getPresenceChannelCadence } from "@playhtml/common";

const PRESENCE_RATE_WINDOW_MS = 1000;
const MAX_PRESENCE_CHANNELS_PER_CONNECTION = 32;
const PRESENCE_MESSAGE_BUDGET_HZ: Record<PresenceMessageBudgetBucket, number> = {
  frame: 90,
  interactive: 45,
  event: 20,
  control: 10,
};

type PresenceMessageBudgetBucket = PresenceChannelCadence | "control";

type PresenceMessageBudgetWindow = {
  startedAt: number;
  count: number;
};

export type PresenceMessageBudgetState = Map<
  string,
  Map<PresenceMessageBudgetBucket, PresenceMessageBudgetWindow>
>;

export type PresenceMessageBudgetDecision =
  | { accepted: true }
  | {
      accepted: false;
      channel: string;
      hz: number;
    };

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

export function createPresenceMessageBudgetState(): PresenceMessageBudgetState {
  return new Map();
}

export function consumePresenceMessageBudget(
  state: PresenceMessageBudgetState,
  connectionId: string,
  message: PresenceClientMessage,
  now: number,
): PresenceMessageBudgetDecision {
  const target = getPresenceMessageBudgetTarget(message);
  const hz = PRESENCE_MESSAGE_BUDGET_HZ[target.bucket];
  const connectionBudgets = getOrCreate(state, connectionId, () => new Map());

  let window = connectionBudgets.get(target.bucket);
  if (!window || now - window.startedAt >= PRESENCE_RATE_WINDOW_MS) {
    window = { startedAt: now, count: 0 };
    connectionBudgets.set(target.bucket, window);
  }

  if (window.count >= hz) {
    return {
      accepted: false,
      channel: target.channel,
      hz,
    };
  }

  window.count++;
  return { accepted: true };
}

export function clearPresenceMessageBudget(
  state: PresenceMessageBudgetState,
  connectionId: string,
): void {
  state.delete(connectionId);
}

export function recordPresenceUpdate(
  state: PresenceRoomState,
  connectionId: string,
  channel: string,
  value: unknown,
): void {
  const peer = getOrCreate(state.peers, connectionId, () => new Map());
  assertPresenceChannelCapacity(peer, channel);
  peer.set(channel, value);

  const updates = getOrCreate(
    state.dirtyUpdates,
    connectionId,
    () => new Map(),
  );
  updates.set(channel, value);

  deleteChannelAndPrune(state.dirtyRemoves, connectionId, channel);
}

export function restorePresenceConnectionChannels(
  state: PresenceRoomState,
  connectionId: string,
  channels: Record<string, unknown>,
): void {
  const peer = getOrCreate(state.peers, connectionId, () => new Map());

  peer.clear();
  for (const [channel, value] of Object.entries(channels)) {
    assertPresenceChannelCapacity(peer, channel);
    peer.set(channel, value);
  }
  if (peer.size === 0) {
    state.peers.delete(connectionId);
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

  deleteChannelAndPrune(state.dirtyUpdates, connectionId, channel);

  const removes = getOrCreate(
    state.dirtyRemoves,
    connectionId,
    () => new Set(),
  );
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

  const removes = getOrCreate(
    state.dirtyRemoves,
    connectionId,
    () => new Set(),
  );
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

function getPresenceMessageBudgetTarget(
  message: PresenceClientMessage,
): { bucket: PresenceMessageBudgetBucket; channel: string } {
  if (message.type === "presence-update" || message.type === "presence-clear") {
    return {
      bucket: getPresenceChannelCadence(message.channel),
      channel: message.channel,
    };
  }
  return { bucket: "control", channel: "control" };
}

function getOrCreate<K, V>(
  map: Map<K, V>,
  key: K,
  createValue: () => V,
): V {
  let value = map.get(key);
  if (value === undefined) {
    value = createValue();
    map.set(key, value);
  }
  return value;
}

function deleteChannelAndPrune<
  T extends { delete(key: string): boolean; size: number },
>(
  map: Map<string, T>,
  connectionId: string,
  channel: string,
): void {
  const channels = map.get(connectionId);
  if (!channels) return;
  channels.delete(channel);
  if (channels.size === 0) map.delete(connectionId);
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

function assertPresenceChannelCapacity(
  peer: Map<string, unknown>,
  channel: string,
): void {
  if (peer.has(channel)) return;
  if (peer.size < MAX_PRESENCE_CHANNELS_PER_CONNECTION) return;
  throw new Error("Presence channel limit exceeded");
}
