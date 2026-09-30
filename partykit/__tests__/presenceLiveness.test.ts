// ABOUTME: Verifies the presence liveness policy used by the room's sweep.
// ABOUTME: Covers which peers are vouched for, which stamps refresh, and dead sockets.
import { describe, expect, it } from "bun:test";
import { PRESENCE_STALE_MS } from "@playhtml/common";
import {
  PRESENCE_ACTIVITY_WINDOW_MS,
  PRESENCE_DEAD_SOCKET_MS,
  PRESENCE_RESTAMP_AGE_MS,
  PRESENCE_SWEEP_INTERVAL_MS,
  getRestampedChannels,
  isDeadPresenceSocket,
  isVouchedPresencePeer,
  shouldSweepPresenceRoom,
} from "../presenceLiveness";

const NOW = 1_000_000;

describe("presence liveness", () => {
  it("vouches for a peer whose pings are recent", () => {
    expect(
      isVouchedPresencePeer(
        { pingedAt: NOW - 9_000, lastMessageAt: null, openedAt: NOW - 60_000 },
        NOW
      )
    ).toBe(true);
  });

  it("stops vouching once pings stop for the activity window", () => {
    expect(
      isVouchedPresencePeer(
        {
          pingedAt: NOW - PRESENCE_ACTIVITY_WINDOW_MS - 1,
          lastMessageAt: null,
          openedAt: NOW - 60_000,
        },
        NOW
      )
    ).toBe(false);
  });

  it("counts a recent message as activity for a pinging peer", () => {
    expect(
      isVouchedPresencePeer(
        { pingedAt: NOW - 60_000, lastMessageAt: NOW - 1_000, openedAt: null },
        NOW
      )
    ).toBe(true);
  });

  it("never vouches for a peer that does not ping", () => {
    expect(
      isVouchedPresencePeer(
        { pingedAt: null, lastMessageAt: NOW, openedAt: NOW },
        NOW
      )
    ).toBe(false);
  });

  it("treats only long-silent pinging sockets as dead", () => {
    const silent = {
      pingedAt: NOW - PRESENCE_DEAD_SOCKET_MS - 1,
      lastMessageAt: null,
      openedAt: NOW - PRESENCE_DEAD_SOCKET_MS * 2,
    };
    expect(isDeadPresenceSocket(silent, NOW)).toBe(true);
    // A background tab pinging once a minute stays connected.
    expect(
      isDeadPresenceSocket({ ...silent, pingedAt: NOW - 61_000 }, NOW)
    ).toBe(false);
    // Older clients never ping and are never closed by the sweep.
    expect(
      isDeadPresenceSocket(
        { pingedAt: null, lastMessageAt: null, openedAt: 0 },
        NOW
      )
    ).toBe(false);
  });

  it("refreshes old element and page presence stamps but not cursors", () => {
    const old = NOW - PRESENCE_RESTAMP_AGE_MS;
    expect(
      getRestampedChannels(
        {
          "presence:status": { at: old, value: "here" },
          "element:shard:0": { at: old, entries: [1] },
          "presence:fresh": { at: NOW - 1, value: "typing" },
          cursor: { cursor: { x: 1, y: 1 }, at: old },
          identity: { publicKey: "pk" },
          "presence:unstamped": "value",
        },
        NOW
      )
    ).toEqual({
      "presence:status": { at: NOW, value: "here" },
      "element:shard:0": { at: NOW, entries: [1] },
    });
  });

  it("keeps the worst refreshed stamp age inside the client stale window", () => {
    expect(PRESENCE_RESTAMP_AGE_MS + PRESENCE_SWEEP_INTERVAL_MS).toBeLessThan(
      PRESENCE_STALE_MS
    );
  });

  it("sweeps only rooms where someone can see someone else", () => {
    expect(shouldSweepPresenceRoom(1)).toBe(false);
    expect(shouldSweepPresenceRoom(2)).toBe(true);
  });
});
