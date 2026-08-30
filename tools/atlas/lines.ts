// ABOUTME: Decomposes the atlas trunk graph into deterministic transit lines.
// ABOUTME: Writes line metadata and narrates transit-constrained routes.

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  transitShortestPath,
  type GalaxyEdge,
  type GalaxyGraph,
  type PathLeg,
} from "./snowball";

declare global {
  interface ImportMeta {
    readonly dir: string;
    readonly main: boolean;
  }
}

const DEFAULT_GRAPH_PATH = path.join(
  import.meta.dir,
  "out",
  "galaxy-graph.json",
);
const DEFAULT_LINES_PATH = path.join(import.meta.dir, "out", "lines.json");
const DEFAULT_MIN_LINE_EDGES = 5;
const CONNECTOR_MIN_LINE_EDGES = 4;
const MAX_LINE_STOPS = 16;

export const LINE_COLORS = [
  "#A65D57",
  "#B0783C",
  "#A18A3F",
  "#6F8A4A",
  "#3F8B6C",
  "#3F8790",
  "#4D78A8",
  "#6B6FA8",
  "#8063A0",
  "#9A5E8A",
  "#A75F72",
  "#8A6F5A",
] as const;

export interface TransitLine {
  id: string;
  name: string;
  color: string;
  loop: boolean;
  stops: string[];
  sharedWith: string[];
}

export interface TransitInterchange {
  domain: string;
  lines: string[];
}

export interface TransitLinesFile {
  meta: {
    generatedAt: string;
    totalLines: number;
    coverage: number;
  };
  lines: TransitLine[];
  interchanges: TransitInterchange[];
}

interface WeightedEdge extends GalaxyEdge {
  key: string;
  flow01: number;
}

interface Neighbor {
  domain: string;
  edge: WeightedEdge;
}

interface LineDraft {
  stops: string[];
  edgeKeys: string[];
}

interface RideSegment {
  line: TransitLine;
  stops: string[];
}

type RouteMode = "express" | "local";

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function edgeKey(left: string, right: string): string {
  return left < right ? `${left}\0${right}` : `${right}\0${left}`;
}

function compareEdges(left: WeightedEdge, right: WeightedEdge): number {
  return (
    right.flow01 - left.flow01 ||
    left.source.localeCompare(right.source) ||
    left.target.localeCompare(right.target)
  );
}

function canonicalStops(stops: string[]): string[] {
  const reversed = [...stops].reverse();
  return stops.join("\0") <= reversed.join("\0") ? stops : reversed;
}

function makeAdjacency(
  nodes: Iterable<string>,
  edges: Iterable<WeightedEdge>,
): Map<string, Neighbor[]> {
  const adjacency = new Map(
    [...nodes].map((domain) => [domain, [] as Neighbor[]]),
  );
  for (const edge of edges) {
    adjacency.get(edge.source)!.push({ domain: edge.target, edge });
    adjacency.get(edge.target)!.push({ domain: edge.source, edge });
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort(
      (left, right) =>
        compareEdges(left.edge, right.edge) ||
        left.domain.localeCompare(right.domain),
    );
  }
  return adjacency;
}

function sharedEdgeCount(edgeKeys: string[], claimed: Set<string>): number {
  return edgeKeys.reduce((count, key) => count + Number(claimed.has(key)), 0);
}

function minimumLineEdges(
  stops: string[],
  nodeByDomain: Map<string, GalaxyGraph["nodes"][number]>,
): number {
  return stops.some((stop) => {
    const kind = nodeByDomain.get(stop)!.kind;
    return kind === "seed" || kind === "interchange";
  })
    ? CONNECTOR_MIN_LINE_EDGES
    : DEFAULT_MIN_LINE_EDGES;
}

function medianFlow(
  edgeKeys: string[],
  edgeByKey: Map<string, WeightedEdge>,
): number {
  const flows = edgeKeys
    .map((key) => edgeByKey.get(key)!.flow01)
    .sort((left, right) => left - right);
  const middle = Math.floor(flows.length / 2);
  return flows.length % 2 === 1
    ? flows[middle]
    : (flows[middle - 1] + flows[middle]) / 2;
}

