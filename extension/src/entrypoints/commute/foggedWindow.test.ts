// ABOUTME: Covers fogged-window stroke fading, capping, and point simplification.
// ABOUTME: Keeps old wipes fading over days rather than vanishing between stops.

import { describe, expect, it } from "vitest";
import {
  FOG_FADE_MS,
  FOG_SHARP_MS,
  getExpiredStrokeIds,
  getStrokeOpacity,
  getVisibleStrokes,
  simplifyStrokePoints,
  toPolylinePoints,
  type FoggedPaneStrokes,
  type FoggedStroke,
} from "./foggedWindow";

const NOW = 1_700_000_000_000;

function stroke(id: string, ageMs: number): FoggedStroke {
  return {
    id,
    color: "#4a9a8a",
    drawnAt: NOW - ageMs,
    points: [0, 0, 1, 1],
  };
}

function pane(...strokes: FoggedStroke[]): FoggedPaneStrokes {
  return Object.fromEntries(strokes.map((entry) => [entry.id, entry]));
}

describe("getStrokeOpacity", () => {
  it("keeps a fresh wipe fully clear", () => {
    expect(getStrokeOpacity(stroke("a", 0), NOW)).toBe(1);
    expect(getStrokeOpacity(stroke("a", FOG_SHARP_MS), NOW)).toBe(1);
  });

  it("softens over days rather than minutes", () => {
    const oneHourLater = getStrokeOpacity(
      stroke("a", FOG_SHARP_MS + 60_000),
      NOW,
    );
    expect(oneHourLater).toBeGreaterThan(0.98);
    expect(getStrokeOpacity(stroke("a", FOG_FADE_MS / 2), NOW)).toBeLessThan(
      0.6,
    );
  });

  it("fogs a wipe over completely past the fade window", () => {
    expect(getStrokeOpacity(stroke("a", FOG_FADE_MS + 1), NOW)).toBe(0);
  });
});

describe("getVisibleStrokes", () => {
  it("returns nothing for an untouched pane", () => {
    expect(getVisibleStrokes(undefined, NOW)).toEqual([]);
  });

  it("drops fully fogged wipes and orders oldest first", () => {
    const visible = getVisibleStrokes(
      pane(stroke("new", 0), stroke("old", FOG_FADE_MS * 2), stroke("mid", 5_000)),
      NOW,
    );
    expect(visible.map((entry) => entry.id)).toEqual(["mid", "new"]);
  });
});

describe("getExpiredStrokeIds", () => {
  it("reports fully fogged wipes", () => {
    expect(
      getExpiredStrokeIds(pane(stroke("gone", FOG_FADE_MS * 2)), NOW),
    ).toEqual(["gone"]);
  });

  it("sheds the oldest surviving wipes past the cap", () => {
    const strokes = Array.from({ length: 5 }, (_, index) =>
      stroke(`s${index}`, index * 1_000),
    );
    expect(getExpiredStrokeIds(pane(...strokes), NOW, 3)).toEqual(["s4", "s3"]);
  });

  it("keeps everything while under the cap", () => {
    expect(getExpiredStrokeIds(pane(stroke("a", 0)), NOW, 3)).toEqual([]);
  });
});

describe("simplifyStrokePoints", () => {
  it("keeps very short strokes intact", () => {
    expect(simplifyStrokePoints([0, 0])).toEqual([0, 0]);
  });

  it("drops points that barely moved but keeps the last one", () => {
    const simplified = simplifyStrokePoints(
      [0, 0, 0.001, 0.001, 0.002, 0.002, 0.5, 0.5],
      0.05,
    );
    expect(simplified).toEqual([0, 0, 0.5, 0.5]);
  });
});

describe("toPolylinePoints", () => {
  it("scales normalized points into pane space", () => {
    expect(toPolylinePoints([0, 0, 0.5, 1], 100, 50)).toBe("0,0 50,50");
  });
});
