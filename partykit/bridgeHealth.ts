// ABOUTME: Per-peer circuit breaker for shared-element bridge fan-out.
// ABOUTME: Stops re-sending to a peer that keeps rejecting applies (e.g. a
// ABOUTME: misconfigured source stuck on a stale reset epoch) until it recovers.

// A misconfigured bridge pair (most commonly a source stuck on a stale reset
// epoch) gets every apply rejected. Without a breaker the sender re-fans-out on
// every document update, producing a retry storm against every peer. After this
// many consecutive rejected applies to the same peer, the sender stops sending
// to that peer until the streak is reset.
export const BRIDGE_CIRCUIT_OPEN_THRESHOLD = 5;

// Tracks consecutive rejected applies per peer room. In-memory only: a Durable
// Object reload (which produces a fresh, correct reset epoch) naturally drops
// this state and re-enables every bridge. reset() additionally reopens a peer
// early when it resubscribes (a new page load on the consumer side).
export class BridgeHealth {
  private consecutiveRejectsByPeer = new Map<string, number>();

  // Whether the sender should attempt a send to this peer right now.
  shouldSend(peerRoomId: string): boolean {
    const rejects = this.consecutiveRejectsByPeer.get(peerRoomId) ?? 0;
    return rejects < BRIDGE_CIRCUIT_OPEN_THRESHOLD;
  }

  // Record the outcome of an apply to this peer. `applied === true` clears the
  // reject streak; a rejected apply increments it toward the circuit threshold.
  recordResult(peerRoomId: string, applied: boolean): void {
    if (applied) {
      this.consecutiveRejectsByPeer.delete(peerRoomId);
      return;
    }
    const rejects = this.consecutiveRejectsByPeer.get(peerRoomId) ?? 0;
    this.consecutiveRejectsByPeer.set(peerRoomId, rejects + 1);
  }

  // Reopen a peer's circuit. Called when a consumer resubscribes (a fresh page
  // load), so a genuine new client always gets a clean attempt even if the pair
  // had previously tripped.
  reset(peerRoomId: string): void {
    this.consecutiveRejectsByPeer.delete(peerRoomId);
  }
}