function enforceSharedEdgeCap(
  stops: string[],
  edgeKeys: string[],
  seedIndex: number,
  claimed: Set<string>,
  edgeByKey: Map<string, WeightedEdge>,
  nodeByDomain: Map<string, GalaxyGraph["nodes"][number]>,
): LineDraft | null {
  if (sharedEdgeCount(edgeKeys, claimed) * 2 <= edgeKeys.length) {
    return { stops, edgeKeys };
  }

  let best: LineDraft | null = null;
  let bestFlow = -1;
  for (let start = 0; start <= seedIndex; start++) {
    let shared = 0;
    let flow = 0;
    for (let end = start; end < edgeKeys.length; end++) {
      const key = edgeKeys[end];
      shared += Number(claimed.has(key));
      flow += edgeByKey.get(key)!.flow01;
      const length = end - start + 1;
      const candidateStops = stops.slice(start, end + 2);
      if (
        end < seedIndex ||
        candidateStops.length - 1 <
          minimumLineEdges(candidateStops, nodeByDomain)
      ) {
        continue;
      }
      if (shared * 2 > length) continue;
      const candidate = {
        stops: candidateStops,
        edgeKeys: edgeKeys.slice(start, end + 1),
      };
      if (
        best === null ||
        candidate.edgeKeys.length > best.edgeKeys.length ||
        (candidate.edgeKeys.length === best.edgeKeys.length &&
          flow > bestFlow) ||
        (candidate.edgeKeys.length === best.edgeKeys.length &&
          flow === bestFlow &&
          canonicalStops(candidate.stops).join("\0") <
            canonicalStops(best.stops).join("\0"))
      ) {
        best = candidate;
        bestFlow = flow;
      }
    }
  }
  return best;
}

function growLine(
  seed: WeightedEdge,
  adjacency: Map<string, Neighbor[]>,
  claimed: Set<string>,
  edgeByKey: Map<string, WeightedEdge>,
  nodeByDomain: Map<string, GalaxyGraph["nodes"][number]>,
): LineDraft | null {
  const stops = [seed.source, seed.target];
  const edgeKeys = [seed.key];
  const usedStops = new Set(stops);
  const usedEdges = new Set(edgeKeys);
  let seedIndex = 0;

  while (stops.length < MAX_LINE_STOPS) {
    const choices: Array<Neighbor & { side: "left" | "right" }> = [];
    const minimumFlow = medianFlow(edgeKeys, edgeByKey) * 0.6;
    for (const side of ["left", "right"] as const) {
      const stop = side === "left" ? stops[0] : stops[stops.length - 1];
      for (const neighbor of adjacency.get(stop) ?? []) {
        if (usedStops.has(neighbor.domain) || usedEdges.has(neighbor.edge.key))
          continue;
        if (neighbor.edge.flow01 < minimumFlow) continue;
        const cluster = nodeByDomain.get(neighbor.domain)!.cluster;
        const sharesCluster = stops.some(
          (lineStop) => nodeByDomain.get(lineStop)!.cluster === cluster,
        );
        const mutual = Math.min(neighbor.edge.jumps, neighbor.edge.back) > 0;
        if (!sharesCluster && !mutual) continue;
        choices.push({ ...neighbor, side });
      }
    }
    choices.sort(
      (left, right) =>
        compareEdges(left.edge, right.edge) ||
        left.side.localeCompare(right.side) ||
        left.domain.localeCompare(right.domain),
    );
    const choice = choices[0];
    if (choice === undefined) break;
    usedStops.add(choice.domain);
    usedEdges.add(choice.edge.key);
    if (choice.side === "left") {
      stops.unshift(choice.domain);
      edgeKeys.unshift(choice.edge.key);
      seedIndex++;
    } else {
      stops.push(choice.domain);
      edgeKeys.push(choice.edge.key);
    }
  }

  return enforceSharedEdgeCap(
    stops,
    edgeKeys,
    seedIndex,
    claimed,
    edgeByKey,
    nodeByDomain,
  );
}

function extractLineDrafts(
  edges: WeightedEdge[],
  nodeByDomain: Map<string, GalaxyGraph["nodes"][number]>,
): LineDraft[] {
  const edgeByKey = new Map(edges.map((edge) => [edge.key, edge]));
  const nodes = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const adjacency = makeAdjacency(nodes, edges);
  const claimed = new Set<string>();
  const rejectedSeeds = new Set<string>();
  const terminusPairs = new Set<string>();
  const drafts: LineDraft[] = [];

  while (true) {
    const seed = edges.find(
      (edge) => !claimed.has(edge.key) && !rejectedSeeds.has(edge.key),
    );
    if (seed === undefined) break;
    const draft = growLine(seed, adjacency, claimed, edgeByKey, nodeByDomain);
    if (
      draft === null ||
      draft.stops.length - 1 < minimumLineEdges(draft.stops, nodeByDomain)
    ) {
      rejectedSeeds.add(seed.key);
      continue;
    }
    const stops = canonicalStops(draft.stops);
    const terminusPair = `${stops[0]}\0${stops[stops.length - 1]}`;
    if (terminusPairs.has(terminusPair)) {
      rejectedSeeds.add(seed.key);
      continue;
    }
    terminusPairs.add(terminusPair);
    drafts.push({
      stops,
      edgeKeys:
        stops === draft.stops ? draft.edgeKeys : [...draft.edgeKeys].reverse(),
    });
    for (const key of draft.edgeKeys) claimed.add(key);
  }
  return drafts;
}

