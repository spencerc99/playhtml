// ABOUTME: Tests the pure proximity/targeting logic for interaction emotes.
// ABOUTME: Reuses the site's dx/dy/sqrt radius primitive; no DOM.
import { describe, it, expect } from "vitest";
import {
  nearestPeer,
  detectMutualHighFive,
  DEFAULT_TARGET_RADIUS_PX,
  HIGHFIVE_WINDOW_MS,
} from "../features/emotes/interactions";

const me = { x: 100, y: 100 };

describe("nearestPeer", () => {
  it("returns the closest peer within radius", () => {
    const peers = new Map([
      ["a", { x: 130, y: 100 }], // 30px
      ["b", { x: 100, y: 180 }], // 80px
    ]);
    expect(nearestPeer(me, peers, DEFAULT_TARGET_RADIUS_PX)).toBe("a");
  });

  it("ignores peers outside the radius", () => {
    const peers = new Map([["far", { x: 1000, y: 1000 }]]);
    expect(nearestPeer(me, peers, DEFAULT_TARGET_RADIUS_PX)).toBeNull();
  });

  it("skips peers with null cursor and empty maps", () => {
    expect(nearestPeer(me, new Map([["x", null]]), 400)).toBeNull();
    expect(nearestPeer(me, new Map(), 400)).toBeNull();
  });

  it("has no self-awareness — the caller MUST exclude their own entry", () => {
    // nearestPeer measures distance from `me` to every entry, so if the caller's
    // own position is in the map it is the nearest (distance 0) and gets picked.
    // fire() in index.ts filters out the caller's pid for exactly this reason;
    // this test documents why that filter is load-bearing.
    const peersIncludingMe = new Map([
      ["me", { x: 100, y: 100 }], // same as `me` → distance 0
      ["other", { x: 130, y: 100 }],
    ]);
    expect(nearestPeer(me, peersIncludingMe, DEFAULT_TARGET_RADIUS_PX)).toBe("me");
  });
});

describe("detectMutualHighFive", () => {
  it("true when peer high-fived within the window", () => {
    expect(detectMutualHighFive(1000, 1500, HIGHFIVE_WINDOW_MS)).toBe(true);
  });
  it("false when outside the window or peer absent", () => {
    expect(detectMutualHighFive(1000, 3000, HIGHFIVE_WINDOW_MS)).toBe(false);
    expect(detectMutualHighFive(1000, undefined, HIGHFIVE_WINDOW_MS)).toBe(false);
  });
});
