// ABOUTME: One per-socket peer-folding layer shared by all transport consumers.
// ABOUTME: Folds presence-sync/changes into peer channels, notifies per namespace.

import type {
  PresenceChangesMessage,
  PresenceServerMessage,
  PresenceSnapshot,
} from "@playhtml/common";
import {
  IDENTITY_CHANNEL,
  isElementChannel,
  isLiveChannel,
  isPagePresenceChannel,
  PRESENCE_STALE_MS,
  safeInvoke,
} from "./presence-utils";

// Cadence of the periodic staleness sweep for peers that go silent (no message
// arrives to trigger a fold). Matches the cursor view's previous 1s expiry
// interval so observable expiry timing is unchanged.
const PEER_SWEEP_INTERVAL_MS = 1_000;

/** Coarse channel groupings that consumers subscribe to. A consumer for one
 * namespace is only notified when a message actually touched that namespace, so
 * frame-rate cursor traffic never wakes element/presence subscribers. */
export type PeerNamespace = "cursor" | "element" | "presence" | "identity";

export type PeerChannels = Record<string, unknown>;

/** Minimal message source the store subscribes to (the presence transport). */
type PeerMessageSource = {
  subscribe(listener: (message: PresenceServerMessage) => void): () => void;
};

type NamespaceListener = () => void;

/** Maps a raw channel name to the namespace it belongs to. `message` and `page`
 * are cursor-view fields; `identity` is its own namespace so any view can re-key
 * on an identity change. */
function namespaceOf(channel: string): PeerNamespace {
  if (channel === IDENTITY_CHANNEL) return "identity";
  if (isElementChannel(channel)) return "element";
  if (isPagePresenceChannel(channel)) return "presence";
  // cursor, message, page, and anything else fold into the cursor view.
  return "cursor";
}

/**
 * The single consumer of presence-sync / presence-changes on a socket. Folds
 * every channel into per-connection records, then dispatches only to the
 * namespaces a message touched. Views (cursor / element / presence) read the
 * folded peer map and shape their own output; they never parse raw messages.
 *
 * Subscribing replays the current snapshot immediately so late subscribers see
 * existing peer state instead of waiting for the next change.
 */
export class PeerStore {
  private peers = new Map<string, PeerChannels>();
  private listeners: Record<PeerNamespace, Set<NamespaceListener>> = {
    cursor: new Set(),
    element: new Set(),
    presence: new Set(),
    identity: new Set(),
  };
  private unsubscribe: () => void;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(source: PeerMessageSource) {
    this.unsubscribe = source.subscribe((message) => this.handleMessage(message));
    // Client-side staleness backstop: drop a peer's stamped channels once their
    // `at` ages out, even if the server never sent a remove (killed tab, dropped
    // network). One sweep timer per socket — the only place this runs. Peers
    // going silent are caught here; a peer whose first-seen value is already
    // stale is caught synchronously on fold (see handleMessage).
    this.sweepTimer = setInterval(() => {
      this.sweepExpired(Date.now());
    }, PEER_SWEEP_INTERVAL_MS);
  }

  /** The live folded peer map, keyed by connection id. Views read this. */
  getPeers(): Map<string, PeerChannels> {
    return this.peers;
  }

  /**
   * Subscribe to a namespace. The callback fires whenever a message touched that
   * namespace, and once immediately with the current snapshot (replay). Returns
   * an unsubscribe function.
   */
  subscribe(namespace: PeerNamespace, listener: NamespaceListener): () => void {
    this.listeners[namespace].add(listener);
    // Isolate the immediate snapshot replay too, so a consumer that throws on
    // its first render doesn't propagate into the subscribing caller (which,
    // during a synchronous client constructor, would leak the transport ref).
    safeInvoke(listener, "peer store namespace");
    return () => {
      this.listeners[namespace].delete(listener);
    };
  }

  destroy(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.unsubscribe();
    for (const set of Object.values(this.listeners)) set.clear();
  }

