// ABOUTME: Checks that routes prefer crossing between hosts and stop only at meaningful places.
// ABOUTME: Hand-built road networks where one host's paths form a long chain.

import { describe, expect, it } from "vitest";
import {
  buildPlaces, buildRoadGraph, findRoute, hostIds, meaningfulStops, LANDMARKS_PER_HOST,
} from "../route";

/** A chain of settlements along x, one road between each neighbour. */
function chain(subs: string[], pages: number[]) {
  const n = subs.length;
  const A = {
    sub_x: Float32Array.from(subs.map((_, i) => i * 10)),
    sub_y: new Float32Array(n),
    road_a: Uint32Array.from({ length: n - 1 }, (_, i) => i),
    road_b: Uint32Array.from({ length: n - 1 }, (_, i) => i + 1),
    road_w: new Float32Array(n - 1).fill(1),
  };
  return { roads: buildRoadGraph(A as never), places: buildPlaces(subs, pages), A };
}

const nodesOf = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("hostIds", () => {
  it("groups neighbourhoods by hostname, ignoring paths and chunk markers", () => {
    const ids = hostIds(["a.com", "a.com/x [2]", "b.com/y", "a.com/z"]);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toBe(ids[3]);
    expect(ids[2]).not.toBe(ids[0]);
  });
});

describe("meaningfulStops", () => {
  it("collapses a run through one host to where the route enters and leaves it", () => {
    const subs = ["start.com", "big.com/a", "big.com/b", "big.com/c", "big.com/d", "end.com"];
    const { places } = chain(subs, [5, 5, 5, 5, 5, 5]);
    const stops = meaningfulStops(nodesOf(subs.length), places);
    expect(stops.map((s) => s.at)).toEqual([0, 1, 4, 5]);
    expect(stops.every((s) => !s.landmark)).toBe(true);
  });

  it("keeps a path inside the host when it is a big part of that site", () => {
    const subs = ["start.com", "big.com/a", "big.com/docs", "big.com/b", "big.com/c", "end.com"];
    const { places } = chain(subs, [5, 5, 400, 5, 5, 5]);
    const stops = meaningfulStops(nodesOf(subs.length), places);
    expect(stops.map((s) => s.at)).toEqual([0, 1, 2, 4, 5]);
    expect(stops.find((s) => s.at === 2)?.landmark).toBe(true);
  });

  it("counts a path split into chunks as one landmark, and caps landmarks per host", () => {
    const subs = [
      "start.com", "big.com/in",
      "big.com/docs", "big.com/docs [2]", "big.com/wiki", "big.com/blog", "big.com/shop",
      "big.com/out", "end.com",
    ];
    const pages = [5, 5, 300, 320, 200, 250, 210, 5, 5];
    const { places } = chain(subs, pages);
    const marks = meaningfulStops(nodesOf(subs.length), places).filter((s) => s.landmark);
    expect(marks.length).toBe(LANDMARKS_PER_HOST);
    // the biggest two, in route order; docs once, by its bigger chunk
    expect(marks.map((s) => subs[s.at])).toEqual(["big.com/docs [2]", "big.com/blog"]);
  });

  it("treats subdomains of one site as one place when given the site", () => {
    // a.com, then back and forth between two subdomains of one site, then z.com
    const subs = ["a.com", "reddit.com/r/x", "old.reddit.com", "reddit.com/r/y", "old.reddit.com/top", "z.com"];
    const site = [0, 1, 1, 1, 1, 2];
    const places = buildPlaces(subs, [5, 5, 5, 5, 5, 5], site);
    expect(meaningfulStops(nodesOf(6), places).map((s) => s.at)).toEqual([0, 1, 4, 5]);
  });

  it("keeps every stop when each one is a different host", () => {
    const subs = ["a.com", "b.com", "c.com", "d.com"];
    const { places } = chain(subs, [1, 1, 1, 1]);
    expect(meaningfulStops(nodesOf(4), places).map((s) => s.at)).toEqual([0, 1, 2, 3]);
  });
});

describe("findRoute with hosts", () => {
  /**
   * Two ways from 0 to 5: straight along one host's chain of paths, or round
   * through other sites, a little longer.
   *
   *   0 - 1 - 2 - 3 - 4 - 5        (1..4 all big.com)
   *    \                 /
   *     6 ------------- 7          (other sites)
   */
  it("prefers the way that crosses between sites over a slightly shorter way through one", () => {
    const subs = ["s.com", "big.com/a", "big.com/b", "big.com/c", "big.com/d", "e.com", "x.com", "y.com"];
    const A = {
      sub_x: Float32Array.from([0, 10, 20, 30, 40, 50, 5, 45]),
      sub_y: Float32Array.from([0, 0, 0, 0, 0, 0, 12, 12]),
      road_a: Uint32Array.from([0, 1, 2, 3, 4, 0, 6, 7]),
      road_b: Uint32Array.from([1, 2, 3, 4, 5, 6, 7, 5]),
      road_w: new Float32Array(8).fill(1),
    };
    const roads = buildRoadGraph(A as never);
    const plain = findRoute(roads, 0, 5, "short");
    expect(plain.nodes).toEqual([0, 1, 2, 3, 4, 5]);
    const host = hostIds(subs);
    const crossing = findRoute(roads, 0, 5, "short", { site: host, roadA: A.road_a, roadB: A.road_b });
    expect(crossing.nodes).toEqual([0, 6, 7, 5]);
  });
});
