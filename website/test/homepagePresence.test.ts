// ABOUTME: Tests the homepage definition of recently present visitors.
// ABOUTME: Covers the background-tab grace period and stale awareness filtering.

import { describe, expect, test } from "bun:test";
import {
  getRecentHomepagePresences,
  HOMEPAGE_PRESENCE_TIMEOUT_MS,
} from "../utils/homepagePresence";

describe("getRecentHomepagePresences", () => {
  test("counts people throughout the ten-minute inactivity window", () => {
    const now = 1_000_000;
    const presences = getRecentHomepagePresences(
      [
        { color: "#111111", lastActiveAt: now, playerId: "player-1" },
        {
          color: "#222222",
          lastActiveAt: now - HOMEPAGE_PRESENCE_TIMEOUT_MS,
          playerId: "player-2",
        },
      ],
      now,
    );

    expect(presences.map((presence) => presence.color)).toEqual([
      "#111111",
      "#222222",
    ]);
  });

  test("drops people after ten minutes without activity", () => {
    const now = 1_000_000;
    const presences = getRecentHomepagePresences(
      [
        {
          color: "#111111",
          lastActiveAt: now - HOMEPAGE_PRESENCE_TIMEOUT_MS - 1,
          playerId: "player-1",
        },
      ],
      now,
    );

    expect(presences).toEqual([]);
  });

  test("counts one person across tabs using their most recent activity", () => {
    const now = 1_000_000;
    const presences = getRecentHomepagePresences(
      [
        {
          color: "#111111",
          lastActiveAt: now - HOMEPAGE_PRESENCE_TIMEOUT_MS - 1,
          playerId: "player-1",
        },
        {
          color: "#222222",
          lastActiveAt: now,
          playerId: "player-1",
        },
      ],
      now,
    );

    expect(presences).toEqual([
      { color: "#222222", lastActiveAt: now, playerId: "player-1" },
    ]);
  });
});
