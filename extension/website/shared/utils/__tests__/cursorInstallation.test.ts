// ABOUTME: Tests when live cursor data is dense enough to replace archived installation footage.
// ABOUTME: Protects the fallback from disappearing for cursor events that cannot draw a trail.

import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "../../types";
import { latestDrawableCursorEventId } from "../cursorInstallation";

function move(
  id: string,
  pid = "person",
  url = "https://example.com",
  ts = Date.now(),
) {
  return {
    id,
    type: "cursor",
    ts,
    data: { event: "move", x: 0.5, y: 0.5 },
    meta: { pid, sid: "session", url, vw: 1000, vh: 800, tz: "UTC" },
  } satisfies CollectionEvent;
}

describe("latestDrawableCursorEventId", () => {
  it("requires two moves from the same cursor group", () => {
    expect(latestDrawableCursorEventId([move("one")])).toBeNull();
    expect(latestDrawableCursorEventId([move("one"), move("two")])).toBe(
      "two",
    );
  });

  it("does not combine moves from different people or pages", () => {
    expect(
      latestDrawableCursorEventId([
        move("one", "a"),
        move("two", "b"),
        move("three", "a", "https://other.example"),
      ]),
    ).toBeNull();
  });

  it("ignores cursor events that do not move", () => {
    const click = {
      ...move("click"),
      data: { event: "click", x: 0.5, y: 0.5, quantity: 1 },
    } satisfies CollectionEvent;
    expect(latestDrawableCursorEventId([click, move("one")])).toBeNull();
  });

  it("does not combine moves separated into different trail segments", () => {
    const now = Date.now();
    expect(
      latestDrawableCursorEventId([
        move("old", "person", "https://example.com", now - 6 * 60_000),
        move("new", "person", "https://example.com", now),
      ]),
    ).toBeNull();
  });
});
