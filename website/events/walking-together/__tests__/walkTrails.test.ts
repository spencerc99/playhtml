// ABOUTME: Tests the join-the-walk trail helpers: steps from navigation events, stops, trails.
// ABOUTME: Covers filtering, dedupe, event-page skipping, stable stop placement, and growth.

import { describe, it, expect } from "vitest";
import type { CollectionEvent } from "@movement/types";
import {
  MAX_STEPS_PER_WALKER,
  stepLabel,
  stepsByWalker,
  stepUrl,
  stopPoint,
  walkerTrailState,
  type Walkers,
} from "../walk/walkTrails";

const walkers: Walkers = {
  maya: { pid: "maya", name: "maya", color: "#c4724e", joinedAt: 1000 },
  jun: { pid: "jun", name: "jun", color: "#5b8db8", joinedAt: 1000 },
};

let n = 0;
const nav = (
  pid: string,
  url: string,
  ts: number,
  event = "focus",
): CollectionEvent => ({
  id: `e${n++}`,
  type: "navigation",
  ts,
  data: { event } as CollectionEvent["data"],
  meta: { pid, sid: "s", url, vw: 1, vh: 1, tz: "UTC" },
});

const isEventPage = (url: string) => url.includes("/events/walking-together");

describe("stepUrl and stepLabel", () => {
  it("keeps host and path, drops query, hash, and www", () => {
    expect(stepUrl("https://www.html.energy/zines/?a=1#x")).toBe(
      "html.energy/zines",
    );
    expect(stepUrl("https://special.fish/")).toBe("special.fish");
    expect(stepUrl("chrome://newtab")).toBeNull();
  });

  it("middle-trims long labels", () => {
    const label = stepLabel("example.com/a/very/long/path/that/keeps/going/on", 20);
    expect(label).toHaveLength(20);
    expect(label).toContain("…");
  });
});

describe("stepsByWalker", () => {
  it("keeps joined walkers' pages since they joined, oldest first, without repeats", () => {
    const steps = stepsByWalker(
      [
        nav("maya", "https://special.fish", 3000),
        nav("maya", "https://html.energy/zines", 2000),
        nav("maya", "https://html.energy/zines?x", 2500),
        nav("maya", "https://wiby.me", 500),
        nav("stranger", "https://wiby.me", 2000),
        nav("jun", "https://playhtml.fun/events/walking-together/session.html", 2000),
        nav("jun", "https://cyberia.club/garden", 2100, "beforeunload"),
      ],
      walkers,
      isEventPage,
    );
    expect(steps.maya.map((s) => s.url)).toEqual([
      "html.energy/zines",
      "special.fish",
    ]);
    expect(steps.jun).toBeUndefined();
    expect(steps.stranger).toBeUndefined();
  });

  it("ignores the same event twice (stream replay plus backfill)", () => {
    const e = nav("maya", "https://a.example", 2000);
    const f = nav("maya", "https://b.example", 3000);
    const steps = stepsByWalker([e, f, e, f], walkers, isEventPage);
    expect(steps.maya).toHaveLength(2);
  });

  it("stops counting pages once the walk has ended", () => {
    const steps = stepsByWalker(
      [
        nav("maya", "https://a.example", 2000),
        nav("maya", "https://b.example", 3000),
        nav("maya", "https://after.example", 5000),
      ],
      walkers,
      isEventPage,
      4000,
    );
    expect(steps.maya.map((s) => s.url)).toEqual(["a.example", "b.example"]);
  });

  it("keeps only the latest stops on a long walk", () => {
    const events = Array.from({ length: MAX_STEPS_PER_WALKER + 5 }, (_, i) =>
      nav("maya", `https://site${i}.example`, 2000 + i),
    );
    const steps = stepsByWalker(events, walkers, isEventPage);
    expect(steps.maya).toHaveLength(MAX_STEPS_PER_WALKER);
    expect(steps.maya.at(-1)?.url).toBe(`site${MAX_STEPS_PER_WALKER + 4}.example`);
  });
});

describe("stopPoint", () => {
  it("puts the same URL in the same place, in the side bands", () => {
    expect(stopPoint("special.fish")).toEqual(stopPoint("special.fish"));
    for (const url of ["a.example", "b.example/x", "html.energy/zines", "wiby.me"]) {
      const p = stopPoint(url);
      expect(p.x < 0.3 || p.x > 0.7).toBe(true);
      expect(p.y).toBeGreaterThanOrEqual(0.1);
      expect(p.y).toBeLessThanOrEqual(0.9);
    }
  });
});

describe("walkerTrailState", () => {
  const size = { width: 1280, height: 800 };
  const steps = [
    { url: "a.example", label: "a.example", ts: 1000 },
    { url: "b.example", label: "b.example", ts: 2000 },
    { url: "c.example", label: "c.example", ts: 3000 },
  ];

  it("needs two stops to draw", () => {
    expect(walkerTrailState(walkers.maya, steps.slice(0, 1), size)).toBeNull();
  });

  it("starts at the first stop, ends at the latest, in the walker's color", () => {
    const state = walkerTrailState(walkers.maya, steps, size)!;
    const first = stopPoint("a.example");
    const last = stopPoint("c.example");
    expect(state.trail.id).toBe("walk-maya");
    expect(state.trail.color).toBe("#c4724e");
    expect(state.trail.points[0]).toMatchObject({ x: first.x * 1280, y: first.y * 800 });
    expect(state.trail.points.at(-1)).toMatchObject({ x: last.x * 1280, y: last.y * 800 });
  });

  it("marks every stop with a click ripple, in order along the trail", () => {
    const state = walkerTrailState(walkers.maya, steps, size)!;
    const marks = state.clicksWithProgress;
    expect(marks).toHaveLength(3);
    expect(marks[0].progress).toBe(0);
    expect(marks[2].progress).toBe(1);
    // The middle mark sits where the drawn line actually passes the stop.
    const varied = state.variedPoints;
    const atMiddle = varied[Math.round(marks[1].progress * (varied.length - 1))];
    const middle = stopPoint("b.example");
    expect(Math.hypot(atMiddle.x - middle.x * 1280, atMiddle.y - middle.y * 800)).toBeLessThan(20);
    steps.forEach((step, i) => {
      const p = stopPoint(step.url);
      expect(marks[i]).toMatchObject({ x: p.x * 1280, y: p.y * 800, ts: step.ts });
    });
  });

  it("grows without reshaping what's already drawn", () => {
    const two = walkerTrailState(walkers.maya, steps.slice(0, 2), size)!;
    const three = walkerTrailState(walkers.maya, steps, size)!;
    expect(three.variedPoints.slice(0, two.variedPoints.length - 1)).toEqual(
      two.variedPoints.slice(0, -1),
    );
  });
});
