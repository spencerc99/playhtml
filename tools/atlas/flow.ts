// ABOUTME: Computes deterministic all-destinations traffic over the atlas graph.
// ABOUTME: Enriches each merged edge with raw and logarithmically normalized flow.

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { GalaxyEdge, GalaxyGraph } from "./snowball";

const GRAPH_PATH = fileURLToPath(
  new URL("./out/galaxy-graph.json", import.meta.url),
);
const PHASES = ["access", "ride", "egress"] as const;

type RoutePhase = (typeof PHASES)[number];

export interface FlowEdge extends GalaxyEdge {
  flow: number;
  flow01: number;
}

export interface FlowGraph extends Omit<GalaxyGraph, "edges"> {
  edges: FlowEdge[];
}

export interface FlowResult {
  graph: FlowGraph;
  totalJourneys: number;
  maxCount: number;
}

interface RouteQueueEntry {
  distance: number;
  key: string;
}

interface Neighbor {
  domain: string;
  edgeIndex: number;
  pages: number;
  trunk: boolean;
}

class RouteQueue {
  private entries: RouteQueueEntry[] = [];

  push(entry: RouteQueueEntry): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.entries[parent], entry) <= 0) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): RouteQueueEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!first || !last || this.entries.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.entries.length) break;
      const child =
        right < this.entries.length &&
        this.compare(this.entries[right], this.entries[left]) < 0
          ? right
          : left;
      if (this.compare(last, this.entries[child]) <= 0) break;
      this.entries[index] = this.entries[child];
      index = child;
    }
    this.entries[index] = last;
    return first;
  }

  private compare(left: RouteQueueEntry, right: RouteQueueEntry): number {
    return left.distance - right.distance || left.key.localeCompare(right.key);
  }
}

function stateKey(domain: string, phase: RoutePhase): string {
  return `${phase}\0${domain}`;
}

function buildAdjacency(graph: GalaxyGraph): Map<string, Neighbor[]> {
  const adjacency = new Map(
    graph.nodes.map((node) => [node.id, [] as Neighbor[]]),
  );
  const edgeIndexes = new Map<string, number>();
  graph.edges.forEach((edge, edgeIndex) => {
    const key = [edge.source, edge.target].sort().join("\0");
    if (edgeIndexes.has(key)) {
      throw new Error(`Duplicate merged edge: ${edge.source} - ${edge.target}`);
    }
    edgeIndexes.set(key, edgeIndex);
    const sourceNeighbors = adjacency.get(edge.source);
    const targetNeighbors = adjacency.get(edge.target);
    if (!sourceNeighbors || !targetNeighbors) {
      throw new Error(`Unknown edge endpoint: ${edge.source} - ${edge.target}`);
    }
    if (edge.jumps > 0) {
      sourceNeighbors.push({
        domain: edge.target,
        edgeIndex,
        pages: edge.jumps,
        trunk: edge.trunk,
      });
    }
    if (edge.back > 0) {
      targetNeighbors.push({
        domain: edge.source,
        edgeIndex,
        pages: edge.back,
        trunk: edge.trunk,
      });
    }
  });
  for (const neighbors of adjacency.values()) {
    neighbors.sort(
      (left, right) =>
        left.domain.localeCompare(right.domain) ||
        left.edgeIndex - right.edgeIndex,
    );
  }
  return adjacency;
}

