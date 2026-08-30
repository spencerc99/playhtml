// ABOUTME: Verifies deterministic atlas line extraction and route narration.
// ABOUTME: Covers edge assignment, interchanges, and endpoint-only walking.

import { describe, expect, test } from "bun:test";
import {
  extractLines,
  fnv1a,
  narrateRoute,
  type TransitLinesFile,
} from "./lines";
import {
  transitShortestPath,
  type GalaxyEdge,
  type GalaxyGraph,
} from "./snowball";

function graph(
  domains: string[],
  edges: GalaxyEdge[],
  nodeOverrides: Record<string, Partial<GalaxyGraph["nodes"][number]>> = {},
): GalaxyGraph {
  return {
    meta: {
      generatedAt: "2026-08-28T00:00:00.000Z",
      seeds: [],
      totalDomains: domains.length,
      totalEdges: edges.length,
    },
    nodes: domains.map((id, index) => ({
      id,
      visits: domains.length - index,
      participants: 0,
      dwellMs: 0,
      cluster: 0,
      kind: "site",
      ...nodeOverrides[id],
    })),
    edges,
    clusters: [{ id: 0, size: domains.length, label: domains[0] }],
  };
}

function edge(
  source: string,
  target: string,
  trunk: boolean,
  jumps = 1,
  back = 1,
  flow01 = 0.8,
): GalaxyEdge {
  return {
    source,
    target,
    jumps,
    back,
    trunk,
    flow: flow01 * 100,
    flow01,
  } as GalaxyEdge;
}

