// ABOUTME: Seeded force-directed layout for the transit map, operating on grouped stops.
// ABOUTME: Grid-bucketed repulsion, edge springs, cluster gravity, and fringe bundling.

import {
  createRandom,
  hashKey,
  type GroupEdge,
  type GroupLevel,
  type GroupStop,
} from "./graph-model";

const LAYOUT_SEED = 0x5eed1a7e;
const LAYOUT_EXTENT = 1400;

export interface LayoutNode {
  stop: GroupStop;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Inverse mass — busy interchanges drift less than small stops. */
  invMass: number;
  /** 0..1 prominence, driving marker size and label priority. */
  prominence: number;
  degree: number;
  /**
   * For a stop hanging off a single anchor: the anchor, plus the shared
   * direction its bundle grows in. Crawl data is overwhelmingly degree-1
   * fringe, and with one edge each those stops carry no information to spread
   * by — a plain force layout lands them on an even ring. Grouping them into a
   * few strands is what keeps the fringe legible as mycelial fuzz.
   */
  bundleParent: LayoutNode | null;
  bundleAngle: number;
  bundleCurl: number;
  bundleDepth: number;
  /**
   * Uncrawled dead-end: linked to, never crawled outward. Held back from the
   * resting view so the charted network can breathe.
   */
  rumor: boolean;
}

export interface LayoutEdge {
  a: LayoutNode;
  b: LayoutNode;
  /** Pages a->b. */
  jumps: number;
  /** Pages b->a; 0 means one-way and drives the taper. */
  back: number;
  trunk: boolean;
  /** 0..1 traffic weight, driving line thickness. */
  weight: number;
  /** Gentle perpendicular offsets so routes are not dead straight. */
  wobble: number[];
  restScale: number;
  internal: boolean;
  /**
   * Screen-space polyline for trunk lines, nudged toward 45-degree angles by
   * a deterministic post-pass. Null for mesh edges, which stay curved.
   */
  trunkPath: Array<{ x: number; y: number }> | null;
  /**
   * Rank of this trunk edge by weight within the level, 0 (heaviest) to 1.
   * A spanning forest marks roughly one trunk edge per node, which is far too
   * many lines to read at rest, so the renderer shows only the top slice and
   * fades the rest in with zoom.
   */
  trunkRank: number;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  byId: Map<string, LayoutNode>;
  clusterCenters: Map<number, { x: number; y: number }>;
  extent: number;
  /** Spacing multiplier from the controls; scales spring rest lengths too. */
  spread: number;
}

/**
 * Build initial positions: clusters seeded on a jittered ring so they start
 * apart, members scattered around their cluster center.
 */
