// ABOUTME: Verifies deterministic atlas flow counting on a small directed graph.
// ABOUTME: Covers shortest paths, hub endpoints, and logarithmic normalization.

import { describe, expect, test } from "bun:test";
import { computeFlow, flowDeciles } from "./flow";
import type { GalaxyEdge, GalaxyGraph } from "./snowball";

function graph(
  domains: string[],
  edges: GalaxyEdge[],
  kinds: Partial<Record<string, GalaxyGraph["nodes"][number]["kind"]>> = {},
): GalaxyGraph {
  return {
    meta: {
      generatedAt: "2026-08-29T00:00:00.000Z",
      seeds: [],
      totalDomains: domains.length,
      totalEdges: edges.length,
    },
    nodes: domains.map((id) => ({
      id,
      visits: 1,
      participants: 0,
      dwellMs: 0,
      cluster: 0,
      kind: kinds[id] ?? "site",
    })),
    edges,
    clusters: [{ id: 0, size: domains.length, label: domains[0] }],
  };
}

describe("computeFlow", () => {
  test("counts deterministic directed journeys and does not transit hubs", () => {
    const result = computeFlow(
      graph(
        ["a.test", "b.test", "c.test", "hub.test"],
        [
          {
            source: "a.test",
            target: "b.test",
            jumps: 1,
            back: 0,
            trunk: true,
          },
          {
            source: "b.test",
            target: "c.test",
            jumps: 1,
            back: 0,
            trunk: true,
          },
          {
            source: "a.test",
            target: "hub.test",
            jumps: 10,
            back: 10,
            trunk: true,
          },
          {
            source: "c.test",
            target: "hub.test",
            jumps: 10,
            back: 10,
            trunk: true,
          },
        ],
        { "hub.test": "hub" },
      ),
    );

    expect(result.totalJourneys).toBe(9);
    expect(result.graph.edges.map((edge) => edge.flow)).toEqual([3, 3, 3, 3]);
    expect(result.graph.edges.map((edge) => edge.flow01)).toEqual([1, 1, 1, 1]);
    expect(flowDeciles(result.graph.edges)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 4,
    ]);
  });

  test("counts both directions on one merged edge", () => {
    const result = computeFlow(
      graph(
        ["a.test", "b.test"],
        [
          {
            source: "a.test",
            target: "b.test",
            jumps: 1,
            back: 1,
            trunk: true,
          },
        ],
      ),
    );

    expect(result.totalJourneys).toBe(2);
    expect(result.graph.edges[0]).toMatchObject({ flow: 2, flow01: 1 });
  });
});