  private handleMessage(message: PresenceServerMessage): void {
    if (message.type === "presence-sync") {
      this.applySync(message.peers);
      // Drop any already-stale channels the snapshot carried (e.g. a peer whose
      // last frame is older than the window) before notifying, so views never
      // momentarily render a stale peer between sweep ticks.
      this.pruneExpired(Date.now());
      // A full snapshot may touch any namespace; notify all.
      this.notify(new Set<PeerNamespace>(["cursor", "element", "presence", "identity"]));
      return;
    }
    if (message.type === "presence-changes") {
      const touched = this.applyChanges(message);
      this.pruneExpired(Date.now(), touched);
      if (touched.size > 0) this.notify(touched);
    }
    // presence-rate / presence-error are handled by the cursor client directly
    // on the transport; the store folds only sync/changes.
  }

  private applySync(snapshot: PresenceSnapshot): void {
    this.peers.clear();
    for (const [connectionId, channels] of Object.entries(snapshot)) {
      this.peers.set(connectionId, { ...channels });
    }
  }

  private applyChanges(message: PresenceChangesMessage): Set<PeerNamespace> {
    const touched = new Set<PeerNamespace>();

    for (const [connectionId, channels] of Object.entries(message.updates)) {
      const peer = this.peers.get(connectionId) ?? {};
      this.peers.set(connectionId, peer);
      for (const [channel, value] of Object.entries(channels)) {
        peer[channel] = value;
        touched.add(namespaceOf(channel));
      }
    }

    for (const [connectionId, channels] of Object.entries(message.removes)) {
      const peer = this.peers.get(connectionId);
      if (!peer) continue;
      for (const channel of channels) {
        if (!(channel in peer)) continue;
        delete peer[channel];
        touched.add(namespaceOf(channel));
      }
      if (Object.keys(peer).length === 0) {
        this.peers.delete(connectionId);
      }
    }

    return touched;
  }

  private notify(namespaces: Set<PeerNamespace>): void {
    // A listener subscribed to several touched namespaces (e.g. the cursor view
    // watches both "cursor" and "identity") must fire at most once per message,
    // so a combined sync/join does not double-render.
    const fired = new Set<NamespaceListener>();
    for (const namespace of namespaces) {
      for (const listener of this.listeners[namespace]) {
        if (fired.has(listener)) continue;
        fired.add(listener);
        // Isolate a throwing consumer so it can't skip the rest of the fan-out
        // (which, on a shared socket, would couple independent consumers).
        safeInvoke(listener, "peer store namespace");
      }
    }
  }

  /** Periodic sweep for peers that went silent: prune expired channels and
   * notify only the namespaces that actually lost one (no-op when nothing
   * expired, so a quiet room never re-fires callbacks). */
  private sweepExpired(now: number): void {
    const touched = new Set<PeerNamespace>();
    this.pruneExpired(now, touched);
    if (touched.size > 0) this.notify(touched);
  }

  /**
   * Delete every peer channel whose stamped `at` has aged past the staleness
   * window, recording the touched namespaces into `touched`. Never removes a
   * peer wholesale for having only unstamped channels (identity persists) —
   * only prunes a now-empty peer row. Unstamped channels (identity) are always
   * live, so they are never swept. This is the single implementation of
   * client-side staleness for cursor, element, and presence views.
   */
  private pruneExpired(
    now: number,
    touched: Set<PeerNamespace> = new Set(),
  ): Set<PeerNamespace> {
    for (const [connectionId, channels] of this.peers) {
      for (const [channel, value] of Object.entries(channels)) {
        if (isLiveChannel(value, now, PRESENCE_STALE_MS)) continue;
        delete channels[channel];
        touched.add(namespaceOf(channel));
      }
      if (Object.keys(channels).length === 0) {
        this.peers.delete(connectionId);
      }
    }
    return touched;
  }
}
