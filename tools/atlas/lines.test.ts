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
): GalaxyEdge {
  return { source, target, jumps, back, trunk };
}

describe("extractLines", () => {
  test("emits only paths with at least four stops", () => {
    const result = extractLines(
      graph(
        ["a.test", "b.test", "c.test", "d.test", "e.test", "f.test"],
        [
          edge("a.test", "b.test", true),
          edge("b.test", "c.test", true),
          edge("c.test", "d.test", true),
          edge("d.test", "e.test", true),
          edge("c.test", "f.test", true),
        ],
      ),
    );

    expect(result.meta.totalLines).toBe(1);
    expect(result.meta.coverage).toBe(4 / 5);
    expect(result.lines[0].stops).toEqual([
      "a.test",
      "b.test",
      "c.test",
      "d.test",
      "e.test",
    ]);
    expect("spur" in result.lines[0]).toBe(false);
    expect(result.interchanges).toEqual([]);
  });

  test("filters hubs and requires mutual roads at interchanges", () => {
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
          edge("ix.test", "z.test", true, 1, 0),
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
    expect(result.meta.coverage).toBe(4 / 6);
    expect(result.lines[0].name).toBe("a.test line");
    expect(result.lines[0].stops).toEqual([
      "a.test",
      "b.test",
      "c.test",
      "d.test",
      "ix.test",
    ]);
  });

  test("favors mutual corridors when choosing the spanning forest", () => {
    const result = extractLines(
      graph(
        ["a.test", "b.test", "c.test", "d.test"],
        [
          edge("a.test", "b.test", true),
          edge("b.test", "c.test", true),
          edge("c.test", "d.test", true),
          edge("a.test", "d.test", true, 4, 0),
        ],
      ),
    );

    expect(result.lines[0].stops).toEqual([
      "a.test",
      "b.test",
      "c.test",
      "d.test",
    ]);
    expect(result.meta.coverage).toBe(3 / 4);
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

    expect(result.meta.totalLines).toBe(3);
    expect(result.meta.coverage).toBe(1);
    expect(result.interchanges).toEqual([
      {
        domain: "x.test",
        lines: result.lines.map((line) => line.id).sort(),
      },
    ]);
    expect(new Set(result.lines.map((line) => line.color)).size).toBe(3);
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
    expect(names.some((name) => name.startsWith("x.test line via "))).toBe(true);
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
