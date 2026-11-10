// ABOUTME: Tests the recorded-trail format the density harness replays
// ABOUTME: Stroke splitting, interpolation, and reading back a hand-edited file

import { describe, expect, it } from "vitest";
import type { SampleEvent } from "../SamplePlayback";
import {
  parseRecording,
  positionAt,
  recordTrailsFromEvents,
  serializeRecording,
  trailDurationMs,
} from "../recordedTrails";

/** A run of cursor moves for one participant at a fixed sampling interval. */
function moves(
  pid: string,
  count: number,
  { from = 0, every = 250 } = {},
): SampleEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    t: from + i * every,
    type: "cursor" as const,
    pid,
    event: "move",
    domain: "example.com",
    x: 0.1 + i * 0.01,
    y: 0.2 + i * 0.005,
    cursor: "default",
  }));
}

describe("recording browsing as trails", () => {
  it("keeps a continuous run as one trail on its own clock", () => {
    const trails = recordTrailsFromEvents(moves("p01", 20));
    expect(trails).toHaveLength(1);
    // Re-based, so the trail can be placed at any offset the harness likes.
    expect(trails[0].points[0].t).toBe(0);
    expect(trailDurationMs(trails[0])).toBe(19 * 250);
    expect(trails[0].cursor).toBe("default");
  });

  it("splits a participant's session at the gaps between gestures", () => {
    // Archival cursor sampling stops while someone reads, so one participant's
    // track is really several separate gestures.
    const events = [
      ...moves("p01", 20),
      ...moves("p01", 20, { from: 60_000 }),
    ];
    const trails = recordTrailsFromEvents(events);
    expect(trails).toHaveLength(2);
    expect(trails[0].points[0].t).toBe(0);
    expect(trails[1].points[0].t).toBe(0);
    expect(trails[0].color).not.toBe(trails[1].color);
  });

  it("drops strokes too short to be a gesture", () => {
    // Two samples a quarter-second apart is a teleport, and a library of those
    // replays as clicks rather than as lines.
    expect(recordTrailsFromEvents(moves("p01", 3))).toHaveLength(0);
  });

  it("ignores everything that is not a cursor move", () => {
    const events: SampleEvent[] = [
      { t: 0, type: "navigation", pid: "p01", event: "navigate", domain: "a.com" },
      { t: 10, type: "cursor", pid: "p01", event: "click", domain: "a.com", x: 0.2, y: 0.2 },
    ];
    expect(recordTrailsFromEvents(events)).toHaveLength(0);
  });
});

describe("replaying a trail", () => {
  const trail = {
    id: "t",
    color: "#000",
    points: [
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 0, t: 1000 },
    ],
  };

  it("lerps between samples rather than stepping", () => {
    // The engine derives velocity from per-frame deltas, so a stepped replay
    // reads as one enormous spike followed by nothing.
    expect(positionAt(trail, 500)).toEqual({ x: 0.5, y: 0 });
    expect(positionAt(trail, 250)).toEqual({ x: 0.25, y: 0 });
  });

  it("is not live outside its own span", () => {
    expect(positionAt(trail, -1)).toBeNull();
    expect(positionAt(trail, 1001)).toBeNull();
    expect(positionAt(trail, 1000)).toEqual({ x: 1, y: 0 });
  });
});

describe("reading a recording back", () => {
  it("round-trips what it wrote", () => {
    const trails = recordTrailsFromEvents(moves("p01", 20));
    const parsed = parseRecording(
      JSON.parse(JSON.stringify(serializeRecording(trails))),
    );
    expect(parsed).toEqual(trails);
  });

  it("accepts a bare array as well as the wrapped file", () => {
    const trails = recordTrailsFromEvents(moves("p01", 20));
    expect(parseRecording(trails)).toEqual(trails);
  });

  it("keeps the replayable entries of a hand-edited file and drops the rest", () => {
    const parsed = parseRecording({
      v: 1,
      trails: [
        // Out of order and not starting at zero, which a file written by hand
        // easily is; the lerp walks points in order, so they are sorted and
        // re-based rather than silently replayed as a scribble.
        {
          id: "hand",
          color: "#abc",
          points: [
            { x: 1, y: 1, t: 900 },
            { x: 0, y: 0, t: 400 },
          ],
        },
        { id: "no-points" },
        { id: "one-point", points: [{ x: 0, y: 0, t: 0 }] },
        "not a trail",
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("hand");
    expect(parsed[0].points).toEqual([
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 1, t: 500 },
    ]);
  });

  it("returns nothing for a file that is not a recording at all", () => {
    expect(parseRecording(null)).toEqual([]);
    expect(parseRecording({ hello: "world" })).toEqual([]);
    expect(parseRecording(42)).toEqual([]);
  });
});
