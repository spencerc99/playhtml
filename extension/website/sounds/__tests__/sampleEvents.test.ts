// ABOUTME: Guards the bundled sound-playground event fixture.
// ABOUTME: Verifies it is anonymized, replayable, dense, and smoothly interpolated.

import { describe, expect, it } from "vitest";
import sample from "../sampleEvents.json";
import {
  buildMoveTracks,
  densestWindow,
  interpolateTrackPosition,
  summarizeSample,
  MAX_INTERPOLATION_GAP_MS,
  type MoveTrack,
  type SampleEvent,
} from "../SamplePlayback";

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
    expect(events[0].t).toBe(0);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
    }
    // Long enough to hear a scene build and thin out, short enough to loop.
    const durationMs = events[events.length - 1].t;
    expect(durationMs).toBeGreaterThan(300_000);
    expect(durationMs).toBeLessThanOrEqual(3_600_000);
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

  it("keeps cursor values to plain CSS keywords", () => {
    // A page can set its cursor to an arbitrary url(...), including an inline
    // data URI carrying its own markup, so a raw cursor string is page content.
    for (const event of events) {
      if (event.cursor === undefined) continue;
      expect(event.cursor).toMatch(/^[a-z-]+$/);
      expect(event.cursor).not.toContain("url(");
    }
  });

  it("is as dense as the page it stands in for", () => {
    // The fixture used to be a thin three-minute slice — far quieter than the
    // archive page — so the playground auditioned a scene that never occurs.
    const summary = summarizeSample(events);
    expect(summary.events).toBeGreaterThan(5000);
    expect(summary.participants).toBeGreaterThanOrEqual(20);
    expect(summary.moves).toBeGreaterThan(3000);
    expect(summary.clicks).toBeGreaterThan(300);
    expect(summary.navigations).toBeGreaterThan(200);
  });
});

describe("summarizeSample", () => {
  it("counts each event family the readout reports", () => {
    const summary = summarizeSample([
      { t: 0, type: "cursor", pid: "p01", event: "move", domain: "a.com", x: 0, y: 0 },
      { t: 10, type: "cursor", pid: "p01", event: "click", domain: "a.com", x: 0, y: 0 },
      { t: 20, type: "cursor", pid: "p02", event: "hold", domain: "b.com", x: 0, y: 0 },
      { t: 30, type: "navigation", pid: "p02", event: "focus", domain: "b.com" },
      { t: 40, type: "cursor", pid: "p02", event: "cursor_change", domain: "b.com" },
    ]);

    expect(summary).toMatchObject({
      events: 5,
      participants: 2,
      moves: 1,
      // Clicks and holds both ring the bell, so they count together.
      clicks: 2,
      navigations: 1,
      domains: 2,
      spanMs: 40,
    });
  });

  it("reports an empty sample without throwing", () => {
    expect(summarizeSample([])).toMatchObject({ events: 0, spanMs: 0 });
  });
});

describe("densestWindow", () => {
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

  it("returns more events for a longer window", () => {
    // The window length is selectable, and a longer one must actually widen
    // what is kept — that is the whole point of the dropdown.
    const dense = Array.from({ length: 200 }, (_, i) => ({ ts: i * 1000 }));
    const short = densestWindow(dense, 60_000);
    const long = densestWindow(dense, 180_000);
    expect(long.length).toBeGreaterThan(short.length);
  });

  it("returns nothing for an empty fetch rather than throwing", () => {
    expect(densestWindow([], 60_000)).toEqual([]);
  });
});

