// ABOUTME: Galaxy filament map of browsing territory — domains as stars, routes as filaments.
// ABOUTME: Seeded force-directed layout rendered to canvas 2D with pre-baked glow sprites.

import "./galaxy.scss";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

// ---------------------------------------------------------------------------
// Data contract
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  visits: number;
  participants: number;
  dwellMs: number;
  cluster: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  jumps: number;
  participants: number;
}

export interface GraphCluster {
  id: number;
  size: number;
  label: string;
}

export interface GraphMeta {
  generatedAt: string;
  totalJumps: number;
  totalSessions: number;
}

export interface Graph {
  meta: GraphMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
}

// ---------------------------------------------------------------------------
// Seeded PRNG — same graph always produces the same sky.
// ---------------------------------------------------------------------------

const LAYOUT_SEED = 0x5eed1a7e;

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

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface LayoutNode {
  node: GraphNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Inverse mass — bright cores drift less than dim satellites. */
  invMass: number;
  radius: number;
  brightness: number;
  degree: number;
}

interface LayoutEdge {
  a: LayoutNode;
  b: LayoutNode;
  jumps: number;
  weight: number;
  /** Perpendicular bow offset, so filaments arc instead of running dead straight. */
  bow: number;
}

interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  clusterCenters: Map<number, { x: number; y: number }>;
  /** Working-area scale, grown with node count to hold density constant. */
  extent: number;
}

const LAYOUT_EXTENT = 1400;

/**
 * Build initial positions: clusters seeded on a ring so they start apart,
 * members scattered in a disc around their cluster center.
 */
function seedLayout(graph: Graph): Layout {
  const random = createRandom(LAYOUT_SEED);

  // Scale the working area with sqrt(node count) so areal density — and with it
  // the number of neighbours inside the repulsion radius — stays roughly
  // constant from 150 nodes up to a few thousand. A fixed extent would pack
  // 2000 nodes so tightly that every repulsion query degrades toward O(n^2).
  const extent = LAYOUT_EXTENT * Math.sqrt(graph.nodes.length / 150);

  const clusterIds = [...new Set(graph.nodes.map((n) => n.cluster))].sort(
    (a, b) => a - b,
  );
  const clusterCenters = new Map<number, { x: number; y: number }>();
  const ringRadius = extent * 0.42;
  clusterIds.forEach((id, i) => {
    const angle = (i / clusterIds.length) * Math.PI * 2 + random() * 0.35;
    // Vary the ring radius so the web doesn't read as a perfect circle.
    const r = ringRadius * (0.55 + random() * 0.75);
    clusterCenters.set(id, {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
    });
  });

  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const maxVisits = Math.max(1, ...graph.nodes.map((n) => n.visits));
  const logMaxVisits = Math.log(maxVisits + 1);

  const nodes: LayoutNode[] = graph.nodes.map((node) => {
    const center = clusterCenters.get(node.cluster);
    if (!center) {
      throw new Error(`node ${node.id} references unknown cluster ${node.cluster}`);
    }
    const angle = random() * Math.PI * 2;
    const spread = extent * 0.11 * Math.sqrt(random());
    const brightness = Math.log(node.visits + 1) / logMaxVisits;
    return {
      node,
      x: center.x + Math.cos(angle) * spread,
      y: center.y + Math.sin(angle) * spread,
      vx: 0,
      vy: 0,
      invMass: 1 / (1 + brightness * 5),
      radius: 1.6 + brightness * brightness * 15,
      brightness,
      degree: degree.get(node.id) ?? 0,
    };
  });

  const byId = new Map(nodes.map((n) => [n.node.id, n]));
  const maxJumps = Math.max(1, ...graph.edges.map((e) => e.jumps));
  const logMaxJumps = Math.log(maxJumps + 1);

  const edges: LayoutEdge[] = graph.edges.map((edge) => {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    if (!a || !b) {
      throw new Error(`edge ${edge.source} -> ${edge.target} references a missing node`);
    }
    return {
      a,
      b,
      jumps: edge.jumps,
      weight: Math.log(edge.jumps + 1) / logMaxJumps,
      bow: (random() - 0.5) * 0.18,
    };
  });

  return { nodes, edges, clusterCenters, extent };
}

