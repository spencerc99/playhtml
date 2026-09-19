// ABOUTME: Tests the pure event-accumulation core that keeps each live trail's
// ABOUTME: full point history as the upstream event window slides and trims.

import { describe, it, expect } from "vitest";
import {
  accumulateEvents,
  collectFinishedEventIds,
  type AccumulatedGroups,
} from "../useAccumulatedEvents";
import type { CollectionEvent } from "../../types";

function ev(
  id: string,
  pid: string,
  url: string,
  ts: number,
): CollectionEvent {
  return {
    id,
    type: "cursor",
    ts,
    data: { x: 0.5, y: 0.5, event: "move" },
    meta: { pid, sid: "s", url, vw: 1000, vh: 800, tz: "UTC" },
  };
}

describe("accumulateEvents", () => {
  it("appends new events into their pid|url group", () => {
    const next = accumulateEvents(new Map(), [
      ev("a", "p1", "u1", 100),
      ev("b", "p1", "u1", 200),
    ]);
    const group = next.get("p1|u1");
    expect(group).toBeDefined();
    expect(group!.events.length).toBe(2);
  });

  it("dedupes by event id across batches", () => {
    let acc: AccumulatedGroups = new Map();
    acc = accumulateEvents(acc, [ev("a", "p1", "u1", 100)]);
    acc = accumulateEvents(acc, [ev("a", "p1", "u1", 100), ev("b", "p1", "u1", 200)]);
    expect(acc.get("p1|u1")!.events.length).toBe(2);
  });

  it("retains a group's old events even when the new batch omits them", () => {
    // Simulates the sliding window: batch 2 no longer contains 'a'.
    let acc: AccumulatedGroups = new Map();
    acc = accumulateEvents(acc, [ev("a", "p1", "u1", 100), ev("b", "p1", "u1", 200)]);
    acc = accumulateEvents(acc, [ev("c", "p1", "u1", 300)]);
    const group = acc.get("p1|u1")!;
    expect(group.events.map((e) => e.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("does NOT evict by time — an old quiet group survives a much-later event", () => {
    // This is the whole point: accumulation must not drop a still-drawn trail
    // just because newer events arrived far later.
    let acc: AccumulatedGroups = new Map();
    acc = accumulateEvents(acc, [ev("a", "p1", "u1", 100)]);
    acc = accumulateEvents(acc, [ev("z", "p2", "u2", 100 + 10 * 60_000)]);
    expect(acc.has("p1|u1")).toBe(true);
    expect(acc.has("p2|u2")).toBe(true);
  });

  it("drops groups named in evictIds", () => {
    let acc: AccumulatedGroups = new Map();
    acc = accumulateEvents(acc, [ev("a", "p1", "u1", 100), ev("b", "p2", "u2", 200)]);
    acc = accumulateEvents(acc, [], ["p1|u1"]);
    expect(acc.has("p1|u1")).toBe(false);
    expect(acc.has("p2|u2")).toBe(true);
  });

  it("does not rebuild an evicted group from events still in the incoming window", () => {
    const buffered = [
      ev("a", "p1", "u1", 100),
      ev("b", "p1", "u1", 200),
      ev("c", "p2", "u2", 300),
    ];
    let acc: AccumulatedGroups = accumulateEvents(new Map(), buffered);
    let finishedEventIds = collectFinishedEventIds(
      new Set(),
      acc,
      buffered,
      ["p1|u1"],
    );

    acc = accumulateEvents(
      acc,
      buffered,
      ["p1|u1"],
      undefined,
      finishedEventIds,
    );

    expect(acc.has("p1|u1")).toBe(false);
    expect(acc.has("p2|u2")).toBe(true);

    const nextWindow = buffered.concat(ev("d", "p2", "u2", 400));
    finishedEventIds = collectFinishedEventIds(
      finishedEventIds,
      acc,
      nextWindow,
    );
    acc = accumulateEvents(
      acc,
      nextWindow,
      undefined,
      undefined,
      finishedEventIds,
    );
    expect(acc.has("p1|u1")).toBe(false);

    const freshEvent = ev("e", "p1", "u1", 500);
    const freshWindow = nextWindow.concat(freshEvent);
    finishedEventIds = collectFinishedEventIds(
      finishedEventIds,
      acc,
      freshWindow,
    );
    acc = accumulateEvents(
      acc,
      freshWindow,
      undefined,
      undefined,
      finishedEventIds,
    );
    expect(acc.get("p1|u1")?.events).toEqual([freshEvent]);
  });

  it("keeps each group's events sorted by ts", () => {
    let acc: AccumulatedGroups = new Map();
    acc = accumulateEvents(acc, [ev("b", "p1", "u1", 200)]);
    acc = accumulateEvents(acc, [ev("a", "p1", "u1", 100)]);
    expect(acc.get("p1|u1")!.events.map((e) => e.ts)).toEqual([100, 200]);
  });

  it("caps to the maxGroups most-recently-active groups", () => {
    const acc = accumulateEvents(
      new Map(),
      [
        ev("a", "p1", "u1", 100),
        ev("b", "p2", "u2", 200),
        ev("c", "p3", "u3", 300),
      ],
      undefined,
      2,
    );
    expect(acc.size).toBe(2);
    // Oldest (p1) evicted; two most-recent kept.
    expect(acc.has("p1|u1")).toBe(false);
    expect(acc.has("p2|u2")).toBe(true);
    expect(acc.has("p3|u3")).toBe(true);
  });

  it("evicts whole oldest groups (never truncates a trail) past the total-event budget", () => {
    // Two groups, each large enough that together they exceed MAX_ACCUMULATED
    // (8000). The stalest whole group must be dropped — and the surviving group
    // must keep its FULL history (no mid-trail slice).
    const big = (pid: string, url: string, baseTs: number) =>
      Array.from({ length: 5000 }, (_, i) =>
        ev(`${pid}-${i}`, pid, url, baseTs + i),
      );
    const acc = accumulateEvents(new Map(), [
      ...big("p1", "u1", 0), // stale (earlier ts)
      ...big("p2", "u2", 1_000_000), // recent
    ]);
    // p1 (stalest) evicted wholesale; p2 retains all 5000 of its points.
    expect(acc.has("p1|u1")).toBe(false);
    expect(acc.get("p2|u2")!.events.length).toBe(5000);
  });
});