export function seedLayout(
  level: GroupLevel,
  spread = 1,
  rumors: ReadonlySet<string> = new Set(),
): Layout {
  const random = createRandom(LAYOUT_SEED);

  // Scale the working area with sqrt(stop count) so areal density — and the
  // number of neighbours inside the repulsion radius — stays roughly constant.
  // Count only CHARTED stops: rumors are hidden at rest, so sizing the world to
  // include them shrinks the visible network into a fraction of the canvas.
  const chartedCount = level.stops.reduce(
    (n, s) => (rumors.has(s.id) ? n : n + 1),
    0,
  );
  const extent =
    LAYOUT_EXTENT * Math.sqrt(Math.max(chartedCount, 24) / 150) * spread;

  const clusterIds = [...new Set(level.stops.map((s) => s.cluster))].sort(
    (a, b) => a - b,
  );
  const clusterCenters = new Map<number, { x: number; y: number }>();
  const ringRadius = extent * 0.42;
  clusterIds.forEach((id, i) => {
    const angle = (i / clusterIds.length) * Math.PI * 2 + random() * 0.35;
    const r = ringRadius * (0.55 + random() * 0.75);
    clusterCenters.set(id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  });

  const degree = new Map<string, number>();
  for (const edge of level.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  // Visits are distinct inbound linking domains: a narrow 1..~10 range, so a
  // log ramp would flatten everything into one size. sqrt keeps a readable
  // spread across that range while still damping the outliers.
  const maxVisits = Math.max(1, ...level.stops.map((s) => s.visits));
  const maxDegree = Math.max(1, ...degree.values());

  const nodes: LayoutNode[] = level.stops.map((stop) => {
    const center = clusterCenters.get(stop.cluster);
    if (!center) {
      throw new Error(`stop ${stop.id} references unknown cluster ${stop.cluster}`);
    }
    const angle = random() * Math.PI * 2;
    const spread = extent * (0.05 + random() * 0.12);
    const stopDegree = degree.get(stop.id) ?? 0;
    // Blend traffic with connectedness so both crawl data (narrow visits, wide
    // degree) and hand-built fixtures (the reverse) produce a readable ramp.
    const byVisits = Math.sqrt(stop.visits) / Math.sqrt(maxVisits);
    const byDegree = Math.sqrt(stopDegree) / Math.sqrt(maxDegree);
    const prominence = Math.max(byVisits, byDegree);
    return {
      stop,
      x: center.x + Math.cos(angle) * spread,
      y: center.y + Math.sin(angle) * spread,
      vx: 0,
      vy: 0,
      invMass: 1 / (1 + prominence * 5),
      prominence,
      degree: stopDegree,
      bundleParent: null,
      bundleAngle: 0,
      bundleCurl: 0,
      bundleDepth: 0,
      rumor: rumors.has(stop.id),
    };
  });

  const byId = new Map(nodes.map((n) => [n.stop.id, n]));
  const maxJumps = Math.max(1, ...level.edges.map((e) => e.jumps));
  const logMaxJumps = Math.log(maxJumps + 1);

  const edges: LayoutEdge[] = level.edges.map((edge: GroupEdge) => {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    if (!a || !b) {
      throw new Error(`edge ${edge.source} -> ${edge.target} references a missing stop`);
    }
    const weight = Math.log(edge.jumps + 1) / logMaxJumps;
    const key =
      edge.source < edge.target
        ? `${edge.source} ${edge.target}`
        : `${edge.target} ${edge.source}`;
    const wobbleRandom = createRandom(hashKey(key));
    const bends = 2 + Math.floor(wobbleRandom() * 2);
    // Only a whisper of wander: routes must stay followable by eye. Trunk
    // routes straighten further, as reinforced paths do.
    const amplitude = 0.055 * (1 - weight * 0.6);
    const wobble: number[] = [];
    for (let i = 0; i < bends; i++) {
      wobble.push((wobbleRandom() - 0.5) * 2 * amplitude);
    }
    return {
      a,
      b,
      jumps: edge.jumps,
      back: edge.back,
      trunk: edge.trunk,
      weight,
      wobble,
      restScale: 0.55 + wobbleRandom() * 1.5,
      internal: a.stop.cluster === b.stop.cluster,
      trunkPath: null,
      trunkRank: 1,
    };
  });

  // Rank trunk edges by total traffic so the renderer can show a poster-sized
  // number of primary lines and reveal the rest on zoom.
  const trunkEdges = edges.filter((e) => e.trunk);
  trunkEdges.sort((x, y) => {
    const wx = x.jumps + x.back;
    const wy = y.jumps + y.back;
    if (wx !== wy) return wy - wx;
    // Stable tie-break so ranks never depend on input ordering.
    return x.a.stop.id < y.a.stop.id ? -1 : 1;
  });
  trunkEdges.forEach((edge, i) => {
    edge.trunkRank = trunkEdges.length <= 1 ? 0 : i / (trunkEdges.length - 1);
  });

  bundleFringe(edges);

  return { nodes, edges, byId, clusterCenters, extent, spread };
}

/**
 * Group single-edge stops into a few strands off their anchor. Without this a
 * thousand-leaf anchor spreads its fringe into an even disc; bundling turns
 * that ring into readable tendrils.
 */
function bundleFringe(edges: LayoutEdge[]): void {
  const leavesByParent = new Map<LayoutNode, LayoutNode[]>();
  const chosenParent = new Map<LayoutNode, LayoutNode>();
  for (const edge of edges) {
    const pairs: Array<[LayoutNode, LayoutNode]> = [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ];
    for (const [leaf, parent] of pairs) {
      // Rumors bundle onto whichever charted stop links them, so they trail as
      // dust off that stop instead of forming a halo of their own.
      const bundleable = leaf.degree === 1 || (leaf.rumor && !parent.rumor);
      if (!bundleable || parent.degree <= 1) continue;
      // Keep the lexicographically smallest eligible parent, so a rumor with
      // several anchors always attaches to the same one.
      const chosen = chosenParent.get(leaf);
      if (!chosen || parent.stop.id < chosen.stop.id) {
        chosenParent.set(leaf, parent);
      }
    }
  }

  for (const [leaf, parent] of chosenParent) {
    const list = leavesByParent.get(parent);
    if (list) list.push(leaf);
    else leavesByParent.set(parent, [leaf]);
  }

  for (const [parent, leaves] of leavesByParent) {
    // Few, long strands. Scaling the count with the leaf total (even by sqrt)
    // still fills every angle on a large anchor and reads as a disc.
    const tendrils = Math.max(3, Math.min(11, Math.round(leaves.length / 14)));
    const ordered = [...leaves].sort((x, y) =>
      x.stop.id < y.stop.id ? -1 : x.stop.id > y.stop.id ? 1 : 0,
    );
    const spin = createRandom(hashKey(parent.stop.id));
    const baseAngle = spin() * Math.PI * 2;
    const curls: number[] = [];
    for (let i = 0; i < tendrils; i++) curls.push((spin() - 0.5) * 0.13);

    const perTendril = new Map<number, number>();
    ordered.forEach((leaf, i) => {
      const tendril = i % tendrils;
      const depth = (perTendril.get(tendril) ?? 0) + 1;
      perTendril.set(tendril, depth);
      leaf.bundleParent = parent;
      leaf.bundleAngle =
        baseAngle + (tendril / tendrils) * Math.PI * 2 + (spin() - 0.5) * 0.28;
      leaf.bundleCurl = curls[tendril] ?? 0;
      leaf.bundleDepth = depth;
    });
  }
}

/**
 * Uniform-grid neighbour lookup, so repulsion stays near-linear instead of
 * comparing every pair.
 */
export class SpatialGrid {
  private readonly cells = new Map<number, LayoutNode[]>();
  private readonly cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): number {
    return (cx + 2048) * 4096 + (cy + 2048);
  }

  rebuild(nodes: LayoutNode[]): void {
    this.cells.clear();
    for (const node of nodes) {
      // Bundled fringe neither repels nor needs to be found; keeping it out of
      // the grid stops dense strands from bloating every neighbour sweep.
      if (node.bundleParent !== null) continue;
      const cx = Math.floor(node.x / this.cellSize);
      const cy = Math.floor(node.y / this.cellSize);
      const key = this.key(cx, cy);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(node);
      else this.cells.set(key, [node]);
    }
  }

  forEachNeighbor(node: LayoutNode, visit: (other: LayoutNode) => void): void {
    const cx = Math.floor(node.x / this.cellSize);
    const cy = Math.floor(node.y / this.cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.cells.get(this.key(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const other of bucket) {
          if (other !== node) visit(other);
        }
      }
    }
  }
}

export const REPULSION_RADIUS = 190;
const REPULSION = 5200;
const EDGE_STIFFNESS = 0.055;
const EDGE_REST_LENGTH = 62;
const CLUSTER_PULL = 0.008;
/** Relative to the layout extent, so it holds at any stop count. */
const CLUSTER_SEPARATION = 26000 / 1400;
const CENTER_PULL = 0.00004;
const BUNDLE_PULL = 0.05;
const DAMPING = 0.86;
const MAX_SPEED = 26;

export const CONVERGENCE_TICKS = 420;

/** One step. `heat` anneals 1 to 0 so the map settles rather than jitters. */
export function stepLayout(
  layout: Layout,
  grid: SpatialGrid,
  heat: number,
): void {
  const { nodes, edges, clusterCenters, extent, spread } = layout;
  const clusterSeparation = CLUSTER_SEPARATION * extent;
  const restLength = EDGE_REST_LENGTH * spread;

  // Cluster centers repel, opening the gaps that separate regions.
  const centers = [...clusterCenters.values()];
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const ca = centers[i];
      const cb = centers[j];
      if (!ca || !cb) continue;
      const dx = ca.x - cb.x;
      const dy = ca.y - cb.y;
      const dist = Math.max(Math.hypot(dx, dy), 1);
      const push = clusterSeparation / (dist * dist);
      ca.x += (dx / dist) * push;
      ca.y += (dy / dist) * push;
      cb.x -= (dx / dist) * push;
      cb.y -= (dy / dist) * push;
    }
  }
  for (const center of centers) {
    center.x *= 1 - CENTER_PULL * 40;
    center.y *= 1 - CENTER_PULL * 40;
  }

  grid.rebuild(nodes);

  for (const node of nodes) {
    if (node.bundleParent !== null) continue;
    let fx = 0;
    let fy = 0;
    grid.forEachNeighbor(node, (other) => {
      const dx = node.x - other.x;
      const dy = node.y - other.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > REPULSION_RADIUS * REPULSION_RADIUS) return;
      const dist = Math.max(Math.sqrt(distSq), 0.8);
      const strength = (REPULSION * (0.5 + other.prominence * 1.8)) / (dist * dist);
      fx += (dx / dist) * strength;
      fy += (dy / dist) * strength;
    });
    node.vx += fx * node.invMass;
    node.vy += fy * node.invMass;
  }

  for (const edge of edges) {
    // A bundled stop's placement is owned by its strand; letting the spring also
    // pull it to a fixed radius re-forms the disc.
    if (edge.a.bundleParent !== null || edge.b.bundleParent !== null) continue;
    const dx = edge.b.x - edge.a.x;
    const dy = edge.b.y - edge.a.y;
    const dist = Math.max(Math.hypot(dx, dy), 0.8);
    const rest = (restLength + 6 * spread) * edge.restScale;
    // Hooke's law on displacement from rest. The force must not scale with dist
    // again via the unit vector, or long edges accelerate without bound.
    const force = (dist - rest) * EDGE_STIFFNESS * (0.35 + edge.weight);
    const ux = (dx / dist) * force;
    const uy = (dy / dist) * force;
    edge.a.vx += ux * edge.a.invMass;
    edge.a.vy += uy * edge.a.invMass;
    edge.b.vx -= ux * edge.b.invMass;
    edge.b.vy -= uy * edge.b.invMass;
  }

  for (const node of nodes) {
    const parent = node.bundleParent;
    if (parent) {
      const reach = restLength * 0.5 + node.bundleDepth * 11 * spread;
      // Curve the strand as it extends, so the fringe sweeps like hyphae
      // instead of radiating as straight spider legs.
      const angle = node.bundleAngle + node.bundleCurl * node.bundleDepth;
      node.vx += (parent.x + Math.cos(angle) * reach - node.x) * BUNDLE_PULL;
      node.vy += (parent.y + Math.sin(angle) * reach - node.y) * BUNDLE_PULL;
    }

    const center = clusterCenters.get(node.stop.cluster);
    if (center) {
      node.vx += (center.x - node.x) * CLUSTER_PULL;
      node.vy += (center.y - node.y) * CLUSTER_PULL;
    }
    node.vx += -node.x * CENTER_PULL;
    node.vy += -node.y * CENTER_PULL;

    const damping = DAMPING - 0.06 * (1 - heat);
    node.vx *= damping;
    node.vy *= damping;

    const speed = Math.hypot(node.vx, node.vy);
    const limit = MAX_SPEED * (0.25 + heat * 0.75);
    if (speed > limit) {
      node.vx = (node.vx / speed) * limit;
      node.vy = (node.vy / speed) * limit;
    }

    node.x += node.vx;
    node.y += node.vy;
  }
}

