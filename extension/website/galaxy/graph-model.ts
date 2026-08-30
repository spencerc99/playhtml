// ABOUTME: Graph contract, seeded PRNG, grouping hierarchy, and shortest-path search.
// ABOUTME: Pure data logic with no DOM or React, so the map component stays Fast-Refreshable.

// ---------------------------------------------------------------------------
// Data contract
// ---------------------------------------------------------------------------

/** How a domain entered the crawl. Drives its marker on the map. */
export type NodeKind = "seed" | "hub" | "site" | "interchange";

export interface GraphNode {
  id: string;
  /** Distinct inbound linking domains. Narrow range (about 1-10) in crawl data. */
  visits: number;
  participants: number;
  dwellMs: number;
  cluster: number;
  /** Absent in older fixtures; treated as "site". */
  kind?: NodeKind;
}

/**
 * Merged per unordered pair: `source` is lexicographically smaller, `jumps`
 * counts pages linking source->target and `back` the reverse (0 means one-way).
 * `trunk` marks backbone membership. All three are optional so v1 exports,
 * which carried only `jumps`, still load — they read as one-way, off-backbone.
 */
export interface GraphEdge {
  source: string;
  target: string;
  jumps: number;
  back?: number;
  trunk?: boolean;
  /** Absent in crawl exports, which have no per-route participant counts. */
  participants?: number;
  /**
   * Raw link-journeys travelling this road. Drainage: how much of the map's
   * traffic the road actually carries, which is what makes some roads rivers
   * and most of them capillaries.
   */
  flow?: number;
  /** `flow` log-normalized to 0..1 across the export. */
  flow01?: number;
}

export function edgeFlow(edge: GraphEdge): number {
  return edge.flow ?? 0;
}

export function edgeBack(edge: GraphEdge): number {
  return edge.back ?? 0;
}

export function isTrunk(edge: GraphEdge): boolean {
  return edge.trunk === true;
}

/** True when the pair links both ways, so it can be travelled in either. */
export function isMutual(edge: GraphEdge): boolean {
  return edgeBack(edge) > 0;
}

/** Pages linking `from` to `to`, honouring the merged edge's direction. */
export function directionalPages(
  edge: GraphEdge,
  from: string,
): number {
  return from === edge.source ? edge.jumps : edgeBack(edge);
}

export interface GraphCluster {
  id: number;
  size: number;
  label: string;
}

/**
 * Only `generatedAt` is relied on. Totals vary between hand-built fixtures and
 * crawl exports, so counts are derived from nodes/edges instead.
 */
export interface GraphMeta {
  generatedAt: string;
  [key: string]: unknown;
}

export interface Graph {
  meta: GraphMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
}

export function nodeKind(node: GraphNode): NodeKind {
  return node.kind ?? "site";
}

// ---------------------------------------------------------------------------
// Seeded PRNG — same data always produces the same map.
// ---------------------------------------------------------------------------

export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash for seeding per-entity randomness from a string key. */
export function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Grouping hierarchy
// ---------------------------------------------------------------------------

/** How aggressively domains are merged into shared stops. */
export const GROUP_LEVELS = 4;

export interface GroupStop {
  /** Stable id: the representative member's domain. */
  id: string;
  /** Members folded into this stop, representative first. */
  members: GraphNode[];
  representative: GraphNode;
  cluster: number;
  kind: NodeKind;
  /** Summed visits across members, used for the size ramp. */
  visits: number;
}

export interface GroupEdge {
  source: string;
  target: string;
  /** Summed source->target pages across every underlying route. */
  jumps: number;
  /** Summed target->source pages; 0 means the merged pair is one-way. */
  back: number;
  /** True when any underlying route is on the backbone. */
  trunk: boolean;
  /**
   * Summed journeys across every underlying route. Drainage is additive: when
   * grouping merges stops, the roads between them merge into one channel
   * carrying the combined traffic, exactly as tributaries do.
   */
  flow: number;
  /**
   * `flow` log-normalized to 0..1 within this level. Recomputed per level
   * rather than inherited, because summing changes the maximum — reusing the
   * export's normalization would wash the grouped levels out.
   */
  flow01: number;
}