describe("buildMoveTracks", () => {
  it("groups moves per participant in order and ignores non-moves", () => {
    const tracks = buildMoveTracks([
      { t: 0, type: "cursor", pid: "p01", event: "move", domain: "a", x: 0.1, y: 0.2 },
      { t: 5, type: "cursor", pid: "p02", event: "move", domain: "a", x: 0.5, y: 0.5 },
      { t: 10, type: "cursor", pid: "p01", event: "click", domain: "a", x: 0.3, y: 0.3 },
      { t: 15, type: "navigation", pid: "p01", event: "focus", domain: "a" },
      { t: 20, type: "cursor", pid: "p01", event: "move", domain: "a", x: 0.4, y: 0.6 },
    ]);

    expect([...tracks.keys()].sort()).toEqual(["p01", "p02"]);
    expect(tracks.get("p01")!.points.map((p) => p.t)).toEqual([0, 20]);
    expect(tracks.get("p02")!.points).toHaveLength(1);
  });

  it("drops moves missing coordinates rather than defaulting them", () => {
    const tracks = buildMoveTracks([
      { t: 0, type: "cursor", pid: "p01", event: "move", domain: "a" },
    ]);
    expect(tracks.size).toBe(0);
  });

  it("builds a track per participant from the bundled fixture", () => {
    const tracks = buildMoveTracks(events);
    expect(tracks.size).toBeGreaterThanOrEqual(10);
  });
});

describe("interpolateTrackPosition", () => {
  const track: MoveTrack = {
    pid: "p01",
    points: [
      { t: 0, x: 0, y: 0 },
      { t: 250, x: 0.5, y: 0.5 },
      { t: 500, x: 1, y: 1 },
    ],
  };

  it("lerps between two samples instead of snapping to one", () => {
    // Halfway between the first two samples is the midpoint of that segment.
    const at = interpolateTrackPosition(track, 125);
    expect(at!.x).toBeCloseTo(0.25, 5);
    expect(at!.y).toBeCloseTo(0.25, 5);
  });

  it("lands exactly on a sample at its own timestamp", () => {
    const at = interpolateTrackPosition(track, 250);
    expect(at!.x).toBeCloseTo(0.5, 5);
  });

  it("holds the last position past the end of the track", () => {
    const at = interpolateTrackPosition(track, 10_000);
    expect(at).toMatchObject({ x: 1, y: 1 });
  });

  it("is silent before the track begins", () => {
    expect(interpolateTrackPosition(track, -1)).toBeNull();
  });

  it("holds rather than sliding across a gap too long to be one stroke", () => {
    // A participant who stops and resumes elsewhere never travelled the line
    // between the two samples, so interpolating it would invent motion.
    const gapped: MoveTrack = {
      pid: "p01",
      points: [
        { t: 0, x: 0, y: 0 },
        { t: MAX_INTERPOLATION_GAP_MS + 1000, x: 1, y: 1 },
      ],
    };
    const at = interpolateTrackPosition(gapped, 500);
    expect(at).toMatchObject({ x: 0, y: 0 });
  });

  it("returns a search index that keeps repeated lookups cheap", () => {
    let index = 0;
    for (const time of [0, 100, 200, 300, 400]) {
      const at = interpolateTrackPosition(track, time, index);
      expect(at).not.toBeNull();
      // The cached index must never run backwards on a monotonic clock, or the
      // per-frame lookup degrades into a rescan.
      expect(at!.index).toBeGreaterThanOrEqual(index);
      index = at!.index;
    }
  });

  it("recovers when the clock rewinds, as it does on a loop", () => {
    // Playback loops back to zero with a stale index; the walk-back must find
    // the right segment rather than reading off the end of the track.
    const at = interpolateTrackPosition(track, 125, 2);
    expect(at!.x).toBeCloseTo(0.25, 5);
  });

  it("holds still between samples on a track that never moves", () => {
    const still: MoveTrack = {
      pid: "p01",
      points: [
        { t: 0, x: 0.4, y: 0.4 },
        { t: 250, x: 0.4, y: 0.4 },
      ],
    };
    expect(interpolateTrackPosition(still, 125)).toMatchObject({
      x: 0.4,
      y: 0.4,
    });
  });
});

