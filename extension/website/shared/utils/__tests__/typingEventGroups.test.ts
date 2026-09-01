// ABOUTME: Tests logical typing-box grouping with real keyboard event shapes.
// ABOUTME: Covers input identity, inactivity boundaries, ordering, and eligibility.

import { describe, expect, it } from "vitest";
import type { CollectionEvent, TypingAction } from "../../types";
import {
  groupTypingEvents,
  TYPING_EVENT_MERGE_THRESHOLD_MS,
} from "../typingEventGroups";

function keyboardEvent(
  id: string,
  ts: number,
  options: {
    pid?: string;
    sid?: string;
    url?: string;
    selector?: string;
    sequence?: TypingAction[] | null;
  } = {},
): CollectionEvent {
  return {
    id,
    type: "keyboard",
    ts,
    data: {
      event: "type",
      x: 0.25,
      y: 0.75,
      t: options.selector ?? "#message",
      sequence:
        options.sequence === undefined
          ? [{ action: "type", text: id, timestamp: 0 }]
          : options.sequence,
    },
    meta: {
      pid: options.pid ?? "person",
      sid: options.sid ?? "session",
      url: options.url ?? "https://example.com/chat",
      vw: 1280,
      vh: 720,
      tz: "UTC",
    },
  };
}

describe("groupTypingEvents", () => {
  it("merges adjacent fragments for one visible input and sorts their events", () => {
    const later = keyboardEvent("later", TYPING_EVENT_MERGE_THRESHOLD_MS);
    const earlier = keyboardEvent("earlier", 0);

    const groups = groupTypingEvents([later, earlier]);

    expect(groups).toHaveLength(1);
    expect(groups[0].events.map(({ id }) => id)).toEqual(["earlier", "later"]);
    expect(groups[0]).toMatchObject({ startTs: 0, endTs: 35_000 });
    expect(groups[0].id).toContain("earlier");
  });

  it("starts a new visible box after more than 35 seconds of inactivity", () => {
    const groups = groupTypingEvents([
      keyboardEvent("first", 0),
      keyboardEvent("second", TYPING_EVENT_MERGE_THRESHOLD_MS + 1),
    ]);

    expect(groups.map((group) => group.events.map(({ id }) => id))).toEqual([
      ["first"],
      ["second"],
    ]);
    expect(new Set(groups.map(({ id }) => id)).size).toBe(2);
  });

  it("keeps participant, browser session, URL, and selector identities separate", () => {
    const groups = groupTypingEvents([
      keyboardEvent("base", 0),
      keyboardEvent("pid", 1, { pid: "other" }),
      keyboardEvent("sid", 2, { sid: "other" }),
      keyboardEvent("url", 3, { url: "https://example.org" }),
      keyboardEvent("selector", 4, { selector: "#search" }),
    ]);

    expect(groups).toHaveLength(5);
    expect(groups.map((group) => group.events[0].id)).toEqual([
      "base",
      "pid",
      "sid",
      "url",
      "selector",
    ]);
  });

  it("returns the same chronological group order for shuffled input", () => {
    const earliest = keyboardEvent("earliest", 100, { selector: "#first" });
    const sameTimeA = keyboardEvent("a", 200, { selector: "#a" });
    const sameTimeB = keyboardEvent("b", 200, { selector: "#b" });

    const orderedIds = (events: CollectionEvent[]) =>
      groupTypingEvents(events).map(({ id }) => id);

    expect(orderedIds([sameTimeB, earliest, sameTimeA])).toEqual(
      orderedIds([sameTimeA, sameTimeB, earliest]),
    );
    expect(
      groupTypingEvents([sameTimeB, earliest, sameTimeA]).map(
        (group) => group.events[0].id,
      ),
    ).toEqual(["earliest", "a", "b"]);
  });

  it("omits non-keyboard, empty, unidentified, and collection-test events", () => {
    const nonKeyboard = { ...keyboardEvent("cursor", 0), type: "cursor" };
    const unidentified = { ...keyboardEvent("missing-id", 1), id: "" };

    const groups = groupTypingEvents([
      nonKeyboard,
      unidentified,
      keyboardEvent("empty", 2, { sequence: [] }),
      keyboardEvent("null", 3, { sequence: null }),
      keyboardEvent("test", 4, {
        sequence: [
          { action: "type", text: "eliza", timestamp: 0 },
          { action: "type", text: "beth", timestamp: 100 },
        ],
      }),
      keyboardEvent("visible", 5),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].events.map(({ id }) => id)).toEqual(["visible"]);
  });
});