export interface GroupLevel {
  stops: GroupStop[];
  edges: GroupEdge[];
  /** Domain id to the stop containing it, for camera and selection continuity. */
  stopOf: Map<string, string>;
}

interface Adjacency {
  degree: Map<string, number>;
  neighbors: Map<string, Array<{ id: string; jumps: number }>>;
}

function buildAdjacency(graph: Graph): Adjacency {
  const degree = new Map<string, number>();
  const neighbors = new Map<string, Array<{ id: string; jumps: number }>>();
  for (const node of graph.nodes) {
    degree.set(node.id, 0);
    neighbors.set(node.id, []);
  }
  for (const edge of graph.edges) {
    const from = neighbors.get(edge.source);
    const to = neighbors.get(edge.target);
    if (!from || !to) {
      throw new Error(
        `edge ${edge.source} -> ${edge.target} references a missing node`,
      );
    }
    from.push({ id: edge.target, jumps: edge.jumps });
    to.push({ id: edge.source, jumps: edge.jumps });
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return { degree, neighbors };
}

/**
 * Rank for choosing which member represents a merged stop: seeds always win so
 * crawl origins stay findable, then well-linked domains, then alphabetical so
 * the choice never depends on input ordering.
 */
function representativeRank(node: GraphNode, degree: number): number {
  // Seeds always win so crawl origins stay findable; interchanges outrank
  // ordinary sites so a directory names the stop that absorbs its fringe.
  const kind = nodeKind(node);
  const kindBonus = kind === "seed" ? 1e9 : kind === "interchange" ? 1e8 : 0;
  return kindBonus + node.visits * 1000 + degree;
}

function pickRepresentative(
  members: GraphNode[],
  degree: Map<string, number>,
): GraphNode {
  let best = members[0];
  if (!best) throw new Error("cannot pick a representative from an empty stop");
  for (const candidate of members) {
    const a = representativeRank(candidate, degree.get(candidate.id) ?? 0);
    const b = representativeRank(best, degree.get(best.id) ?? 0);
    if (a > b || (a === b && candidate.id < best.id)) best = candidate;
  }
  return best;
}

/** Collapse an assignment of domain -> group key into a level. */
function materialize(
  graph: Graph,
  groupKeyOf: Map<string, string>,
  degree: Map<string, number>,
): GroupLevel {
  const byGroup = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const key = groupKeyOf.get(node.id);
    if (key === undefined) {
      throw new Error(`node ${node.id} was never assigned to a group`);
    }
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(node);
    else byGroup.set(key, [node]);
  }

  const stops: GroupStop[] = [];
  const stopOf = new Map<string, string>();
  // Sort group keys so stop order — and therefore draw order — is stable.
  for (const key of [...byGroup.keys()].sort()) {
    const members = byGroup.get(key);
    if (!members) continue;
    const representative = pickRepresentative(members, degree);
    const ordered = [
      representative,
      ...members.filter((m) => m.id !== representative.id),
    ];
    const stop: GroupStop = {
      id: representative.id,
      members: ordered,
      representative,
      cluster: representative.cluster,
      kind: nodeKind(representative),
      visits: members.reduce((sum, m) => sum + m.visits, 0),
    };
    stops.push(stop);
    for (const member of members) stopOf.set(member.id, stop.id);
  }

  // Sum every underlying route between each pair of stops. Grouping can flip
  // which endpoint sorts first, so orient each contribution before adding it:
  // otherwise a merged pair's forward and reverse traffic get swapped.
  const edgeMap = new Map<string, GroupEdge>();
  for (const edge of graph.edges) {
    const a = stopOf.get(edge.source);
    const b = stopOf.get(edge.target);
    if (a === undefined || b === undefined) continue;
    if (a === b) continue;
    const flipped = b < a;
    const lo = flipped ? b : a;
    const hi = flipped ? a : b;
    // `jumps` runs edge.source->edge.target, which maps to a->b.
    const forward = flipped ? edgeBack(edge) : edge.jumps;
    const reverse = flipped ? edge.jumps : edgeBack(edge);
    const key = `${lo} ${hi}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.jumps += forward;
      existing.back += reverse;
      existing.trunk = existing.trunk || isTrunk(edge);
      existing.flow += edgeFlow(edge);
    } else {
      edgeMap.set(key, {
        source: lo,
        target: hi,
        jumps: forward,
        back: reverse,
        trunk: isTrunk(edge),
        flow: edgeFlow(edge),
        flow01: 0,
      });
    }
  }

  // Re-normalize drainage within the level. Log scale because flow spans four
  // orders of magnitude: linear would leave everything but the single busiest
  // corridor at zero width.
  const edges = [...edgeMap.values()];
  let maxFlow = 0;
  for (const edge of edges) if (edge.flow > maxFlow) maxFlow = edge.flow;
  const logMax = Math.log1p(maxFlow);
  for (const edge of edges) {
    edge.flow01 = logMax > 0 ? Math.log1p(edge.flow) / logMax : 0;
  }

  return { stops, edges, stopOf };
}

/**
 * Build every grouping level up front so the slider only switches which cut is
 * active. Merges are driven by connection strength with alphabetical tie-breaks,
 * so the hierarchy is identical on every load.
 *
 * L0 every domain its own stop
 * L1 degree-1 leaves fold into their anchor
 * L2 within-cluster satellites merge toward the cluster's strongest stops
 * L3 one interchange per cluster
 */
export function buildGroupLevels(graph: Graph): GroupLevel[] {
  const { degree, neighbors } = buildAdjacency(graph);

  // --- L0: identity -------------------------------------------------------
  const identity = new Map<string, string>();
  for (const node of graph.nodes) identity.set(node.id, node.id);

  // --- L1: fold degree-1 leaves into their single anchor -------------------
  const leafFolded = new Map<string, string>();
  for (const node of graph.nodes) {
    const links = neighbors.get(node.id) ?? [];
    if ((degree.get(node.id) ?? 0) === 1 && links.length === 1) {
      const anchor = links[0];
      // Only fold into a genuinely larger stop, so two leaves pointing at each
      // other do not collapse into an arbitrary one of the pair.
      if (anchor && (degree.get(anchor.id) ?? 0) > 1) {
        leafFolded.set(node.id, anchor.id);
        continue;
      }
    }
    leafFolded.set(node.id, node.id);
  }
  // Anchors may themselves have been folded; resolve to a settled root.
  const resolve = (map: Map<string, string>, id: string): string => {
    let cursor = id;
    for (let guard = 0; guard < 64; guard++) {
      const next = map.get(cursor);
      if (next === undefined || next === cursor) return cursor;
      cursor = next;
    }
    return cursor;
  };
  const l1 = new Map<string, string>();
  for (const node of graph.nodes) l1.set(node.id, resolve(leafFolded, node.id));

  // --- L2: satellites merge toward the strongest stops in their cluster ----
  // Keep roughly a handful of stops per cluster: the best-connected members
  // stay, everything else attaches to whichever of them it links most strongly.
  const byCluster = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    const bucket = byCluster.get(node.cluster);
    if (bucket) bucket.push(node);
    else byCluster.set(node.cluster, [node]);
  }

  const l2 = new Map<string, string>();
  for (const [cluster, members] of byCluster) {
    const ranked = [...members].sort((a, b) => {
      const ra = representativeRank(a, degree.get(a.id) ?? 0);
      const rb = representativeRank(b, degree.get(b.id) ?? 0);
      if (ra !== rb) return rb - ra;
      return a.id < b.id ? -1 : 1;
    });
    const keepCount = Math.max(1, Math.min(5, Math.round(Math.sqrt(ranked.length) / 1.6)));
    const anchors = ranked.slice(0, keepCount);
    const anchorIds = new Set(anchors.map((a) => a.id));
    for (const node of members) {
      if (anchorIds.has(node.id)) {
        l2.set(node.id, node.id);
        continue;
      }
      // Attach to the anchor this node links to most strongly; fall back to the
      // cluster's top anchor when it has no direct link to any of them.
      let bestAnchor = anchors[0];
      let bestJumps = -1;
      for (const link of neighbors.get(node.id) ?? []) {
        if (!anchorIds.has(link.id)) continue;
        if (
          link.jumps > bestJumps ||
          (link.jumps === bestJumps && bestAnchor && link.id < bestAnchor.id)
        ) {
          bestJumps = link.jumps;
          const found = members.find((m) => m.id === link.id);
          if (found) bestAnchor = found;
        }
      }
      if (!bestAnchor) throw new Error(`cluster ${cluster} has no anchor`);
      l2.set(node.id, bestAnchor.id);
    }
  }

  // --- L3: one interchange per cluster ------------------------------------
  const l3 = new Map<string, string>();
  for (const [, members] of byCluster) {
    const interchange = pickRepresentative(members, degree);
    for (const node of members) l3.set(node.id, interchange.id);
  }

  return [
    materialize(graph, identity, degree),
    materialize(graph, l1, degree),
    materialize(graph, l2, degree),
    materialize(graph, l3, degree),
  ];
}

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

/**
 * Hop-dominant: every hop pays a base transfer cost, so a direct link always
 * beats a multi-hop detour. Strength only discounts within a hop, making
 * well-worn links preferred among paths of equal length. Riding the backbone
 * is cheaper than walking the street mesh.
 */
export const TRUNK_HOP_COST = 1;
export const MESH_HOP_COST = 1.6;

/**
 * Multiplier on a hop that a named line covers. A drawn line is the canonical
 * way through its part of the map, so a trip prefers riding one where the
 * detour is modest — but the discount is deliberately mild, so a genuinely
 * shorter street path still wins rather than every route bending onto a line.
 */
export const LINE_RIDE_DISCOUNT = 0.75;

/**
 * `onLine` is supplied by the caller rather than read from the edge, so this
 * module stays independent of the lines data while still pricing rides.
 */
export function edgeCost(pages: number, trunk: boolean, onLine = false): number {
  const base = trunk ? TRUNK_HOP_COST : MESH_HOP_COST;
  const cost = base + 1 / Math.log2(2 + Math.max(0, pages));
  return onLine ? cost * LINE_RIDE_DISCOUNT : cost;
}

/** Whether the pair of stops is covered by a drawn line, for cost discounting. */
export type LineCoverage = (a: string, b: string) => boolean;

/** One traversable step away from a stop, with the direction resolved. */
export interface Step {
  to: string;
  /** Pages linking the current stop to `to`. */
  pages: number;
  trunk: boolean;
  cost: number;
  /** Backbone steps read as a ride; mesh steps as a walk. */
  mode: "ride" | "walk";
}

/**
 * Every stop reachable in one step, honouring direction: a merged pair can be
 * travelled forward when `jumps` > 0 and backward when `back` > 0.
 */
export function stepsFrom(
  level: GroupLevel,
  stopId: string,
  onLine?: LineCoverage,
): Step[] {
  const steps: Step[] = [];
  for (const edge of level.edges) {
    let to: string | null = null;
    let pages = 0;
    if (edge.source === stopId) {
      to = edge.target;
      pages = edge.jumps;
    } else if (edge.target === stopId) {
      to = edge.source;
      pages = edge.back;
    }
    if (to === null || pages <= 0) continue;
    steps.push({
      to,
      pages,
      trunk: edge.trunk,
      cost: edgeCost(pages, edge.trunk, onLine?.(stopId, to) ?? false),
      mode: edge.trunk ? "ride" : "walk",
    });
  }
  // Stable order so signposts and suggestions never reshuffle between frames.
  steps.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  return steps;
}

/**
 * Adjacency that ignores direction, for the fallback shown when no legal
 * one-way trip exists. Travelling it means going against one-way links, so the
 * route is flagged and drawn dashed.
 */
function buildUndirectedIndex(
  level: GroupLevel,
  onLine?: LineCoverage,
): Map<string, Step[]> {
  const index = new Map<string, Step[]>();
  for (const stop of level.stops) index.set(stop.id, []);
  for (const edge of level.edges) {
    const pages = Math.max(edge.jumps, edge.back);
    const step = {
      pages,
      trunk: edge.trunk,
      cost: edgeCost(pages, edge.trunk, onLine?.(edge.source, edge.target) ?? false),
      mode: (edge.trunk ? "ride" : "walk") as "ride" | "walk",
    };
    index.get(edge.source)?.push({ ...step, to: edge.target });
    index.get(edge.target)?.push({ ...step, to: edge.source });
  }
  return index;
}

/** Adjacency for routing, built once per level rather than per query. */
export function buildRoutingIndex(
  level: GroupLevel,
  onLine?: LineCoverage,
): Map<string, Step[]> {
  const index = new Map<string, Step[]>();
  for (const stop of level.stops) index.set(stop.id, []);
  for (const edge of level.edges) {
    const covered = onLine?.(edge.source, edge.target) ?? false;
    if (edge.jumps > 0) {
      index.get(edge.source)?.push({
        to: edge.target,
        pages: edge.jumps,
        trunk: edge.trunk,
        cost: edgeCost(edge.jumps, edge.trunk, covered),
        mode: edge.trunk ? "ride" : "walk",
      });
    }
    if (edge.back > 0) {
      index.get(edge.target)?.push({
        to: edge.source,
        pages: edge.back,
        trunk: edge.trunk,
        cost: edgeCost(edge.back, edge.trunk, covered),
        mode: edge.trunk ? "ride" : "walk",
      });
    }
  }
  return index;
}

/** Minimal binary heap; a linear frontier scan is O(n^2) at 9k stops. */
class MinHeap {
  private readonly items: Array<{ id: string; cost: number }> = [];

  get size(): number {
    return this.items.length;
  }

  push(id: string, cost: number): void {
    const items = this.items;
    items.push({ id, cost });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const a = items[i];
      const b = items[parent];
      if (!a || !b || b.cost <= a.cost) break;
      items[i] = b;
      items[parent] = a;
      i = parent;
    }
  }

  pop(): { id: string; cost: number } | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < items.length && (items[l]?.cost ?? Infinity) < (items[best]?.cost ?? Infinity)) best = l;
        if (r < items.length && (items[r]?.cost ?? Infinity) < (items[best]?.cost ?? Infinity)) best = r;
        if (best === i) break;
        const a = items[i];
        const b = items[best];
        if (!a || !b) break;
        items[i] = b;
        items[best] = a;
        i = best;
      }
    }
    return top;
  }
}

/** One leg of a route, carrying how it is travelled. */
export interface RouteLeg {
  from: string;
  to: string;
  pages: number;
  trunk: boolean;
  mode: "ride" | "walk";
  cost: number;
}

/**
 * How a trip may be routed. "streets" allows any road, with trunk hops priced
 * cheaper. "transit" restricts to the backbone, permitting a walk leg only as
 * the first and/or last hop to reach the network — the way a transit app lets
 * you walk to the station but never mid-journey.
 */
export type RouteMode = "streets" | "transit";

export interface Route {
  stops: string[];
  legs: RouteLeg[];
  distance: number;
  /** Which mode actually produced this route. */
  mode: RouteMode;
  /**
   * True when no legal one-way path existed and the route was found by
   * ignoring direction. Such a trip requires going against one-way links.
   */
  againstOneWay: boolean;
}

/**
 * Cheapest directed path between two stops. Big-web hubs are skipped as
 * intermediate hops — routing everything through google.com would be
 * technically shortest and completely uninteresting — but stay valid endpoints.
 */
export function findRoute(
  level: GroupLevel,
  fromId: string,
  toId: string,
  isHub: (stopId: string) => boolean,
  index?: Map<string, Step[]>,
  ignoreDirection = false,
  onLine?: LineCoverage,
): Route | null {
  if (fromId === toId) {
    return { stops: [fromId], legs: [], distance: 0, mode: "streets", againstOneWay: false };
  }

  const adjacency = ignoreDirection
    ? buildUndirectedIndex(level, onLine)
    : index ?? buildRoutingIndex(level, onLine);
  if (!adjacency.has(fromId) || !adjacency.has(toId)) return null;

  const dist = new Map<string, number>();
  const prev = new Map<string, { from: string; step: Step }>();
  const settled = new Set<string>();
  const heap = new MinHeap();
  dist.set(fromId, 0);
  heap.push(fromId, 0);

  while (heap.size > 0) {
    const top = heap.pop();
    if (!top) break;
    if (settled.has(top.id)) continue;
    // A stale heap entry outranked by a later, cheaper push.
    if (top.cost > (dist.get(top.id) ?? Infinity)) continue;
    settled.add(top.id);
    if (top.id === toId) break;

    for (const step of adjacency.get(top.id) ?? []) {
      if (settled.has(step.to)) continue;
      // Hubs are context, not territory: never route through one.
      if (step.to !== toId && isHub(step.to)) continue;
      const next = top.cost + step.cost;
      if (next < (dist.get(step.to) ?? Infinity)) {
        dist.set(step.to, next);
        prev.set(step.to, { from: top.id, step });
        heap.push(step.to, next);
      }
    }
  }

  if (!dist.has(toId)) return null;

  const legs: RouteLeg[] = [];
  const stops: string[] = [toId];
  let cursor = toId;
  for (let guard = 0; guard < level.stops.length + 1; guard++) {
    if (cursor === fromId) {
      legs.reverse();
      stops.reverse();
      return {
        stops,
        legs,
        distance: dist.get(toId) ?? 0,
        mode: "streets",
        againstOneWay: ignoreDirection,
      };
    }
    const back = prev.get(cursor);
    if (!back) return null;
    legs.push({
      from: back.from,
      to: cursor,
      pages: back.step.pages,
      trunk: back.step.trunk,
      mode: back.step.mode,
      cost: back.step.cost,
    });
    stops.push(back.from);
    cursor = back.from;
  }
  return null;
}

/**
 * Stops that are uncrawled dead-ends: ordinary sites that were linked TO but
 * never crawled outward, so they have no outgoing roads. They are rumors of
 * places rather than charted stops, and at ~80% of the graph they drown the
 * real map, so the renderer holds them back until you look their way.
 *
 * Note the test is "no outgoing links" rather than a degree threshold: merged
 * group edges give almost every folded leaf two distinct neighbours, so degree
 * separates nothing here.
 */
export function findRumorStops(
  level: GroupLevel,
  index?: Map<string, Step[]>,
): Set<string> {
  const adjacency = index ?? buildRoutingIndex(level);
  const rumors = new Set<string>();
  for (const stop of level.stops) {
    if (stop.kind !== "site") continue;
    if ((adjacency.get(stop.id)?.length ?? 0) > 0) continue;
    rumors.add(stop.id);
  }
  return rumors;
}

/**
 * Cheapest transit-only trip: trunk hops throughout, with at most one walking
 * leg at the very start and one at the very end to reach the backbone.
 *
 * The end-only rule is a constraint on leg ORDER, not on cost, so plain
 * Dijkstra over stops cannot express it. Searching over (stop, phase) states
 * can: phase 0 is "still walking to the network", 1 is "riding", 2 is "walked
 * off at the end". Walk legs advance the phase, trunk legs keep it, and the
 * phase never decreases — so a walk can never appear mid-ride.
 */
export function findTransitRoute(
  level: GroupLevel,
  fromId: string,
  toId: string,
  isHub: (stopId: string) => boolean,
  index?: Map<string, Step[]>,
): Route | null {
  if (fromId === toId) {
    return { stops: [fromId], legs: [], distance: 0, mode: "transit", againstOneWay: false };
  }
  const adjacency = index ?? buildRoutingIndex(level);
  if (!adjacency.has(fromId) || !adjacency.has(toId)) return null;

  const key = (stop: string, phase: number) => `${phase} ${stop}`;
  const dist = new Map<string, number>();
  const prev = new Map<string, { from: string; fromPhase: number; step: Step }>();
  const settled = new Set<string>();
  const heap = new MinHeap();
  dist.set(key(fromId, 0), 0);
  heap.push(key(fromId, 0), 0);

  let bestEndPhase = -1;
  let bestEndCost = Infinity;

  while (heap.size > 0) {
    const top = heap.pop();
    if (!top) break;
    if (settled.has(top.id)) continue;
    if (top.cost > (dist.get(top.id) ?? Infinity)) continue;
    settled.add(top.id);

    const sep = top.id.indexOf(" ");
    const phase = Number(top.id.slice(0, sep));
    const stop = top.id.slice(sep + 1);

    // Phase 1 is "walked to the network"; arriving there IS a legal single-walk
    // trip, so every phase except the unreachable start counts as an arrival.
    if (stop === toId && phase > 0 && top.cost < bestEndCost) {
      bestEndPhase = phase;
      bestEndCost = top.cost;
      // Any later pop costs at least as much, so this is the cheapest arrival.
      break;
    }

    for (const step of adjacency.get(stop) ?? []) {
      if (step.to !== toId && isHub(step.to)) continue;
      // A trunk leg keeps the phase; boarding for the first time moves 0 -> 1.
      // A walk leg is only legal before boarding (0) or as the final hop (-> 2).
      let nextPhase: number;
      if (step.trunk) {
        // Phase 3 has already walked off the network; no re-boarding.
        if (phase === 3) continue;
        nextPhase = 2;
      } else if (phase === 0) {
        // The one permitted approach walk. Phase 1 means "walked to the
        // network but not yet riding", so a second walk cannot follow.
        nextPhase = 1;
      } else if (phase === 2 && step.to === toId) {
        // The one permitted exit walk, and only onto the destination.
        nextPhase = 3;
      } else {
        continue;
      }
      const nextKey = key(step.to, nextPhase);
      if (settled.has(nextKey)) continue;
      const next = top.cost + step.cost;
      if (next < (dist.get(nextKey) ?? Infinity)) {
        dist.set(nextKey, next);
        prev.set(nextKey, { from: stop, fromPhase: phase, step });
        heap.push(nextKey, next);
      }
    }
  }

  if (bestEndPhase < 0) return null;

  const legs: RouteLeg[] = [];
  const stops: string[] = [toId];
  let cursorStop = toId;
  let cursorPhase = bestEndPhase;
  for (let guard = 0; guard <= level.stops.length * 3 + 3; guard++) {
    if (cursorStop === fromId && cursorPhase === 0) {
      legs.reverse();
      stops.reverse();
      return {
        stops,
        legs,
        distance: bestEndCost,
        mode: "transit",
        againstOneWay: false,
      };
    }
    const back = prev.get(key(cursorStop, cursorPhase));
    if (!back) return null;
    legs.push({
      from: back.from,
      to: cursorStop,
      pages: back.step.pages,
      trunk: back.step.trunk,
      mode: back.step.mode,
      cost: back.step.cost,
    });
    stops.push(back.from);
    cursorStop = back.from;
    cursorPhase = back.fromPhase;
  }
  return null;
}

/** Hop distance from any seed, for the "N hops from seeds" focus dimmer. */
export function hopsFromSeeds(
  level: GroupLevel,
  seedStopIds: string[],
): Map<string, number> {
  const hops = new Map<string, number>();
  const queue: string[] = [];
  for (const id of seedStopIds) {
    if (hops.has(id)) continue;
    hops.set(id, 0);
    queue.push(id);
  }
  // Undirected for reachability: the dimmer answers "how far from an origin",
  // not "can you legally walk there".
  const neighbors = new Map<string, string[]>();
  for (const stop of level.stops) neighbors.set(stop.id, []);
  for (const edge of level.edges) {
    neighbors.get(edge.source)?.push(edge.target);
    neighbors.get(edge.target)?.push(edge.source);
  }
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) continue;
    const depth = hops.get(current) ?? 0;
    for (const next of neighbors.get(current) ?? []) {
      if (hops.has(next)) continue;
      hops.set(next, depth + 1);
      queue.push(next);
    }
  }
  return hops;
}

/** Substring match over domains, ranked so prefix hits come first. */
export interface SearchHit {
  domain: string;
  stopId: string;
  /** Members in the containing stop, for the "inside X +N" affordance. */
  stopSize: number;
  collapsed: boolean;
}

export function searchDomains(
  graph: Graph,
  level: GroupLevel,
  query: string,
  limit = 8,
): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const scored: Array<{ hit: SearchHit; score: number }> = [];
  for (const node of graph.nodes) {
    const id = node.id.toLowerCase();
    const at = id.indexOf(needle);
    if (at === -1) continue;
    const stopId = level.stopOf.get(node.id);
    if (stopId === undefined) continue;
    const stop = level.stops.find((s) => s.id === stopId);
    // Earlier matches rank higher; shorter domains break ties so "are.na"
    // outranks "software.are.na.example" for the query "are.na".
    const score = at * 100 + id.length;
    scored.push({
      hit: {
        domain: node.id,
        stopId,
        stopSize: stop?.members.length ?? 1,
        collapsed: stopId !== node.id,
      },
      score,
    });
  }
  scored.sort((a, b) =>
    a.score !== b.score ? a.score - b.score : a.hit.domain < b.hit.domain ? -1 : 1,
  );
  return scored.slice(0, limit).map((s) => s.hit);
}
