// ABOUTME: Exercises the road-graph walker on a tiny hand-built network.
// ABOUTME: Covers steering by heading, turning around, planned journeys and off-road legs.

import { describe, expect, it } from "vitest";
import { buildRoadGraph } from "../../route";
import { Walker } from "../walker";

/**
 * Three settlements in a line with a spur:
 *
 *   0 ---- 1 ---- 2
 *          |
 *          3
 *
 * Page 0 sits by settlement 0, page 1 by settlement 2, page 2 by settlement 3.
 * Coordinates are large relative to a cell so roads are many cells long.
 */
function world() {
  const subX = Float32Array.from([0, 100, 200, 100]);
  const subY = Float32Array.from([0, 0, 0, 80]);
  const roadA = Uint32Array.from([0, 1, 1]);
  const roadB = Uint32Array.from([1, 2, 3]);
  const roadW = Float32Array.from([10, 2, 1]);
  const pageX = Float32Array.from([2, 203, 100]);
  const pageY = Float32Array.from([3, 2, 84]);
  const pageSub = Uint32Array.from([0, 2, 3]);
  const A = { sub_x: subX, sub_y: subY, road_a: roadA, road_b: roadB, road_w: roadW };
  const roads = buildRoadGraph(A as never);
  return {
    roads, roadA, roadB, subX, subY, pageX, pageY, pageSub,
    x0: -10, y0: -10, cellW: 2, cellH: 2.8,
  };
}

const run = (w: Walker, seconds: number, heading: { x: number; y: number } | null, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) w.step(dt, { heading, sprint: false });
};

describe("Walker", () => {
  it("stands still without a heading and sets off along the road that agrees with one", () => {
    const w = new Walker(world(), 10);
    w.placeAtNode(0);
    run(w, 0.5, null);
    expect(w.x).toBe(0);
    expect(w.standing).toEqual({ kind: "node", node: 0 });

    run(w, 0.5, { x: 1, y: 0 });
    expect(w.edge).toBe(0);
    expect(w.x).toBeGreaterThan(0);
    expect(w.moving).toBe(true);
    expect(w.hx).toBeCloseTo(1, 1);
  });

  it("refuses a heading that no road leaves the settlement towards", () => {
    const w = new Walker(world(), 10);
    w.placeAtNode(0);
    run(w, 0.5, { x: -1, y: 0 });
    expect(w.standing).toEqual({ kind: "node", node: 0 });
    expect(w.odometer).toBe(0);
  });

  it("turns around mid-road when the heading points back the way it came", () => {
    const w = new Walker(world(), 10);
    w.placeAtNode(0);
    run(w, 1, { x: 1, y: 0 });
    const ahead = w.x;
    run(w, 0.5, { x: -1, y: 0 });
    expect(w.dir).toBe(-1);
    expect(w.x).toBeLessThan(ahead);
  });

  it("takes the turning at a junction that best matches the heading", () => {
    const w = new Walker(world(), 200);
    w.placeAtNode(0);
    // rush to settlement 1, then point down the spur
    run(w, 0.6, { x: 1, y: 0.05 });
    const arrivals = w.drainArrivals();
    expect(arrivals.some((a) => a.kind === "node" && a.node === 1)).toBe(true);
    run(w, 0.2, { x: 0, y: 1 });
    expect(w.edge).toBe(2);
    expect(w.y).toBeGreaterThan(0);
  });

  it("walks a planned journey door to door and reports the arrival", () => {
    const w = new Walker(world(), 100);
    w.placeAtPage(0);
    expect(w.travelTo(1)).toBe(true);
    // a contrary heading is ignored while a plan runs
    run(w, 0.3, { x: -1, y: -1 });
    expect(w.plan).not.toBeNull();
    expect(w.x).toBeGreaterThan(2);
    run(w, 6, null);
    const arrivals = w.drainArrivals();
    const final = arrivals.find((a) => a.final);
    expect(final).toMatchObject({ kind: "page", page: 1, node: 2 });
    expect(w.standing).toEqual({ kind: "page", page: 1, node: 2 });
    expect(w.x).toBeCloseTo(203, 3);
    expect(w.plan).toBeNull();
    // it passed through the settlements along the way; stepping out of the
    // door into the street it started in is not an arrival anywhere
    expect(arrivals.filter((a) => a.kind === "node").map((a) => a.node)).toEqual([1, 2]);
  });

  it("plans from the middle of a road towards whichever end is shorter overall", () => {
    const w = new Walker(world(), 100);
    w.placeAtNode(0);
    run(w, 0.3, { x: 1, y: 0 });
    expect(w.edge).toBe(0);
    expect(w.travelTo(0)).toBe(true);        // back to the door by settlement 0
    expect(w.dir).toBe(-1);
    run(w, 4, null);
    expect(w.standing).toEqual({ kind: "page", page: 0, node: 0 });
  });

  it("answers an unreachable destination with false and keeps its place", () => {
    const wd = world();
    // cut the spur off entirely
    wd.roadA = Uint32Array.from([0, 1]);
    wd.roadB = Uint32Array.from([1, 2]);
    wd.roads = buildRoadGraph({ sub_x: wd.subX, sub_y: wd.subY, road_a: wd.roadA, road_b: wd.roadB, road_w: Float32Array.from([1, 1]) } as never);
    const w = new Walker(wd, 10);
    w.placeAtNode(0);
    expect(w.travelTo(2)).toBe(false);
    expect(w.standing).toEqual({ kind: "node", node: 0 });
  });

  it("walks back to the street before answering to a heading from a door", () => {
    const w = new Walker(world(), 4);
    w.placeAtPage(2);
    run(w, 0.05, { x: 0, y: -1 });
    expect(w.leg).not.toBeNull();
    expect(w.leg?.toPage).toBe(false);
    run(w, 2, { x: 0, y: -1 });
    expect(w.edge).toBe(2);
  });
});