/**
 * Barnes-Hut-free repulsion: a uniform grid limits each node to comparing
 * against neighbours in adjacent cells, which keeps 2000 nodes tractable.
 */
class SpatialGrid {
  private readonly cells = new Map<number, LayoutNode[]>();
  private readonly cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): number {
    // Pack two signed cell coords into one number; 4096 spans the working extent.
    return (cx + 2048) * 4096 + (cy + 2048);
  }

  rebuild(nodes: LayoutNode[]): void {
    this.cells.clear();
    for (const node of nodes) {
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

const REPULSION = 5200;
const REPULSION_RADIUS = 190;
const EDGE_STIFFNESS = 0.055;
const EDGE_REST_LENGTH = 62;
/** Pull toward the node's own cluster center — this is what carves distinct knots. */
const CLUSTER_PULL = 0.008;
/** Cluster centers shove each other apart so voids open between regions.
 *  Expressed relative to the layout extent so it holds at any node count. */
const CLUSTER_SEPARATION = 26000 / 1400;
const CENTER_PULL = 0.00004;
const DAMPING = 0.86;
const MAX_SPEED = 26;

/** One simulation step. `heat` anneals from 1 to 0 so the web settles rather than jitters. */
function stepLayout(layout: Layout, grid: SpatialGrid, heat: number): void {
  const { nodes, edges, clusterCenters, extent } = layout;
  const clusterSeparation = CLUSTER_SEPARATION * extent;

  // Cluster centers repel one another, opening the voids that make the web
  // read as filaments-between-knots rather than one undifferentiated blob.
  const centers = [...clusterCenters.entries()];
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const ca = centers[i][1];
      const cb = centers[j][1];
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
  // Keep the constellation of centers roughly framed on the origin.
  for (const [, center] of centers) {
    center.x *= 1 - CENTER_PULL * 40;
    center.y *= 1 - CENTER_PULL * 40;
  }

  grid.rebuild(nodes);

  // Repulsion — every star pushes its neighbours away, carving the voids.
  for (const node of nodes) {
    let fx = 0;
    let fy = 0;
    grid.forEachNeighbor(node, (other) => {
      const dx = node.x - other.x;
      const dy = node.y - other.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > REPULSION_RADIUS * REPULSION_RADIUS) return;
      // Floor the distance so coincident nodes don't produce infinite force.
      const dist = Math.max(Math.sqrt(distSq), 0.8);
      // Brighter nodes push harder, so cores clear a halo around themselves.
      const strength =
        (REPULSION * (0.5 + other.brightness * 1.8)) / (dist * dist);
      fx += (dx / dist) * strength;
      fy += (dy / dist) * strength;
    });
    node.vx += fx * node.invMass;
    node.vy += fy * node.invMass;
  }

  // Edge springs — routes pull their endpoints together into filaments.
  for (const edge of edges) {
    const dx = edge.b.x - edge.a.x;
    const dy = edge.b.y - edge.a.y;
    const dist = Math.max(Math.hypot(dx, dy), 0.8);
    const rest = EDGE_REST_LENGTH + edge.a.radius + edge.b.radius;
    // Hooke's law on the displacement from rest; force must not scale with dist
    // again via the unit vector, or long edges accelerate without bound.
    const force = (dist - rest) * EDGE_STIFFNESS * (0.35 + edge.weight);
    const ux = (dx / dist) * force;
    const uy = (dy / dist) * force;
    edge.a.vx += ux * edge.a.invMass;
    edge.a.vy += uy * edge.a.invMass;
    edge.b.vx -= ux * edge.b.invMass;
    edge.b.vy -= uy * edge.b.invMass;
  }

  // Cluster gravity + a weak pull to origin keeps the whole web framed.
  for (const node of nodes) {
    const center = clusterCenters.get(node.node.cluster);
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

// ---------------------------------------------------------------------------
// Glow sprites — radial gradients are expensive per-frame, so bake them once
// and blit the scaled bitmap instead.
// ---------------------------------------------------------------------------

const SPRITE_TIERS = 7;
const SPRITE_SIZE = 128;

interface GlowSprites {
  /** Warm core-to-orange halos, one per brightness tier. */
  glow: HTMLCanvasElement[];
  /** Small hard-ish white-gold core drawn on top. */
  core: HTMLCanvasElement;
}

function makeSprite(draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable for glow sprite");
  draw(ctx, SPRITE_SIZE);
  return canvas;
}

function buildGlowSprites(): GlowSprites {
  const glow: HTMLCanvasElement[] = [];
  for (let tier = 0; tier < SPRITE_TIERS; tier++) {
    const t = tier / (SPRITE_TIERS - 1);
    glow.push(
      makeSprite((ctx, size) => {
        const half = size / 2;
        const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
        // Hotter cores read whiter at the center and hold their orange skirt longer.
        gradient.addColorStop(0, `rgba(255, 249, 232, ${0.92 + t * 0.08})`);
        gradient.addColorStop(0.09, `rgba(250, 214, 132, ${0.82 + t * 0.18})`);
        gradient.addColorStop(0.24, `rgba(240, 168, 82, ${0.34 + t * 0.28})`);
        gradient.addColorStop(0.5, `rgba(206, 110, 54, ${0.12 + t * 0.14})`);
        gradient.addColorStop(0.78, `rgba(150, 72, 44, ${0.03 + t * 0.05})`);
        gradient.addColorStop(1, "rgba(120, 58, 40, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
      }),
    );
  }

  const core = makeSprite((ctx, size) => {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, "rgba(255, 252, 240, 1)");
    gradient.addColorStop(0.35, "rgba(255, 226, 160, 0.85)");
    gradient.addColorStop(0.75, "rgba(240, 170, 90, 0.18)");
    gradient.addColorStop(1, "rgba(240, 170, 90, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });

  return { glow, core };
}

// ---------------------------------------------------------------------------
// Background: nebula wash + dim field stars, baked once per resize.
// ---------------------------------------------------------------------------

const BG_COLOR = "#0a0e1f";

function paintBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  const random = createRandom(0x1a7e5eed);

  // Nebula wash: a handful of huge, very faint blobs in cool indigo and warm rust.
  ctx.globalCompositeOperation = "lighter";
  const blobCount = 16;
  for (let i = 0; i < blobCount; i++) {
    const x = random() * width;
    const y = random() * height;
    const r = Math.max(width, height) * (0.18 + random() * 0.4);
    const warm = random() < 0.35;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (warm) {
      gradient.addColorStop(0, "rgba(84, 44, 34, 0.035)");
      gradient.addColorStop(1, "rgba(84, 44, 34, 0)");
    } else {
      gradient.addColorStop(0, "rgba(28, 36, 78, 0.045)");
      gradient.addColorStop(1, "rgba(28, 36, 78, 0)");
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Field stars: dim, mostly sub-pixel, a few brighter ones.
  const starCount = Math.round((width * height) / 5200);
  for (let i = 0; i < starCount; i++) {
    const x = random() * width;
    const y = random() * height;
    const bright = random();
    const r = bright > 0.97 ? 1.1 + random() * 0.7 : 0.35 + random() * 0.5;
    const alpha = 0.05 + bright * bright * 0.32;
    ctx.fillStyle =
      bright > 0.85
        ? `rgba(255, 238, 206, ${alpha})`
        : `rgba(186, 198, 236, ${alpha * 0.8})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "source-over";

  // Faint procedural grain so flat regions don't band.
  const grainCount = Math.round((width * height) / 900);
  for (let i = 0; i < grainCount; i++) {
    const x = random() * width;
    const y = random() * height;
    ctx.fillStyle = `rgba(255, 255, 255, ${random() * 0.014})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

// ---------------------------------------------------------------------------
// View transform
// ---------------------------------------------------------------------------

interface Camera {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.12;
const MAX_SCALE = 9;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface HoverState {
  node: LayoutNode;
  screenX: number;
  screenY: number;
}

const CONVERGENCE_TICKS = 480;
/** Ticks run before first paint so the reveal starts from a recognizable web. */
const PRESOLVE_TICKS = 150;

const GalaxyMap = (): React.ReactElement => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [settling, setSettling] = useState(true);

  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const layoutRef = useRef<Layout | null>(null);
  /** Nodes eligible for labels, ranked brightest-first once per graph. */
  const labelOrderRef = useRef<LayoutNode[]>([]);
  /** Set when a new graph loads; the render loop frames it once the canvas is sized. */
  const needsFramingRef = useRef(false);
  /** Cleared the first time the viewer pans or zooms, so we stop auto-framing. */
  const userMovedRef = useRef(false);
  const spritesRef = useRef<GlowSprites | null>(null);
  const backdropRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const tickRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  // The render loop reads hover through a ref so it can be created once; making
  // it a dependency would tear down and restart the simulation on every hover.
  const hoverIdRef = useRef<string | null>(null);
  hoverIdRef.current = hover?.node.node.id ?? null;

  useEffect(() => {
    let cancelled = false;
    fetch("./graph.json")
      .then((res) => {
        if (!res.ok) throw new Error(`graph.json responded ${res.status}`);
        return res.json() as Promise<Graph>;
      })
      .then((data) => {
        if (cancelled) return;
        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
          throw new Error("graph.json is missing nodes or edges");
        }
        setGraph(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Build the layout and pre-solve it so the reveal is a settling web, not a puff of dust.
  useEffect(() => {
    if (!graph) return;
    const layout = seedLayout(graph);
    const grid = new SpatialGrid(REPULSION_RADIUS);
    for (let i = 0; i < PRESOLVE_TICKS; i++) {
      stepLayout(layout, grid, 1 - i / CONVERGENCE_TICKS);
    }
    layoutRef.current = layout;
    labelOrderRef.current = layout.nodes
      .filter((n) => n.brightness > 0.18)
      .sort((a, b) => b.brightness - a.brightness);
    tickRef.current = PRESOLVE_TICKS;
    spritesRef.current = buildGlowSprites();
    setSettling(true);

    needsFramingRef.current = true;
  }, [graph]);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    sizeRef.current = { width, height, dpr };

    const backdrop = document.createElement("canvas");
    backdrop.width = canvas.width;
    backdrop.height = canvas.height;
    const bctx = backdrop.getContext("2d");
    if (!bctx) throw new Error("2d context unavailable for backdrop");
    bctx.scale(dpr, dpr);
    paintBackdrop(bctx, width, height);
    backdropRef.current = backdrop;
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  // Main render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable for galaxy canvas");

    let frame = 0;
    // Reused across frames; rebuilt in-place each step rather than reallocated.
    const grid = new SpatialGrid(REPULSION_RADIUS);

    /** Step the solver, capped at the convergence budget. Safe to call from
     *  either the animation loop or the background timer. */
    const advance = (steps: number) => {
      const layout = layoutRef.current;
      if (!layout || tickRef.current >= CONVERGENCE_TICKS) return;
      for (let i = 0; i < steps && tickRef.current < CONVERGENCE_TICKS; i++) {
        tickRef.current++;
        stepLayout(layout, grid, 1 - tickRef.current / CONVERGENCE_TICKS);
      }
      if (tickRef.current >= CONVERGENCE_TICKS) setSettling(false);
    };

    // A hidden tab gets no animation frames at all, which would leave the map
    // frozen mid-condense until it is looked at. Keep solving on a timer so the
    // layout is already settled whenever the page becomes visible.
    const solver = window.setInterval(() => {
      if (tickRef.current >= CONVERGENCE_TICKS) {
        window.clearInterval(solver);
        return;
      }
      // Hidden tabs throttle timers to roughly 1Hz, so take a large slice each
      // wake-up rather than a frame-sized one; the whole solve is a few hundred
      // cheap steps and finishes within a tick or two.
      if (document.hidden) advance(200);
    }, 32);

    const render = () => {
      frame = requestAnimationFrame(render);
      const layout = layoutRef.current;
      const sprites = spritesRef.current;
      const backdrop = backdropRef.current;
      const labelOrder = labelOrderRef.current;
      const { width, height, dpr } = sizeRef.current;
      if (!backdrop || width === 0) return;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(backdrop, 0, 0);
      if (!layout || !sprites) return;

      // Anneal toward a converged layout, then stop simulating entirely.
      advance(3);

      // Keep the whole web framed while it condenses (the cloud expands as it
      // settles), and stop as soon as the viewer takes control of the camera.
      if (needsFramingRef.current && !userMovedRef.current) {
        let extent = 1;
        for (const n of layout.nodes) {
          const reach = Math.max(Math.abs(n.x), Math.abs(n.y));
          if (reach > extent) extent = reach;
        }
        cameraRef.current.x = 0;
        cameraRef.current.y = 0;
        cameraRef.current.scale = Math.min(width, height) / (extent * 2.25);
        if (tickRef.current >= CONVERGENCE_TICKS) needsFramingRef.current = false;
      }

      const camera = cameraRef.current;
      const settleProgress = Math.min(
        1,
        tickRef.current / (CONVERGENCE_TICKS * 0.55),
      );
      // Fade the web in as it condenses.
      const reveal = settleProgress * settleProgress;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(width / 2 + camera.x, height / 2 + camera.y);
      ctx.scale(camera.scale, camera.scale);

      const hoveredId = hoverIdRef.current;

      // World-space bounds of the visible area, with a margin so glows and
      // filaments that spill in from just off-screen are not clipped away.
      const halfW = width / 2 / camera.scale;
      const halfH = height / 2 / camera.scale;
      const viewMinX = -camera.x / camera.scale - halfW - 120;
      const viewMaxX = -camera.x / camera.scale + halfW + 120;
      const viewMinY = -camera.y / camera.scale - halfH - 120;
      const viewMaxY = -camera.y / camera.scale + halfH + 120;

      // --- Filaments -------------------------------------------------------
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (const edge of layout.edges) {
        const { a, b, weight } = edge;
        // Skip filaments whose bounding box misses the viewport entirely.
        if (
          Math.max(a.x, b.x) < viewMinX ||
          Math.min(a.x, b.x) > viewMaxX ||
          Math.max(a.y, b.y) < viewMinY ||
          Math.min(a.y, b.y) > viewMaxY
        ) {
          continue;
        }
        const touchesHover =
          hoveredId !== null &&
          (a.node.id === hoveredId || b.node.id === hoveredId);

        const alpha =
          (0.05 + weight * weight * 0.42) * reveal * (touchesHover ? 2.4 : 1);
        // Heavily-travelled routes run warmer and brighter.
        const warmth = weight * weight;
        const r = Math.round(150 + warmth * 105);
        const g = Math.round(128 + warmth * 72);
        const bl = Math.round(126 - warmth * 26);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${bl}, ${Math.min(alpha, 0.95)})`;
        ctx.lineWidth = Math.max(
          0.35 / camera.scale,
          (0.25 + weight * 1.5) / Math.sqrt(camera.scale),
        );

        // Bow the filament slightly around its midpoint.
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx - dy * edge.bow, my + dx * edge.bow, b.x, b.y);
        ctx.stroke();
      }

      // --- Stars -----------------------------------------------------------
      const glowTiers = sprites.glow;
      for (const node of layout.nodes) {
        if (
          node.x < viewMinX ||
          node.x > viewMaxX ||
          node.y < viewMinY ||
          node.y > viewMaxY
        ) {
          continue;
        }
        const tier = Math.min(
          SPRITE_TIERS - 1,
          Math.floor(node.brightness * SPRITE_TIERS),
        );
        const isHovered = node.node.id === hoveredId;
        // Glow reaches well past the nominal radius, like a real core's halo.
        // Damp the halo as the camera closes in, otherwise every core blooms
        // into a flat orange wash and the structure disappears at high zoom.
        const zoomDamp = 1 / (1 + Math.max(0, camera.scale - 1) * 0.55);
        const glowRadius =
          node.radius * (5.5 + node.brightness * 5) * (0.35 + 0.65 * zoomDamp);
        ctx.globalAlpha = reveal * (isHovered ? 1 : 0.92) * (0.45 + 0.55 * zoomDamp);
        ctx.drawImage(
          glowTiers[tier],
          node.x - glowRadius,
          node.y - glowRadius,
          glowRadius * 2,
          glowRadius * 2,
        );
        const coreRadius = node.radius * 1.5;
        ctx.drawImage(
          sprites.core,
          node.x - coreRadius,
          node.y - coreRadius,
          coreRadius * 2,
          coreRadius * 2,
        );
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      // --- Labels ----------------------------------------------------------
      // Show more names as you zoom in; at a distance only the brightest cores.
      // The brightness ranking is fixed for a given graph, so it is sorted once
      // (see labelOrder) rather than re-sorting every node on every frame.
      const labelBudget = Math.round(6 + camera.scale * 26);
      const labelled = labelOrder.slice(0, labelBudget);

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // Brightest-first placement with screen-space rejection: a label is drawn
      // only if its box is clear, so dense knots stay readable instead of mulched.
      const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
      for (const node of labelled) {
        const sx = width / 2 + camera.x + node.x * camera.scale;
        const sy = height / 2 + camera.y + node.y * camera.scale;
        if (sx < -80 || sx > width + 80 || sy < -40 || sy > height + 40) continue;
        const size = Math.min(13, 8 + node.brightness * 5);
        ctx.font = `500 ${size}px "Martian Mono", ui-monospace, monospace`;
        const text = node.node.id.toUpperCase();
        const halfWidth = ctx.measureText(text).width / 2;
        const top = sy + node.radius * camera.scale + 7;
        const box = {
          x0: sx - halfWidth - 4,
          y0: top - 3,
          x1: sx + halfWidth + 4,
          y1: top + size + 3,
        };
        const collides = placed.some(
          (p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0,
        );
        if (collides) continue;
        placed.push(box);
        const alpha = (0.3 + node.brightness * 0.5) * reveal;
        ctx.fillStyle = `rgba(238, 210, 150, ${alpha})`;
        ctx.fillText(text, sx, top);
      }
      ctx.restore();
    };

    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(solver);
    };
  }, []);

  // --- Interaction -------------------------------------------------------

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const camera = cameraRef.current;
    const { width, height } = sizeRef.current;
    return {
      x: (sx - width / 2 - camera.x) / camera.scale,
      y: (sy - height / 2 - camera.y) / camera.scale,
    };
  }, []);

  const pickNode = useCallback(
    (sx: number, sy: number): LayoutNode | null => {
      const layout = layoutRef.current;
      if (!layout) return null;
      const world = screenToWorld(sx, sy);
      const camera = cameraRef.current;
      // Constant-ish screen-space hit slop so tiny stars stay clickable when zoomed out.
      const slop = 10 / camera.scale;
      let best: LayoutNode | null = null;
      let bestDist = Infinity;
      for (const node of layout.nodes) {
        const reach = node.radius + slop;
        const dist = Math.hypot(node.x - world.x, node.y - world.y);
        if (dist <= reach && dist < bestDist) {
          best = node;
          bestDist = dist;
        }
      }
      return best;
    },
    [screenToWorld],
  );

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          drag.moved = true;
          userMovedRef.current = true;
        }
        cameraRef.current.x += dx;
        cameraRef.current.y += dy;
        drag.x = e.clientX;
        drag.y = e.clientY;
        if (hover) setHover(null);
        return;
      }
      const node = pickNode(e.clientX, e.clientY);
      if (!node) {
        if (hover) setHover(null);
        return;
      }
      if (hover?.node === node) {
        // Same node — only refresh the anchor point.
        setHover({ node, screenX: e.clientX, screenY: e.clientY });
        return;
      }
      setHover({ node, screenX: e.clientX, screenY: e.clientY });
    },
    [hover, pickNode],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  // Wheel zoom toward the cursor. Registered natively so it can be non-passive.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userMovedRef.current = true;
      const camera = cameraRef.current;
      const { width, height } = sizeRef.current;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));
      const applied = next / camera.scale;
      // Keep the world point under the cursor pinned while scaling.
      const cx = e.clientX - width / 2;
      const cy = e.clientY - height / 2;
      camera.x = cx - (cx - camera.x) * applied;
      camera.y = cy - (cy - camera.y) * applied;
      camera.scale = next;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const clusterLabel = useMemo(() => {
    if (!graph || !hover) return null;
    return (
      graph.clusters.find((c) => c.id === hover.node.node.cluster)?.label ?? null
    );
  }, [graph, hover]);

  const stats = useMemo(() => {
    if (!graph) return null;
    return {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      clusters: graph.clusters.length,
      jumps: graph.meta.totalJumps,
    };
  }, [graph]);

  return (
    <div className="galaxy-root">
      <canvas
        ref={canvasRef}
        className="galaxy-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHover(null)}
      />

      <header className="galaxy-title">
        <span className="galaxy-title__mark">we were online</span>
        <span className="galaxy-title__sub">territory</span>
      </header>

      {stats && (
        <footer className="galaxy-legend">
          <span>{stats.nodes} sites</span>
          <span>{stats.edges} routes</span>
          <span>{stats.clusters} regions</span>
          <span>{stats.jumps.toLocaleString()} jumps</span>
        </footer>
      )}

      {settling && <div className="galaxy-status">condensing</div>}
      {error && <div className="galaxy-status galaxy-status--error">{error}</div>}

      {hover && (
        <div
          className="galaxy-tooltip"
          style={{ left: hover.screenX + 16, top: hover.screenY + 16 }}
        >
          <div className="galaxy-tooltip__domain">{hover.node.node.id}</div>
          <dl className="galaxy-tooltip__rows">
            <div>
              <dt>visits</dt>
              <dd>{hover.node.node.visits.toLocaleString()}</dd>
            </div>
            <div>
              <dt>people</dt>
              <dd>{hover.node.node.participants}</dd>
            </div>
            <div>
              <dt>routes</dt>
              <dd>{hover.node.degree}</dd>
            </div>
            {clusterLabel && (
              <div>
                <dt>region</dt>
                <dd>{clusterLabel}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
};

const container = document.getElementById("reactContent");
if (!container) throw new Error("#reactContent is missing from the page");

// Cache the root on the container so an HMR re-run of this module reuses it
// instead of calling createRoot twice on the same element.
interface RootHost extends HTMLElement {
  __galaxyRoot?: ReactDOM.Root;
}
const host = container as RootHost;
const root = host.__galaxyRoot ?? ReactDOM.createRoot(host);
host.__galaxyRoot = root;
root.render(<GalaxyMap />);
