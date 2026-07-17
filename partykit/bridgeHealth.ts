// ABOUTME: Per-peer circuit breaker for shared-element bridge fan-out.
// ABOUTME: Stops re-sending to a peer that keeps rejecting applies (e.g. a
// ABOUTME: misconfigured source stuck on a stale reset epoch) until it recovers.

// A misconfigured bridge pair (most commonly a source stuck on a stale reset
// epoch) gets every apply rejected. Without a breaker the sender re-fans-out on
// every document update, producing a retry storm against every peer. After this
// many consecutive rejected applies to the same (peer, direction), the sender
// pauses sends on that link until a cooldown probe can confirm recovery.
export const BRIDGE_CIRCUIT_OPEN_THRESHOLD = 5;
export const BRIDGE_CIRCUIT_COOLDOWN_MS = 10_000;

// A room can be both a source and a consumer to the same peer (bidirectional
// share), so health is tracked per direction as well as per peer — otherwise a
// success in one direction would clear the other direction's reject streak.
export type BridgeDirection = "source" | "consumer";

type CircuitState = {
  consecutiveRejects: number;
  openedAt: number | null;
  probeInFlight: boolean;
};

function linkKey(peerRoomId: string, direction: BridgeDirection): string {
  return `${direction} ${peerRoomId}`;
}

// Tracks consecutive rejected applies per (peer room, direction). In-memory
// only: a Durable Object reload (which produces a fresh, correct reset epoch)
// naturally drops this state and re-enables every bridge. reset() additionally
// reopens a peer early when it resubscribes (a new page load on the consumer
// side).
export class BridgeHealth {
  private circuitsByLink = new Map<string, CircuitState>();

  constructor(private readonly now: () => number = Date.now) {}

  // Whether the sender should attempt a send on this link right now.
  shouldSend(peerRoomId: string, direction: BridgeDirection): boolean {
    const key = linkKey(peerRoomId, direction);
    const circuit = this.circuitsByLink.get(key);
    if (!circuit || circuit.openedAt === null) return true;
    if (this.now() - circuit.openedAt < BRIDGE_CIRCUIT_COOLDOWN_MS) {
      return false;
    }
    if (circuit.probeInFlight) return false;
    circuit.probeInFlight = true;
    return true;
  }

  // Record the outcome of an apply on this link. `applied === true` clears the
  // reject streak; a rejected apply increments it toward the circuit threshold.
  // Returns true only on the result that crosses the threshold (the open edge),
  // so the caller can log the trip exactly once.
  recordResult(
    peerRoomId: string,
    direction: BridgeDirection,
    applied: boolean
  ): boolean {
    const key = linkKey(peerRoomId, direction);
    if (applied) {
      this.circuitsByLink.delete(key);
      return false;
    }
    const circuit = this.circuitsByLink.get(key) ?? {
      consecutiveRejects: 0,
      openedAt: null,
      probeInFlight: false,
    };
    const before = circuit.consecutiveRejects;
    circuit.consecutiveRejects += 1;
    circuit.probeInFlight = false;
    if (circuit.consecutiveRejects >= BRIDGE_CIRCUIT_OPEN_THRESHOLD) {
      circuit.openedAt = this.now();
    }
    this.circuitsByLink.set(key, circuit);
    return (
      before < BRIDGE_CIRCUIT_OPEN_THRESHOLD &&
      circuit.consecutiveRejects >= BRIDGE_CIRCUIT_OPEN_THRESHOLD
    );
  }

  // Reopen a peer's circuit in both directions. Called when a consumer
  // resubscribes (a fresh page load), so a genuine new client always gets a
  // clean attempt even if the link had previously tripped.
  reset(peerRoomId: string): void {
    this.circuitsByLink.delete(linkKey(peerRoomId, "source"));
    this.circuitsByLink.delete(linkKey(peerRoomId, "consumer"));
  }
}