function traceSource(
  source: string,
  destinations: string[],
  adjacency: Map<string, Neighbor[]>,
  kindByDomain: Map<string, GalaxyGraph["nodes"][number]["kind"]>,
  flow: number[],
): number {
  const startKey = stateKey(source, "access");
  const distances = new Map<string, number>([[startKey, 0]]);
  const previous = new Map<string, string>();
  const previousEdge = new Map<string, number>();
  const settled = new Set<string>();
  const queue = new RouteQueue();
  queue.push({ distance: 0, key: startKey });

  while (true) {
    const entry = queue.pop();
    if (!entry) break;
    if (
      settled.has(entry.key) ||
      entry.distance !== distances.get(entry.key)
    ) {
      continue;
    }
    settled.add(entry.key);
    const separator = entry.key.indexOf("\0");
    const phase = entry.key.slice(0, separator) as RoutePhase;
    const current = entry.key.slice(separator + 1);
    if (kindByDomain.get(current) === "hub" && current !== source) continue;

    const neighbors = adjacency.get(current);
    if (!neighbors) throw new Error(`Unknown route node: ${current}`);
    for (const neighbor of neighbors) {
      let nextPhase: RoutePhase;
      if (neighbor.trunk) {
        if (phase === "egress") continue;
        nextPhase = "ride";
      } else {
        nextPhase = phase === "ride" ? "egress" : phase;
      }
      const nextKey = stateKey(neighbor.domain, nextPhase);
      if (settled.has(nextKey)) continue;
      const pages =
        kindByDomain.get(current) === "interchange"
          ? Math.min(neighbor.pages, 1)
          : neighbor.pages;
      const candidate =
        entry.distance +
        (neighbor.trunk ? 1 : 1.6) +
        1 / Math.log2(2 + pages);
      if (candidate < (distances.get(nextKey) ?? Infinity)) {
        distances.set(nextKey, candidate);
        previous.set(nextKey, entry.key);
        previousEdge.set(nextKey, neighbor.edgeIndex);
        queue.push({ distance: candidate, key: nextKey });
      }
    }
  }

  let journeys = 0;
  for (const destination of destinations) {
    if (destination === source) continue;
    const destinationKey = PHASES.map((phase) => stateKey(destination, phase))
      .sort(
        (left, right) =>
          (distances.get(left) ?? Infinity) -
            (distances.get(right) ?? Infinity) ||
          left.localeCompare(right),
      )[0];
    if ((distances.get(destinationKey) ?? Infinity) === Infinity) continue;
    journeys++;
    const usedEdges = new Set<number>();
    let currentKey = destinationKey;
    while (currentKey !== startKey) {
      const edgeIndex = previousEdge.get(currentKey);
      const priorKey = previous.get(currentKey);
      if (edgeIndex === undefined || priorKey === undefined) {
        throw new Error(`Incomplete route from ${source} to ${destination}`);
      }
      usedEdges.add(edgeIndex);
      currentKey = priorKey;
    }
    for (const edgeIndex of usedEdges) flow[edgeIndex]++;
  }
  return journeys;
}

export function computeFlow(graph: GalaxyGraph): FlowResult {
  const destinations = graph.nodes.map((node) => node.id).sort();
  const kindByDomain = new Map(
    graph.nodes.map((node) => [node.id, node.kind]),
  );
  const adjacency = buildAdjacency(graph);
  const sources = destinations.filter(
    (domain) => adjacency.get(domain)!.length > 0,
  );
  const flow = graph.edges.map(() => 0);
  let totalJourneys = 0;
  for (const source of sources) {
    totalJourneys += traceSource(
      source,
      destinations,
      adjacency,
      kindByDomain,
      flow,
    );
  }
  const maxCount = Math.max(0, ...flow);
  const denominator = Math.log1p(maxCount);
  return {
    graph: {
      ...graph,
      edges: graph.edges.map((edge, index) => ({
        ...edge,
        flow: flow[index],
        flow01:
          denominator === 0
            ? 0
            : Number((Math.log1p(flow[index]) / denominator).toFixed(3)),
      })),
    },
    totalJourneys,
    maxCount,
  };
}

export function flowDeciles(edges: FlowEdge[]): number[] {
  const bins = Array.from({ length: 10 }, () => 0);
  for (const edge of edges) {
    bins[Math.min(9, Math.floor(edge.flow01 * 10))]++;
  }
  return bins;
}

function main(): void {
  const startedAt = performance.now();
  const graph = JSON.parse(readFileSync(GRAPH_PATH, "utf-8")) as GalaxyGraph;
  const result = computeFlow(graph);
  writeFileSync(GRAPH_PATH, `${JSON.stringify(result.graph, null, 2)}\n`);
  console.log(`total journeys traced: ${result.totalJourneys}`);
  console.log("flow01 deciles:");
  flowDeciles(result.graph.edges).forEach((count, index) => {
    const lower = (index / 10).toFixed(1);
    const upper = ((index + 1) / 10).toFixed(1);
    const closing = index === 9 ? "]" : ")";
    console.log(`  [${lower}, ${upper}${closing}: ${count}`);
  });
  console.log("top 15 river edges:");
  result.graph.edges
    .map((edge, index) => ({ edge, index }))
    .sort(
      (left, right) =>
        right.edge.flow - left.edge.flow ||
        left.edge.source.localeCompare(right.edge.source) ||
        left.edge.target.localeCompare(right.edge.target) ||
        left.index - right.index,
    )
    .slice(0, 15)
    .forEach(({ edge }) => {
      console.log(`  ${edge.source} - ${edge.target}: ${edge.flow}`);
    });
  console.log(
    `runtime: ${((performance.now() - startedAt) / 1000).toFixed(2)}s`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
