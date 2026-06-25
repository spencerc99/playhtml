// ABOUTME: Tests the per-peer bridge circuit breaker that stops storming a
// ABOUTME: misconfigured bridge pair after repeated rejected applies.
import { describe, expect, it } from "bun:test";
import {
  BRIDGE_CIRCUIT_OPEN_THRESHOLD,
  BridgeHealth,
} from "../bridgeHealth";

describe("BridgeHealth circuit breaker", () => {
  it("allows sends to a healthy peer", () => {
    const health = new BridgeHealth();
    expect(health.shouldSend("consumer-a")).toBe(true);
  });

  it("opens the circuit after the threshold of consecutive rejects", () => {
    const health = new BridgeHealth();
    for (let i = 0; i < BRIDGE_CIRCUIT_OPEN_THRESHOLD; i++) {
      expect(health.shouldSend("c")).toBe(true);
      health.recordResult("c", false);
    }
    // Threshold reached: the next check is blocked.
    expect(health.shouldSend("c")).toBe(false);
  });

  it("keeps healthy peers unaffected when another peer trips", () => {
    const health = new BridgeHealth();
    for (let i = 0; i < BRIDGE_CIRCUIT_OPEN_THRESHOLD; i++) {
      health.recordResult("bad", false);
    }
    expect(health.shouldSend("bad")).toBe(false);
    expect(health.shouldSend("good")).toBe(true);
  });

  it("resets the counter on a successful apply", () => {
    const health = new BridgeHealth();
    for (let i = 0; i < BRIDGE_CIRCUIT_OPEN_THRESHOLD - 1; i++) {
      health.recordResult("c", false);
    }
    health.recordResult("c", true); // accept resets the streak
    expect(health.shouldSend("c")).toBe(true);
    // Must take a full fresh streak to trip again.
    for (let i = 0; i < BRIDGE_CIRCUIT_OPEN_THRESHOLD - 1; i++) {
      health.recordResult("c", false);
    }
    expect(health.shouldSend("c")).toBe(true);
  });

  it("reopens a tripped peer when reset() is called (resubscribe / new load)", () => {
    const health = new BridgeHealth();
    for (let i = 0; i < BRIDGE_CIRCUIT_OPEN_THRESHOLD; i++) {
      health.recordResult("c", false);
    }
    expect(health.shouldSend("c")).toBe(false);
    health.reset("c");
    expect(health.shouldSend("c")).toBe(true);
  });

  it("treats absence (never-seen peer) as healthy", () => {
    const health = new BridgeHealth();
    expect(health.shouldSend("never-seen")).toBe(true);
  });
});
