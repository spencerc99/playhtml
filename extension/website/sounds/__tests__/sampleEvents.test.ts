// ABOUTME: Guards the bundled sound-playground event fixture.
// ABOUTME: Verifies it is anonymized, replayable, and carries the event mix the replay needs.

import { describe, expect, it } from "vitest";
import sample from "../sampleEvents.json";
import { densestWindow, type SampleEvent } from "../SamplePlayback";

const events = sample as SampleEvent[];

describe("bundled sample events", () => {
  it("carries no real participant, session or url identity", () => {
    const serialized = JSON.stringify(events);
    // The collectors' own identity prefixes. Any of these surviving into the
    // fixture would mean shipping real identity in the repo.
    expect(serialized).not.toMatch(/pk_[0-9a-f]/);
    expect(serialized).not.toMatch(/sid_/);
    expect(serialized).not.toMatch(/https?:\/\//);

    for (const event of events) {
      expect(event.pid).toMatch(/^p\d{2}$/);
    }
  });

  it("is ordered on a replayable clock starting at zero", () => {
    expect(events.length).toBeGreaterThan(100);
    expect(events[0].t).toBe(0);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
    }
    // A couple of minutes is long enough to hear a scene develop and short
    // enough to loop without becoming its own composition.
    const durationMs = events[events.length - 1].t;
    expect(durationMs).toBeGreaterThan(60_000);
    expect(durationMs).toBeLessThan(600_000);
  });

  it("holds every event kind the replay drives", () => {
    const kinds = new Set(events.map((event) => `${event.type}:${event.event}`));
    // Trails, click bells, hold bells and the navigation gong all need to be
    // exercised, or the sample cannot demonstrate the whole engine.
    expect(kinds).toContain("cursor:move");
    expect(kinds).toContain("cursor:click");
    expect(kinds).toContain("cursor:hold");
    expect(kinds).toContain("navigation:focus");
  });

  it("keeps cursor coordinates normalized so any pad size replays it", () => {
    const moves = events.filter(
      (event) => event.type === "cursor" && event.event === "move",
    );
    expect(moves.length).toBeGreaterThan(50);
    for (const move of moves) {
      expect(move.x).toBeGreaterThanOrEqual(0);
      expect(move.x).toBeLessThanOrEqual(1);
      expect(move.y).toBeGreaterThanOrEqual(0);
      expect(move.y).toBeLessThanOrEqual(1);
    }
  });

  it("carries several participants so crossings and merges can happen", () => {
    const pids = new Set(events.map((event) => event.pid));
    expect(pids.size).toBeGreaterThanOrEqual(3);
  });

  it("keeps the busiest window of a live fetch, not the most recent one", () => {
    // A quiet recent stretch followed by nothing, and a dense burst earlier.
    // Taking the tail would loop as near-silence.
    const quiet = [0, 40_000, 80_000, 160_000].map((ts) => ({ ts }));
    const burst = Array.from({ length: 40 }, (_, i) => ({
      ts: 200_000 + i * 1000,
    }));
    const tail = [400_000, 500_000].map((ts) => ({ ts }));
    const sorted = [...quiet, ...burst, ...tail];

    const window = densestWindow(sorted, 60_000);
    expect(window).toHaveLength(burst.length);
    expect(window[0].ts).toBe(burst[0].ts);
    expect(window.at(-1)!.ts).toBe(burst.at(-1)!.ts);
  });

  it("returns nothing for an empty fetch rather than throwing", () => {
    expect(densestWindow([], 60_000)).toEqual([]);
  });

  it("keeps cursor values to plain CSS keywords", () => {
    // A page can set its cursor to an arbitrary url(...), including an inline
    // data URI carrying its own markup, so a raw cursor string is page content.
    for (const event of events) {
      if (event.cursor === undefined) continue;
      expect(event.cursor).toMatch(/^[a-z-]+$/);
      expect(event.cursor).not.toContain("url(");
    }
  });
});