describe("extractLines", () => {
  test("emits ordinary paths with at least five edges", () => {
    const result = extractLines(
      graph(
        ["a.test", "b.test", "c.test", "d.test", "e.test", "f.test", "g.test"],
        [
          edge("a.test", "b.test", true),
          edge("b.test", "c.test", true),
          edge("c.test", "d.test", true),
          edge("d.test", "e.test", true),
          edge("e.test", "f.test", true),
          edge("c.test", "g.test", true),
        ],
      ),
    );

    expect(result.meta.totalLines).toBe(1);
    expect(result.meta.coverage).toBe(5 / 6);
    expect(result.lines[0].stops).toEqual([
      "a.test",
      "b.test",
      "c.test",
      "d.test",
      "e.test",
      "f.test",
    ]);
    expect("spur" in result.lines[0]).toBe(false);
    expect(result.interchanges).toEqual([]);
  });

  test("filters hubs and edges below the flow threshold", () => {
    const result = extractLines(
      graph(
        [
          "a.test",
          "b.test",
          "c.test",
          "d.test",
          "ix.test",
          "z.test",
          "hub.test",
        ],
        [
          edge("a.test", "b.test", true),
          edge("b.test", "c.test", true),
          edge("c.test", "d.test", true),
          edge("d.test", "ix.test", true),
          edge("ix.test", "z.test", true, 1, 0, 0.34),
          edge("a.test", "hub.test", true),
        ],
        {
          "a.test": { visits: 10 },
          "ix.test": { kind: "interchange", visits: 100 },
          "hub.test": { kind: "hub", visits: 200 },
        },
      ),
    );

    expect(result.meta.totalLines).toBe(1);
    expect(result.meta.coverage).toBe(1);
    expect(result.lines[0].name).toBe("a.test line");
    expect(result.lines[0].stops).toEqual([
      "a.test",
      "b.test",
      "c.test",
      "d.test",
      "ix.test",
    ]);
  });

  test("stops below sixty percent of the running median flow", () => {
    const result = extractLines(
      graph(
        ["a.test", "b.test", "c.test", "d.test"],
        [
          edge("a.test", "b.test", false, 1, 0, 0.59),
          edge("b.test", "c.test", false, 1, 0, 1),
          edge("c.test", "d.test", false, 1, 0, 0.59),
        ],
      ),
    );

    expect(result.meta.totalLines).toBe(0);
    expect(result.meta.coverage).toBe(0);
  });

  test("caps every line at sixteen stops", () => {
    const domains = Array.from({ length: 20 }, (_, index) => `s${index}.test`);
    const edges = domains
      .slice(1)
      .map((domain, index) => edge(domains[index], domain, false, 1, 1, 0.8));

    const result = extractLines(graph(domains, edges));

    expect(result.lines.some((line) => line.stops.length === 16)).toBe(true);
    expect(result.lines.every((line) => line.stops.length <= 16)).toBe(true);
  });

  test("requires five edges unless a seed or interchange is present", () => {
    const domains = ["a.test", "b.test", "c.test", "d.test", "e.test"];
    const edges = [
      edge("a.test", "b.test", false),
      edge("b.test", "c.test", false),
      edge("c.test", "d.test", false),
      edge("d.test", "e.test", false),
    ];

    expect(extractLines(graph(domains, edges)).lines).toHaveLength(0);
    expect(
      extractLines(graph(domains, edges, { "a.test": { kind: "seed" } })).lines,
    ).toHaveLength(1);
    expect(
      extractLines(graph(domains, edges, { "c.test": { kind: "interchange" } }))
        .lines,
    ).toHaveLength(1);
  });

  test("blocks cross-cluster extensions unless their edge is mutual", () => {
    const domains = [
      "a.test",
      "b.test",
      "c.test",
      "d.test",
      "e.test",
      "f.test",
      "g.test",
    ];
    const nodeOverrides = { "g.test": { cluster: 1 } };
    const corridor = [
      edge("a.test", "b.test", false, 1, 1, 1),
      edge("b.test", "c.test", false, 1, 1, 0.9),
      edge("c.test", "d.test", false, 1, 1, 0.8),
      edge("d.test", "e.test", false, 1, 1, 0.7),
      edge("e.test", "f.test", false, 1, 1, 0.7),
    ];

    const oneWay = extractLines(
      graph(
        domains,
        [...corridor, edge("f.test", "g.test", false, 1, 0, 0.7)],
        nodeOverrides,
      ),
    );
    const mutual = extractLines(
      graph(
        domains,
        [...corridor, edge("f.test", "g.test", false, 1, 1, 0.7)],
        nodeOverrides,
      ),
    );

    expect(oneWay.lines[0].stops).toEqual([
      "a.test",
      "b.test",
      "c.test",
      "d.test",
      "e.test",
      "f.test",
    ]);
    expect(mutual.lines[0].stops).toEqual(domains);
  });

  test("lists shared stops as interchanges and separates their colors", () => {
    const domains = ["x.test"];
    const edges: GalaxyEdge[] = [];
    for (const arm of ["a", "b", "c", "d", "e", "f"]) {
      domains.push(`${arm}1.test`, `${arm}2.test`, `${arm}3.test`);
      edges.push(
        edge("x.test", `${arm}1.test`, true),
        edge(`${arm}1.test`, `${arm}2.test`, true),
        edge(`${arm}2.test`, `${arm}3.test`, true),
      );
    }
    const result = extractLines(
      graph(domains, edges, { "x.test": { kind: "interchange" } }),
    );

    expect(result.meta.totalLines).toBe(5);
    expect(result.meta.coverage).toBe(1);
    expect(result.interchanges).toContainEqual({
      domain: "x.test",
      lines: result.lines.map((line) => line.id).sort(),
    });
    expect(new Set(result.lines.map((line) => line.color)).size).toBe(5);
    expect(result.lines.every((line) => line.sharedWith.length > 0)).toBe(true);
  });

  test("traverses claimed corridor edges to reach unclaimed territory", () => {
    const result = extractLines(
      graph(
        [
          "a0.test",
          "a1.test",
          "a2.test",
          "c0.test",
          "c1.test",
          "c2.test",
          "d.test",
          "e.test",
          "x.test",
          "y.test",
        ],
        [
          edge("a0.test", "a1.test", false, 1, 0, 1),
          edge("a1.test", "a2.test", false, 1, 0, 1),
          edge("a2.test", "x.test", false, 1, 0, 0.95),
          edge("c0.test", "c1.test", false, 1, 0, 0.945),
          edge("c1.test", "c2.test", false, 1, 0, 0.94),
          edge("c2.test", "x.test", false, 1, 0, 0.93),
          edge("x.test", "y.test", false, 1, 0, 0.9),
          edge("y.test", "d.test", false, 1, 0, 0.85),
          edge("d.test", "e.test", false, 1, 0, 0.84),
        ],
      ),
    );

    expect(result.lines).toHaveLength(2);
    expect(result.lines.map((line) => line.stops)).toContainEqual([
      "a0.test",
      "a1.test",
      "a2.test",
      "x.test",
      "c2.test",
      "c1.test",
      "c0.test",
    ]);
    expect(result.lines.map((line) => line.stops)).toContainEqual([
      "a0.test",
      "a1.test",
      "a2.test",
      "x.test",
      "y.test",
      "d.test",
      "e.test",
    ]);
    expect(result.lines.every((line) => line.sharedWith.length === 1)).toBe(
      true,
    );
  });

  test("assigns unique names without Roman numeral suffixes", () => {
    const domains = ["x.test"];
    const edges: GalaxyEdge[] = [];
    const nodeOverrides: Record<
      string,
      Partial<GalaxyGraph["nodes"][number]>
    > = { "x.test": { visits: 100 } };
    for (const arm of ["a", "b", "c", "d", "e", "f"]) {
      const stops = [`${arm}1.test`, `${arm}2.test`, `${arm}3.test`];
      domains.push(...stops);
      for (const stop of stops) {
        nodeOverrides[stop] = { kind: "interchange" };
      }
      edges.push(
        edge("x.test", stops[0], true),
        edge(stops[0], stops[1], true),
        edge(stops[1], stops[2], true),
      );
    }

    const result = extractLines(graph(domains, edges, nodeOverrides));
    const names = result.lines.map((line) => line.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("x.test line");
    expect(names.some((name) => name.startsWith("x.test line via "))).toBe(
      true,
    );
    expect(names.every((name) => !/\b[IVXLCDM]+$/.test(name))).toBe(true);
  });

  test("uses stable FNV-1a identity", () => {
    expect(fnv1a("hello")).toBe("4f9f2cab");
  });
});

describe("route narration", () => {
  const routeGraph = graph(
    ["origin.test", "a.test", "b.test", "c.test", "d.test", "destination.test"],
    [
      edge("origin.test", "a.test", false),
      edge("a.test", "b.test", true),
      edge("b.test", "c.test", true),
      edge("c.test", "d.test", true),
      edge("d.test", "destination.test", false),
    ],
  );
  const lineFile: TransitLinesFile = {
    meta: {
      generatedAt: "2026-08-28T00:00:00.000Z",
      totalLines: 1,
      coverage: 1,
    },
    lines: [
      {
        id: "line-test",
        name: "a.test line",
        color: "#A65D57",
        loop: false,
        stops: ["a.test", "b.test", "c.test", "d.test"],
        sharedWith: [],
      },
    ],
    interchanges: [],
  };

  test("enumerates local stops and keeps walking at route ends", () => {
    expect(
      narrateRoute(
        routeGraph,
        lineFile,
        "origin.test",
        "destination.test",
        "local",
      ),
    ).toBe(
      "Walk from origin.test to a.test -> Board the a.test line at a.test -> " +
        "ride 3 stops, calling at b.test, c.test -> Walk from d.test to destination.test -> " +
        "arrive destination.test",
    );
  });

  test("does not walk between separate ride sections", () => {
    const invalidMiddleWalk = graph(
      ["a.test", "b.test", "c.test", "d.test"],
      [
        edge("a.test", "b.test", true),
        edge("b.test", "c.test", false),
        edge("c.test", "d.test", true),
      ],
    );

    expect(
      transitShortestPath(invalidMiddleWalk, "a.test", "d.test").path,
    ).toEqual([]);
  });

  test("treats trunk edges outside emitted lines as endpoint walks", () => {
    const graphWithoutLines = graph(
      ["a.test", "b.test", "c.test"],
      [edge("a.test", "b.test", true), edge("b.test", "c.test", true)],
    );
    const emptyLineFile: TransitLinesFile = {
      meta: {
        generatedAt: "2026-08-28T00:00:00.000Z",
        totalLines: 0,
        coverage: 0,
      },
      lines: [],
      interchanges: [],
    };

    expect(
      narrateRoute(
        graphWithoutLines,
        emptyLineFile,
        "a.test",
        "c.test",
        "express",
      ),
    ).toBe("Walk from a.test to c.test via b.test -> arrive c.test");
  });
});