export function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function lineId(stops: string[]): string {
  const termini = [stops[0], stops[stops.length - 1]].sort();
  return `line-${fnv1a(termini.join("\0"))}`;
}

function assignLineNames(
  drafts: LineDraft[],
  nodeByDomain: Map<string, GalaxyGraph["nodes"][number]>,
  visitsFor: (domain: string) => number,
): string[] {
  const usedAnchors = new Set<string>();
  const usedNames = new Set<string>();
  return drafts.map((draft) => {
    const eligibleStops = draft.stops
      .filter((stop) => {
        const kind = nodeByDomain.get(stop)!.kind;
        return kind === "site" || kind === "seed";
      })
      .sort(
        (left, right) =>
          visitsFor(right) - visitsFor(left) || left.localeCompare(right),
      );
    const availableAnchor = eligibleStops.find(
      (stop) => !usedAnchors.has(stop),
    );
    if (availableAnchor !== undefined) {
      const name = `${availableAnchor} line`;
      usedAnchors.add(availableAnchor);
      usedNames.add(name);
      return name;
    }

    const anchor = eligibleStops[0];
    const viaStops = draft.stops
      .filter((stop) => stop !== anchor)
      .sort(
        (left, right) =>
          visitsFor(right) - visitsFor(left) || left.localeCompare(right),
      );
    const viaStop = viaStops.find(
      (stop) => !usedNames.has(`${anchor} line via ${stop}`),
    );
    if (viaStop === undefined) {
      throw new Error(`Cannot assign a unique name to line through ${anchor}`);
    }
    const name = `${anchor} line via ${viaStop}`;
    usedNames.add(name);
    return name;
  });
}

function assignColors(lines: TransitLine[]): void {
  const lineCountAtStop = new Map<string, number>();
  for (const line of lines) {
    for (const stop of new Set(line.stops)) {
      lineCountAtStop.set(stop, (lineCountAtStop.get(stop) ?? 0) + 1);
    }
  }
  const colorsAtStop = new Map<string, number[]>();
  const order = lines.sort(
    (left, right) =>
      Math.max(...right.stops.map((stop) => lineCountAtStop.get(stop)!)) -
        Math.max(...left.stops.map((stop) => lineCountAtStop.get(stop)!)) ||
      right.stops.reduce(
        (total, stop) => total + lineCountAtStop.get(stop)!,
        0,
      ) -
        left.stops.reduce(
          (total, stop) => total + lineCountAtStop.get(stop)!,
          0,
        ) ||
      left.id.localeCompare(right.id),
  );
  for (const line of order) {
    const color = LINE_COLORS.map((_, colorIndex) => ({
      colorIndex,
      conflicts: line.stops.reduce(
        (total, stop) => total + (colorsAtStop.get(stop)?.[colorIndex] ?? 0),
        0,
      ),
    })).sort(
      (left, right) =>
        left.conflicts - right.conflicts || left.colorIndex - right.colorIndex,
    )[0].colorIndex;
    line.color = LINE_COLORS[color];
    for (const stop of new Set(line.stops)) {
      const counts = colorsAtStop.get(stop) ?? LINE_COLORS.map(() => 0);
      counts[color]++;
      colorsAtStop.set(stop, counts);
    }
  }
}