describe("replay motion continuity", () => {
  /**
   * The engine derives velocity from per-frame position deltas, so a replay
   * that teleports between sparse samples feeds it one enormous spike and then
   * nothing — which distorts gain, soloist promotion, swell onset and note
   * density. Sampling the interpolated track at frame rate must instead
   * produce small, continuous steps.
   */
  const PAD_WIDTH = 1200;
  const PAD_HEIGHT = 300;
  const FRAME_MS = 1000 / 60;

  function frameSteps(track: MoveTrack, speed = 1): number[] {
    const steps: number[] = [];
    const endMs = track.points[track.points.length - 1].t;
    let index = 0;
    let prev: { x: number; y: number } | null = null;
    for (let t = track.points[0].t; t <= endMs; t += FRAME_MS * speed) {
      const at = interpolateTrackPosition(track, t, index);
      if (!at) continue;
      index = at.index;
      const point = { x: at.x * PAD_WIDTH, y: at.y * PAD_HEIGHT };
      if (prev) {
        steps.push(Math.hypot(point.x - prev.x, point.y - prev.y));
      }
      prev = point;
    }
    return steps;
  }

  it("keeps frame-to-frame jumps rare on real fixture data at 1x", () => {
    const tracks = [...buildMoveTracks(events).values()].filter(
      (track) => track.points.length >= 10,
    );
    expect(tracks.length).toBeGreaterThan(5);

    const steps = tracks.flatMap((track) => frameSteps(track));
    const moving = steps.filter((step) => step > 0);
    expect(moving.length).toBeGreaterThan(1000);

    // Some genuinely fast flicks do cross most of the pad inside one archival
    // sample interval, so this is a distribution claim rather than a hard
    // ceiling: nearly every frame must be continuous motion. Replaying the raw
    // samples without interpolation puts the median above 60px, so a small
    // median is what proves the lerp is actually running.
    const jumps = moving.filter((step) => step > PAD_WIDTH / 4);
    expect(jumps.length / moving.length).toBeLessThan(0.01);
  });

  it("keeps a typical frame step small, not a spike-then-zero pattern", () => {
    const tracks = [...buildMoveTracks(events).values()].filter(
      (track) => track.points.length >= 20,
    );
    const steps = tracks.flatMap((track) => frameSteps(track));
    const moving = steps.filter((step) => step > 0);
    expect(moving.length).toBeGreaterThan(100);

    const sorted = [...moving].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // Continuous motion: the middle of the distribution is a handful of
    // pixels per frame, not a pad-width jump.
    expect(median).toBeGreaterThan(0);
    expect(median).toBeLessThan(20);
  });

  it("moves far more smoothly than replaying raw samples would", () => {
    // The bug this guards: the driver used to place a trail at each event's
    // own coordinate, so the cursor hopped between sparse archival samples.
    // Interpolating must cut the typical per-frame step by a wide margin.
    const tracks = [...buildMoveTracks(events).values()].filter(
      (track) => track.points.length >= 20,
    );

    const median = (values: number[]) => {
      const moving = values.filter((value) => value > 0).sort((a, b) => a - b);
      return moving[Math.floor(moving.length / 2)];
    };

    const rawSteps = tracks.flatMap((track) =>
      track.points.slice(1).map((point, i) => {
        const prev = track.points[i];
        return Math.hypot(
          (point.x - prev.x) * PAD_WIDTH,
          (point.y - prev.y) * PAD_HEIGHT,
        );
      }),
    );

    const smoothMedian = median(tracks.flatMap((track) => frameSteps(track)));
    expect(smoothMedian).toBeLessThan(median(rawSteps) / 5);
  });

  it("raises frame steps proportionally at higher replay speed", () => {
    // 4x replay covers four times the sample clock per frame, so steps scale
    // with speed rather than the driver dropping to teleports.
    const track = [...buildMoveTracks(events).values()]
      .filter((candidate) => candidate.points.length >= 20)
      .sort((a, b) => b.points.length - a.points.length)[0];

    const median = (values: number[]) => {
      const moving = values.filter((value) => value > 0).sort((a, b) => a - b);
      return moving[Math.floor(moving.length / 2)];
    };

    expect(median(frameSteps(track, 4))).toBeGreaterThan(
      median(frameSteps(track, 1)),
    );
  });
});
