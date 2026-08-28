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
const MIN_LINE_STOPS = 4;

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
  weight: number;
}

interface Neighbor {
  domain: string;
  edge: WeightedEdge;
}

interface PathCandidate {
  stops: string[];
  weight: number;
}

interface LineDraft {
  stops: string[];
}

interface ComponentTask {
  edges: Map<string, WeightedEdge>;
  candidate: PathCandidate;
}

class RankedQueue<T> {
  private values: T[] = [];

  constructor(private compare: (left: T, right: T) => number) {}

  push(value: T): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.values[parent], value) <= 0) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): T | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (first === undefined || last === undefined || this.values.length === 0) {
      return first;
    }
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child =
        right < this.values.length &&
        this.compare(this.values[right], this.values[left]) < 0
          ? right
          : left;
      if (this.compare(last, this.values[child]) <= 0) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
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

function edgeWeight(edge: GalaxyEdge): number {
  return 4 * Math.min(edge.jumps, edge.back) + Math.max(edge.jumps, edge.back);
}

function compareEdges(left: WeightedEdge, right: WeightedEdge): number {
  return (
    right.weight - left.weight ||
    left.source.localeCompare(right.source) ||
    left.target.localeCompare(right.target)
  );
}

function canonicalStops(stops: string[]): string[] {
  const reversed = [...stops].reverse();
  return stops.join("\0") <= reversed.join("\0") ? stops : reversed;
}

function compareCandidates(left: PathCandidate, right: PathCandidate): number {
  return (
    right.weight - left.weight ||
    right.stops.length - left.stops.length ||
    canonicalStops(left.stops)
      .join("\0")
      .localeCompare(canonicalStops(right.stops).join("\0"))
  );
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

function splitComponents(
  availableEdges: Map<string, WeightedEdge>,
): Map<string, WeightedEdge>[] {
  const nodes = new Set<string>();
  for (const edge of availableEdges.values()) {
    nodes.add(edge.source);
    nodes.add(edge.target);
  }
  const adjacency = makeAdjacency(nodes, availableEdges.values());
  const unseen = new Set(nodes);
  const componentByDomain = new Map<string, number>();
  let componentIndex = 0;
  for (const start of [...nodes].sort()) {
    if (!unseen.has(start)) continue;
    const pending = [start];
    unseen.delete(start);
    while (pending.length > 0) {
      const current = pending.pop()!;
      componentByDomain.set(current, componentIndex);
      for (const neighbor of adjacency.get(current)!) {
        if (!unseen.delete(neighbor.domain)) continue;
        pending.push(neighbor.domain);
      }
    }
    componentIndex++;
  }
  const components = Array.from(
    { length: componentIndex },
    () => new Map<string, WeightedEdge>(),
  );
  for (const edge of availableEdges.values()) {
    components[componentByDomain.get(edge.source)!].set(edge.key, edge);
  }
  return components;
}

function sweepTree(
  start: string,
  component: Set<string>,
  adjacency: Map<string, Neighbor[]>,
): PathCandidate {
  const visited = new Set([start]);
  const parent = new Map<string, string>();
  const distances = new Map<string, number>([[start, 0]]);
  const depths = new Map<string, number>([[start, 0]]);
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const neighbors = adjacency.get(current) ?? [];
    for (let index = neighbors.length - 1; index >= 0; index--) {
      const neighbor = neighbors[index];
      if (!component.has(neighbor.domain) || visited.has(neighbor.domain)) {
        continue;
      }
      visited.add(neighbor.domain);
      parent.set(neighbor.domain, current);
      distances.set(
        neighbor.domain,
        distances.get(current)! + neighbor.edge.weight,
      );
      depths.set(neighbor.domain, depths.get(current)! + 1);
      pending.push(neighbor.domain);
    }
  }
  const end = [...visited].sort(
    (left, right) =>
      distances.get(right)! - distances.get(left)! ||
      depths.get(right)! - depths.get(left)! ||
      left.localeCompare(right),
  )[0];
  const stops = [end];
  let current = end;
  while (current !== start) {
    current = parent.get(current)!;
    stops.push(current);
  }
  stops.reverse();
  return { stops, weight: distances.get(end)! };
}

function maximumWeightForest(edges: WeightedEdge[]): Set<string> {
  const parent = new Map<string, string>();
  const find = (domain: string): string => {
    const current = parent.get(domain) ?? domain;
    if (current === domain) {
      parent.set(domain, domain);
      return domain;
    }
    const root = find(current);
    parent.set(domain, root);
    return root;
  };
  const forest = new Set<string>();
  for (const edge of [...edges].sort(compareEdges)) {
    const sourceRoot = find(edge.source);
    const targetRoot = find(edge.target);
    if (sourceRoot === targetRoot) continue;
    parent.set(targetRoot, sourceRoot);
    forest.add(edge.key);
  }
  return forest;
}