export function extractLines(graph: GalaxyGraph): TransitLinesFile {
  const nodeByDomain = new Map(graph.nodes.map((node) => [node.id, node]));
  const visitsFor = (domain: string): number => {
    const node = nodeByDomain.get(domain);
    if (!node) {
      throw new Error(`Trunk edge references missing node ${domain}`);
    }
    return node.visits;
  };
  const lineEdges = graph.edges
    .filter((edge) => {
      const sourceKind = nodeByDomain.get(edge.source)?.kind;
      const targetKind = nodeByDomain.get(edge.target)?.kind;
      if (!sourceKind)
        throw new Error(`Graph edge references missing node ${edge.source}`);
      if (!targetKind)
        throw new Error(`Graph edge references missing node ${edge.target}`);
      if (sourceKind === "hub" || targetKind === "hub") return false;
      const flow01 = (edge as GalaxyEdge & { flow01?: number }).flow01;
      return flow01 !== undefined && flow01 >= 0.35;
    })
    .map((edge) => ({
      ...edge,
      key: edgeKey(edge.source, edge.target),
      flow01: (edge as GalaxyEdge & { flow01: number }).flow01,
    }))
    .sort(compareEdges);
  const lineEdgeKeys = new Set(lineEdges.map((edge) => edge.key));
  if (lineEdgeKeys.size !== lineEdges.length) {
    throw new Error("High-flow graph contains duplicate undirected edges");
  }
  const drafts = extractLineDrafts(lineEdges, nodeByDomain).filter((draft) =>
    draft.stops.some((stop) => {
      const kind = nodeByDomain.get(stop)!.kind;
      return kind !== "hub" && kind !== "interchange";
    }),
  );
  const ids = new Set<string>();
  const names = assignLineNames(drafts, nodeByDomain, visitsFor);
  const lines: TransitLine[] = drafts.map((draft, index) => {
    const id = lineId(draft.stops);
    if (ids.has(id)) {
      throw new Error(`Multiple lines resolve to ${id}`);
    }
    ids.add(id);
    return {
      id,
      name: names[index],
      color: "",
      loop: false,
      stops: draft.stops,
      sharedWith: [],
    };
  });
  lines.sort((left, right) => left.id.localeCompare(right.id));
  assignColors(lines);

  const assignedEdges = new Set<string>();
  const linesAtEdge = new Map<string, string[]>();
  const linesAtStop = new Map<string, string[]>();
  for (const line of lines) {
    for (let index = 1; index < line.stops.length; index++) {
      const key = edgeKey(line.stops[index - 1], line.stops[index]);
      if (!lineEdgeKeys.has(key)) {
        throw new Error(`Line ${line.id} contains ineligible edge ${key}`);
      }
      assignedEdges.add(key);
      const lineIds = linesAtEdge.get(key) ?? [];
      lineIds.push(line.id);
      linesAtEdge.set(key, lineIds);
    }
    for (const stop of new Set(line.stops)) {
      const lineIds = linesAtStop.get(stop) ?? [];
      lineIds.push(line.id);
      linesAtStop.set(stop, lineIds);
    }
  }
  const lineById = new Map(lines.map((line) => [line.id, line]));
  for (const lineIds of linesAtEdge.values()) {
    if (lineIds.length < 2) continue;
    for (const lineId of lineIds) {
      const line = lineById.get(lineId)!;
      for (const sharedId of lineIds) {
        if (sharedId !== lineId && !line.sharedWith.includes(sharedId)) {
          line.sharedWith.push(sharedId);
        }
      }
    }
  }
  for (const line of lines) line.sharedWith.sort();
  const interchanges = [...linesAtStop.entries()]
    .filter(([, lineIds]) => lineIds.length >= 2)
    .map(([domain, lineIds]) => ({ domain, lines: lineIds.sort() }))
    .sort((left, right) => left.domain.localeCompare(right.domain));
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      totalLines: lines.length,
      coverage:
        lineEdges.length === 0 ? 1 : assignedEdges.size / lineEdges.length,
    },
    lines,
    interchanges,
  };
}

