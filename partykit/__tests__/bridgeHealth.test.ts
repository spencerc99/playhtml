// ABOUTME: Tests the per-(peer,direction) bridge circuit breaker that stops
// ABOUTME: storming a misconfigured bridge link after repeated rejected applies.
import { describe, expect, it } from "bun:test";
import {
  BRIDGE_CIRCUIT_OPEN_THRESHOLD,
  BridgeHealth,
} from "../bridgeHealth";

function tripLink(
  health: BridgeHealth,
  peer: string,
  direction: "source" | "consumer"
): void {
  for (let i = 0; i < BRIDGE_CIRCUIT_OPEN_THRESHOLD; i++) {
    health.recordResult(peer, direction, false);
  }
}

describe("BridgeHealth circuit breaker", () => {
  it("allows sends to a healthy peer", () => {
    const health = new BridgeHealth();
    expect(health.shouldSend("consumer-a", "source")).toBe(true);
  });

  it("opens the circuit after the threshold of consecutive rejects", () => {
    const health = new BridgeHealth();
    for (let i = 0; i < BRIDGE_CIRCUIT_OPEN_THRESHOLD; i++) {
      expect(health.shouldSend("c", "source")).toBe(true);
      health.recordResult("c", "source", false);
    }
    expect(health.shouldSend("c", "source")).toBe(false);
  });

  it("returns justOpened exactly on the threshold-crossing result", () => {
    const health = new BridgeHealth();
    for (let i = 0; i < BRIDGE_CIRCUIT_OPEN_THRESHOLD - 1; i++) {
      expect(health.recordResult("c", "source", false)).toBe(false);
    }
    // The crossing result reports the open edge once.
    expect(health.recordResult("c", "source", false)).toBe(true);
    // Already-open further rejects do not re-report.
    expect(health.recordResult("c", "source", false)).toBe(false);
  });

  it("keeps healthy peers unaffected when another peer trips", () => {
    const health = new BridgeHealth();
    tripLink(health, "bad", "source");
    expect(health.shouldSend("bad", "source")).toBe(false);
    expect(health.shouldSend("good", "source")).toBe(true);
  });

  it("tracks each direction to the same peer independently", () => {
    const health = new BridgeHealth();
    tripLink(health, "p", "source");
    expect(health.shouldSend("p", "source")).toBe(false);
    // The consumer direction to the same peer is untouched.
    expect(health.shouldSend("p", "consumer")).toBe(true);
  });

  it("does not let a success in one direction clear the other direction's streak", () => {
    const health = new BridgeHealth();
    // Accumulate rejects on the consumer direction.
    for (let i = 0; i < BRIDGE_CIRCUIT_OPEN_THRESHOLD - 1; i++) {
      health.recordResult("p", "consumer", false);
    }
    // A success on the source direction must not reset the consumer streak.
    health.recordResult("p", "source", true);
    expect(health.recordResult("p", "consumer", false)).toBe(true); // crosses now
    expect(health.shouldSend("p", "consumer")).toBe(false);
  });

  it("resets the counter on a successful apply", () => {
    const health = new BridgeHealth();
    for (let i = 0; i < BRIDGE_CIRCUIT_OPEN_THRESHOLD - 1; i++) {
      health.recordResult("c", "source", false);
    }
    health.recordResult("c", "source", true);
    expect(health.shouldSend("c", "source")).toBe(true);
    for (let i = 0; i < BRIDGE_CIRCUIT_OPEN_THRESHOLD - 1; i++) {
      health.recordResult("c", "source", false);
    }
    expect(health.shouldSend("c", "source")).toBe(true);
  });

  it("reopens both directions of a tripped peer on reset() (resubscribe)", () => {
    const health = new BridgeHealth();
    tripLink(health, "c", "source");
    tripLink(health, "c", "consumer");
    expect(health.shouldSend("c", "source")).toBe(false);
    expect(health.shouldSend("c", "consumer")).toBe(false);
    health.reset("c");
    expect(health.shouldSend("c", "source")).toBe(true);
    expect(health.shouldSend("c", "consumer")).toBe(true);
  });

  it("treats absence (never-seen peer) as healthy", () => {
    const health = new BridgeHealth();
    expect(health.shouldSend("never-seen", "source")).toBe(true);
  });
});
