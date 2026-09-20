// ABOUTME: Verifies proximity transitions through the production transport cursor client.
// ABOUTME: Covers precise distances, enter/leave state, thresholds, and missing positions.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerIdentity } from "@playhtml/common";
import { calculateDistance } from "../cursors/cursor-client";
import { createTransportCursorClient } from "./presence-test-utils";

function identity(publicKey: string): PlayerIdentity {
  return { publicKey, playerStyle: { colorPalette: ["#ff0000"] } };
}

function cursorPeer(publicKey: string, x: number, y: number) {
  return {
    identity: identity(publicKey),
    cursor: { cursor: { x, y, pointer: "mouse" }, page: "/", at: Date.now() },
  };
}

function move(x: number, y: number) {
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y }));
}

describe("proximity detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => document.body,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("calculates Euclidean distance", () => {
    expect(calculateDistance(
      { x: 0, y: 0, pointer: "mouse" },
      { x: 3, y: 4, pointer: "mouse" },
    )).toBe(5);
  });

  it("emits enter once and leave when a transport peer moves away", () => {
    const entered = vi.fn();
    const left = vi.fn();
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: identity("self"),
      onProximityEntered: entered,
      onProximityLeft: left,
    });
    move(100, 100);
    transport.emit({ type: "presence-sync", peers: { tab: cursorPeer("remote", 120, 120) } });
    transport.emit({
      type: "presence-changes",
      updates: { tab: { cursor: cursorPeer("remote", 300, 300).cursor } },
      removes: {},
    });
    expect(entered).toHaveBeenCalledTimes(1);
    expect(entered).toHaveBeenCalledWith(expect.objectContaining({ publicKey: "remote" }));
    expect(left).toHaveBeenCalledWith("remote");
    client.destroy();
  });

  it("honors a custom threshold and ignores identity-only peers", () => {
    const entered = vi.fn();
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: identity("self"),
      proximityThreshold: 30,
      onProximityEntered: entered,
    });
    move(100, 100);
    transport.emit({
      type: "presence-sync",
      peers: {
        nearButOutside: cursorPeer("outside", 130, 130),
        identityOnly: { identity: identity("identity-only") },
        near: cursorPeer("near", 110, 110),
      },
    });
    expect(entered).toHaveBeenCalledTimes(1);
    expect(entered).toHaveBeenCalledWith(expect.objectContaining({ publicKey: "near" }));
    client.destroy();
  });
});