// The longest-path heuristic first breaks cycles with a deterministic maximum-
// weight spanning forest, then takes exact weighted diameters from its residual trees.
function makeComponentTask(edges: Map<string, WeightedEdge>): ComponentTask {
  const nodes = new Set<string>();
  for (const edge of edges.values()) {
    nodes.add(edge.source);
    nodes.add(edge.target);
  }
  const domains = [...nodes].sort();
  const adjacency = makeAdjacency(domains, edges.values());
  const component = new Set(domains);
  const firstSweep = sweepTree(domains[0], component, adjacency);
  return {
    edges,
    candidate: sweepTree(
      firstSweep.stops[firstSweep.stops.length - 1],
      component,
      adjacency,
    ),
  };
}

function extractLineDrafts(
  availableEdges: Map<string, WeightedEdge>,
): LineDraft[] {
  const lines: LineDraft[] = [];
  const forestKeys = maximumWeightForest([...availableEdges.values()]);
  const forestEdges = new Map<string, WeightedEdge>();
  for (const key of forestKeys) {
    forestEdges.set(key, availableEdges.get(key)!);
    availableEdges.delete(key);
  }
  const tasks = new RankedQueue<ComponentTask>((left, right) =>
    compareCandidates(left.candidate, right.candidate),
  );
  for (const component of splitComponents(forestEdges)) {
    tasks.push(makeComponentTask(component));
  }
  while (true) {
    const task = tasks.pop();
    if (!task) break;
    if (task.candidate.stops.length < MIN_LINE_STOPS) {
      for (const edge of task.edges.values()) {
        availableEdges.set(edge.key, edge);
      }
      continue;
    }
    const stops = canonicalStops(task.candidate.stops);
    for (let index = 1; index < stops.length; index++) {
      task.edges.delete(edgeKey(stops[index - 1], stops[index]));
    }
    lines.push({ stops });
    for (const component of splitComponents(task.edges)) {
      tasks.push(makeComponentTask(component));
    }
  }
  return lines;
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
  const allTrunkEdges = graph.edges.filter((edge) => edge.trunk);
  const lineEdges = allTrunkEdges
    .filter((edge) => {
      const sourceKind = nodeByDomain.get(edge.source)?.kind;
      const targetKind = nodeByDomain.get(edge.target)?.kind;
      if (!sourceKind)
        throw new Error(`Trunk edge references missing node ${edge.source}`);
      if (!targetKind)
        throw new Error(`Trunk edge references missing node ${edge.target}`);
      if (sourceKind === "hub" || targetKind === "hub") return false;
      const touchesInterchange =
        sourceKind === "interchange" || targetKind === "interchange";
      return !touchesInterchange || Math.min(edge.jumps, edge.back) > 0;
    })
    .map((edge) => ({
      ...edge,
      key: edgeKey(edge.source, edge.target),
      weight: edgeWeight(edge),
    }))
    .sort(compareEdges);
  const trunkKeys = new Set(
    allTrunkEdges.map((edge) => edgeKey(edge.source, edge.target)),
  );
  if (trunkKeys.size !== allTrunkEdges.length) {
    throw new Error("Trunk graph contains duplicate undirected edges");
  }
  const lineEdgeKeys = new Set(lineEdges.map((edge) => edge.key));
  const availableEdges = new Map(lineEdges.map((edge) => [edge.key, edge]));
  const drafts = extractLineDrafts(availableEdges).filter((draft) =>
    draft.stops.some((stop) => {
      const kind = nodeByDomain.get(stop)!.kind;
      return kind !== "hub" && kind !== "interchange";
    }),
  );
  const ids = new Set<string>();
  const names = assignLineNames(drafts, nodeByDomain, visitsFor);
  const lines = drafts.map((draft, index) => {
    const id = lineId(draft.stops);
    if (!ids.add(id)) {
      throw new Error(`Multiple lines resolve to ${id}`);
    }
    return {
      id,
      name: names[index],
      color: "",
      loop: false,
      stops: draft.stops,
    };
  });
  lines.sort((left, right) => left.id.localeCompare(right.id));
  assignColors(lines);

  const assignedEdges = new Set<string>();
  const linesAtStop = new Map<string, string[]>();
  for (const line of lines) {
    for (let index = 1; index < line.stops.length; index++) {
      const key = edgeKey(line.stops[index - 1], line.stops[index]);
      if (!lineEdgeKeys.has(key)) {
        throw new Error(`Line ${line.id} contains ineligible edge ${key}`);
      }
      if (!assignedEdges.add(key)) {
        throw new Error(`Trunk edge ${key} belongs to multiple lines`);
      }
    }
    for (const stop of new Set(line.stops)) {
      const lineIds = linesAtStop.get(stop) ?? [];
      lineIds.push(line.id);
      linesAtStop.set(stop, lineIds);
    }
  }
  const interchanges = [...linesAtStop.entries()]
    .filter(([, lineIds]) => lineIds.length >= 2)
    .map(([domain, lineIds]) => ({ domain, lines: lineIds.sort() }))
    .sort((left, right) => left.domain.localeCompare(right.domain));
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      totalLines: lines.length,
      coverage:
        allTrunkEdges.length === 0
          ? 1
          : assignedEdges.size / allTrunkEdges.length,
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
      `${(lineFile.meta.coverage * 100).toFixed(2)}% trunk coverage to ${outputPath}`,
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