/**
 * Nudge trunk lines toward metro-poster angles. This is a post-pass over the
 * settled positions, not a layout engine: each trunk edge becomes a two-segment
 * polyline whose elbow sits where an axis-aligned run meets a 45-degree run.
 * Deterministic (pure function of the endpoints) and cheap enough to redo
 * whenever the layout moves.
 */
export function buildTrunkPaths(layout: Layout): void {
  for (const edge of layout.edges) {
    if (!edge.trunk) {
      edge.trunkPath = null;
      continue;
    }
    const { a, b } = edge;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    // A near-octilinear run is already on-grid; leave it straight.
    if (adx < 1 || ady < 1 || Math.abs(adx - ady) < Math.max(adx, ady) * 0.12) {
      edge.trunkPath = [
        { x: a.x, y: a.y },
        { x: b.x, y: b.y },
      ];
      continue;
    }
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    // Spend the shorter axis on a 45-degree diagonal and the remainder on a
    // straight run, so the elbow lands on one of the eight compass headings.
    const diagonal = Math.min(adx, ady);
    const elbow =
      adx > ady
        ? { x: a.x + sx * (adx - diagonal), y: a.y }
        : { x: a.x, y: a.y + sy * (ady - diagonal) };
    edge.trunkPath = [
      { x: a.x, y: a.y },
      elbow,
      { x: b.x, y: b.y },
    ];
  }
}

/** Run a layout to convergence in one go. */
export function solveLayout(
  level: GroupLevel,
  spread = 1,
  rumors: ReadonlySet<string> = new Set(),
): Layout {
  const layout = seedLayout(level, spread, rumors);
  const grid = new SpatialGrid(REPULSION_RADIUS);
  for (let i = 1; i <= CONVERGENCE_TICKS; i++) {
    stepLayout(layout, grid, 1 - i / CONVERGENCE_TICKS);
  }
  buildTrunkPaths(layout);
  return layout;
}