function linesForHop(
  from: string,
  to: string,
  lines: TransitLine[],
): TransitLine[] {
  return lines
    .filter((line) =>
      line.stops.some(
        (stop, index) =>
          index > 0 &&
          ((line.stops[index - 1] === from && stop === to) ||
            (line.stops[index - 1] === to && stop === from)),
      ),
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
}

function segmentRides(legs: PathLeg[], lines: TransitLine[]): RideSegment[] {
  const segments: RideSegment[] = [];
  let index = 0;
  while (index < legs.length) {
    const leg = legs[index];
    if (leg.kind !== "ride") {
      index++;
      continue;
    }
    let candidates = linesForHop(leg.from, leg.to, lines);
    if (candidates.length === 0) {
      throw new Error(`No line serves trunk hop ${leg.from} to ${leg.to}`);
    }
    let end = index + 1;
    while (end < legs.length && legs[end].kind === "ride") {
      const nextIds = new Set(
        linesForHop(legs[end].from, legs[end].to, lines).map((line) => line.id),
      );
      const shared = candidates.filter((line) => nextIds.has(line.id));
      if (shared.length === 0) break;
      candidates = shared;
      end++;
    }
    segments.push({
      line: candidates[0],
      stops: [leg.from, ...legs.slice(index, end).map((rideLeg) => rideLeg.to)],
    });
    index = end;
  }
  return segments;
}

function narrateWalk(legs: PathLeg[]): string {
  const intermediate = legs.slice(0, -1).map((leg) => leg.to);
  const via = intermediate.length > 0 ? ` via ${intermediate.join(", ")}` : "";
  return `Walk from ${legs[0].from} to ${legs[legs.length - 1].to}${via}`;
}

function lineConstrainedGraph(
  graph: GalaxyGraph,
  lines: TransitLine[],
): GalaxyGraph {
  const rideEdges = new Set<string>();
  for (const line of lines) {
    for (let index = 1; index < line.stops.length; index++) {
      rideEdges.add(edgeKey(line.stops[index - 1], line.stops[index]));
    }
  }
  return {
    ...graph,
    edges: graph.edges.map((edge) => ({
      ...edge,
      trunk: rideEdges.has(edgeKey(edge.source, edge.target)),
    })),
  };
}

export function narrateRoute(
  graph: GalaxyGraph,
  lineFile: TransitLinesFile,
  from: string,
  to: string,
  mode: RouteMode,
): string {
  const route = transitShortestPath(
    lineConstrainedGraph(graph, lineFile.lines),
    from,
    to,
  );
  if (route.path.length === 0) return `No route from ${from} to ${to}`;
  if (route.legs.length === 0) return `Already at ${to}`;

  const firstRide = route.legs.findIndex((leg) => leg.kind === "ride");
  const lastRide = route.legs.findLastIndex((leg) => leg.kind === "ride");
  if (firstRide < 0) {
    return `${narrateWalk(route.legs)} -> arrive ${to}`;
  }
  const parts: string[] = [];
  if (firstRide > 0) parts.push(narrateWalk(route.legs.slice(0, firstRide)));
  const rides = segmentRides(
    route.legs.slice(firstRide, lastRide + 1),
    lineFile.lines,
  );
  rides.forEach((ride, index) => {
    const stopCount = ride.stops.length - 1;
    const action =
      index === 0
        ? `Board the ${ride.line.name} at ${ride.stops[0]}`
        : `transfer at ${ride.stops[0]} to the ${ride.line.name}`;
    let text = `${action} -> ride ${stopCount} ${stopCount === 1 ? "stop" : "stops"}`;
    if (mode === "local" && ride.stops.length > 2) {
      text += `, calling at ${ride.stops.slice(1, -1).join(", ")}`;
    }
    parts.push(text);
  });
  if (lastRide < route.legs.length - 1) {
    parts.push(narrateWalk(route.legs.slice(lastRide + 1)));
  }
  parts.push(`arrive ${to}`);
  return parts.join(" -> ");
}

function routeDomains(args: string[]): [string, string] {
  const routeIndex = args.indexOf("--route");
  const from = args[routeIndex + 1];
  const to = args[routeIndex + 2];
  if (!from || !to || from.startsWith("--") || to.startsWith("--")) {
    throw new Error("--route requires from and to domains");
  }
  return [from.toLowerCase(), to.toLowerCase()];
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function runExtraction(args: string[]): void {
  const graphPath = path.resolve(
    flagValue(args, "--graph") ?? DEFAULT_GRAPH_PATH,
  );
  const outputPath = path.resolve(
    flagValue(args, "--lines") ?? DEFAULT_LINES_PATH,
  );
  const lineFile = extractLines(readJson<GalaxyGraph>(graphPath));
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(lineFile, null, 2) + "\n");
  console.log(
    `wrote ${lineFile.meta.totalLines} lines with ` +
      `${(lineFile.meta.coverage * 100).toFixed(2)}% high-flow coverage to ${outputPath}`,
  );
}

function runRoute(args: string[]): void {
  const [from, to] = routeDomains(args);
  const graphPath = flagValue(args, "--graph");
  const linesPath = flagValue(args, "--lines");
  const mode = flagValue(args, "--mode");
  if (!graphPath) throw new Error("--graph is required in route mode");
  if (!linesPath) throw new Error("--lines is required in route mode");
  if (mode !== "express" && mode !== "local") {
    throw new Error("--mode must be express or local");
  }
  console.log(
    narrateRoute(
      readJson<GalaxyGraph>(path.resolve(graphPath)),
      readJson<TransitLinesFile>(path.resolve(linesPath)),
      from,
      to,
      mode,
    ),
  );
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--route")) runRoute(args);
  else runExtraction(args);
}

if (import.meta.main) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
