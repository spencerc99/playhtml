// ABOUTME: Tests deterministic installation screen ownership and live-chapter thresholds.
// ABOUTME: Protects cross-computer follower exclusivity and sparse-stream fallback behavior.

import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "../../types";
import {
  eventsForInstallationScreen,
  liveChapterIsReady,
  parseLiveInstallationScreen,
  participantInstallationSlot,
  unconsumedLiveEvents,
} from "../liveInstallation";

function event(
  id: string,
  type: string,
  ts: number,
  pid: string,
  dataEvent = "move",
  sid = "session",
): CollectionEvent {
  return {
    id,
    type,
    ts,
    data: { x: 0.5, y: 0.5, event: dataEvent },
    meta: { pid, sid, url: "https://example.com", vw: 100, vh: 100, tz: "UTC" },
  } as CollectionEvent;
}

describe("live installation screen config", () => {
  it("uses a four-follower field view by default", () => {
    expect(parseLiveInstallationScreen("")).toEqual({
      view: "field",
      slot: 0,
      slots: 4,
    });
  });

  it("clamps an invalid follower slot into the configured range", () => {
    expect(parseLiveInstallationScreen("?view=follow&slot=9&slots=4")).toEqual({
      view: "follow",
      slot: 3,
      slots: 4,
    });
  });
});

describe("participant ownership", () => {
  it("assigns every participant to exactly one stable slot", () => {
    const pids = ["alice", "bob", "charlie", "dana", "erin"];
    for (const pid of pids) {
      const slot = participantInstallationSlot(pid, 4);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(4);
      expect(participantInstallationSlot(pid, 4)).toBe(slot);
    }
  });

  it("returns disjoint event sets for follower screens", () => {
    const events = Array.from({ length: 20 }, (_, index) =>
      event(String(index), "cursor", index, `person-${index}`),
    );
    const assignedIds = new Set<string>();

    for (let slot = 0; slot < 4; slot++) {
      const screenEvents = eventsForInstallationScreen(events, {
        view: "follow",
        slot,
        slots: 4,
      });
      for (const item of screenEvents) {
        expect(assignedIds.has(item.id)).toBe(false);
        assignedIds.add(item.id);
      }
    }

    expect(assignedIds.size).toBe(events.length);
  });
});

describe("live chapter selection", () => {
  it("excludes events already represented by the archive or an earlier chapter", () => {
    const events = [
      event("newer", "cursor", 2, "a"),
      event("used", "cursor", 1, "a"),
    ];
    expect(unconsumedLiveEvents(events, new Set(["used"])).map((item) => item.id)).toEqual([
      "newer",
    ]);
  });

  it("accepts a 30-second cursor chapter with enough movement from two people", () => {
    const events = Array.from({ length: 24 }, (_, index) =>
      event(
        String(index),
        "cursor",
        Math.round((index / 23) * 30_000),
        index % 2 === 0 ? "a" : "b",
      ),
    );
    expect(liveChapterIsReady(events, ["trails"])).toBe(true);
  });

  it("keeps sparse or single-participant cursor activity in the buffer", () => {
    const events = Array.from({ length: 24 }, (_, index) =>
      event(String(index), "cursor", Math.round((index / 23) * 30_000), "a"),
    );
    expect(liveChapterIsReady(events, ["trails"])).toBe(false);
  });

  it("does not require 30 seconds when a high-volume stream fills a dense chapter", () => {
    const events = Array.from({ length: 1000 }, (_, index) =>
      event(String(index), "cursor", index * 5, index % 4 === 0 ? "a" : "b"),
    );
    expect(liveChapterIsReady(events, ["trails"])).toBe(true);
  });

  it("accepts navigation once one session forms a three-step path", () => {
    const events = [
      event("start", "cursor", 0, "a"),
      event("n1", "navigation", 30_000, "a", "focus", "journey"),
      event("n2", "navigation", 31_000, "a", "popstate", "journey"),
      event("n3", "navigation", 32_000, "a", "beforeunload", "journey"),
    ];
    expect(liveChapterIsReady(events, ["navigation"])).toBe(true);
  });
});
