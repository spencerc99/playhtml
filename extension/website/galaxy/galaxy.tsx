// ABOUTME: Transit map of browsing territory — stops, trunk lines, street mesh, walking mode.
// ABOUTME: Canvas 2D render with search, a controls pane, routing, and signpost navigation.

import "./galaxy.scss";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactDOM from "react-dom/client";
import {
  buildGroupLevels,
  buildRoutingIndex,
  createRandom,
  findRoute,
  findRumorStops,
  findTransitRoute,
  hopsFromSeeds,
  nodeKind,
  searchDomains,
  stepsFrom,
  type Graph,
  type GroupLevel,
  type LineCoverage,
  type NodeKind,
  type Route,
  type SearchHit,
  type Step,
} from "./graph-model";
import {
  buildTrunkPaths,
  CONVERGENCE_TICKS,
  REPULSION_RADIUS,
  seedLayout,
  SpatialGrid,
  stepLayout,
  type Layout,
  type LayoutNode,
} from "./layout";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type MapSettings,
} from "./controls";
import {
  buildLineIndex,
  buildLineLabels,
  describeRoute,
  lineRgba,
  narrateRoute,
  routeToText,
  segmentKey,
  summarizeRoute,
  type LineIndex,
  type LinesFile,
  type RouteSegment,
} from "./lines";

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const BG_COLOR = "#0d0c0a";
const STOP_FILL = "#f0ece0";
const STOP_STROKE = "#17150f";
const HUB_STROKE = "rgba(132, 142, 156, 0.75)";
const HUB_FILL = "rgba(38, 42, 50, 0.9)";
const LABEL_COLOR = "198, 192, 178";
const SEED_ACCENT = "#e8c27a";
const ROUTE_COLOR = "244, 240, 228";
const NEUTRAL_LINE: readonly [number, number, number] = [190, 184, 170];

const CLUSTER_HUES: ReadonlyArray<readonly [number, number, number]> = [
  [166, 122, 130],
  [116, 138, 168],
  [132, 152, 116],
  [178, 152, 104],
  [140, 128, 158],
  [112, 152, 150],
  [178, 132, 110],
  [146, 148, 118],
  [122, 134, 152],
  [170, 140, 140],
  [150, 126, 116],
  [128, 146, 134],
  [158, 138, 158],
];

function clusterTint(cluster: number): readonly [number, number, number] {
  const count = CLUSTER_HUES.length;
  const hue = CLUSTER_HUES[((cluster % count) + count) % count];
  if (!hue) throw new Error(`no tint for cluster ${cluster}`);
  return hue;
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

function stopRadius(node: LayoutNode, scale: number): number {
  const base = 1.5 + node.prominence * 4.6;
  const merged = Math.min(3.4, Math.sqrt(node.stop.members.length) * 0.6);
  return (base + merged) * scale;
}

/**
 * Stop glyphs. An interchange gets the classic double circle with a centre dot;
 * a stop hiding collapsed members gets stacked rings so you can tell at a glance
 * that there is more inside it.
 */
function drawStop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  kind: NodeKind,
  members: number,
  alpha: number,
): void {
  ctx.globalAlpha = alpha;

  if (kind === "hub") {
    const s = radius * 1.5;
    ctx.beginPath();
    ctx.rect(x - s, y - s, s * 2, s * 2);
    ctx.fillStyle = HUB_FILL;
    ctx.fill();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = HUB_STROKE;
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }

  // Stacked rings hint at collapsed contents before you hover.
  if (members > 1) {
    const rings = members > 40 ? 3 : 2;
    for (let i = rings; i >= 1; i--) {
      ctx.beginPath();
      ctx.arc(x, y, radius + i * 2.1, 0, Math.PI * 2);
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = `rgba(214, 204, 182, ${0.34 / i})`;
      ctx.stroke();
    }
  }

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = STOP_FILL;
  ctx.fill();
  if (radius > 1.3) {
    ctx.lineWidth = Math.min(1.4, radius * 0.42);
    ctx.strokeStyle = STOP_STROKE;
    ctx.stroke();
  }

  if (kind === "interchange") {
    // Double circle plus centre dot: the interchange-station convention.
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.85, 0, Math.PI * 2);
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = STOP_STROKE;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.85, 0, Math.PI * 2);
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = "rgba(240, 236, 224, 0.85)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.8, radius * 0.4), 0, Math.PI * 2);
    ctx.fillStyle = STOP_STROKE;
    ctx.fill();
  }

  if (kind === "seed") {
    ctx.lineWidth = 1;
    ctx.strokeStyle = SEED_ACCENT;
    ctx.beginPath();
    ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
    ctx.stroke();
    const tick = radius + 6.5;
    ctx.beginPath();
    ctx.moveTo(x - tick, y);
    ctx.lineTo(x - radius - 1.5, y);
    ctx.moveTo(x + radius + 1.5, y);
    ctx.lineTo(x + tick, y);
    ctx.moveTo(x, y - tick);
    ctx.lineTo(x, y - radius - 1.5);
    ctx.moveTo(x, y + radius + 1.5);
    ctx.lineTo(x, y + tick);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Metro lines
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

/**
 * Stroke a polyline with circle-arc corners.
 *
 * The arc matters, and a quadratic bezier will not do: the parallel offset of a
 * circular arc is another circular arc with the same centre, so two lines
 * rounding the same corner at different offsets stay exactly parallel through
 * the turn. Offset beziers are not beziers, so with quadratics the gap between
 * ribbons pinches and swells mid-corner and the bundle visibly wobbles.
 *
 * `arcTo` fits the largest circle tangent to both segments up to `radius`, so
 * the corner radius is clamped per vertex and never overruns a short span.
 */
function strokeRounded(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  radius: number,
): void {
  const first = points[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  if (points.length === 2) {
    const second = points[1];
    if (second) ctx.lineTo(second.x, second.y);
    ctx.stroke();
    return;
  }
  for (let i = 1; i + 1 < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    const next = points[i + 1];
    if (!previous || !current || !next) continue;
    const inX = current.x - previous.x;
    const inY = current.y - previous.y;
    const outX = next.x - current.x;
    const outY = next.y - current.y;
    const inLen = Math.hypot(inX, inY);
    const outLen = Math.hypot(outX, outY);
    if (inLen < 1e-6 || outLen < 1e-6) {
      ctx.lineTo(current.x, current.y);
      continue;
    }
    // arcTo places its tangent points r/tan(theta/2) back from the corner, and
    // that distance runs away as the turn gets shallow: a nearly straight
    // corner asks for a tangent point far beyond the segment, which canvas
    // duly draws as an enormous sweeping curve across the map. Clamping r by
    // the shorter span is NOT enough, because the blow-up is in the tangent,
    // not in r. So solve for the r whose tangent fits the spans and use that.
    const dot = (inX * outX + inY * outY) / (inLen * outLen);
    const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
    const halfTurn = (Math.PI - theta) / 2;
    // Straight enough that there is no corner worth rounding.
    if (halfTurn < 1e-3 || !Number.isFinite(halfTurn)) {
      ctx.lineTo(current.x, current.y);
      continue;
    }
    const maxTangent = Math.min(inLen, outLen) * 0.5;
    const r = Math.min(radius, maxTangent * Math.tan(halfTurn));
    if (r < 1e-4) {
      ctx.lineTo(current.x, current.y);
      continue;
    }
    ctx.arcTo(current.x, current.y, next.x, next.y, r);
  }
  const last = points[points.length - 1];
  if (last) ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/**
 * A station tick on a line: a short bar across the line's direction, the way a
 * metro map marks a stop that is not an interchange.
 */
function drawLineTick(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  color: string,
): void {
  const nx = -Math.sin(angle) * length;
  const ny = Math.cos(angle) * length;
  ctx.beginPath();
  ctx.moveTo(x - nx, y - ny);
  ctx.lineTo(x + nx, y + ny);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/**
 * The transit-map interchange glyph: one white capsule laid ACROSS the parallel
 * ribbons, rotated to the corridor direction, so a single mark says "these
 * lines all call here". Drawing a separate marker per line instead turns a busy
 * junction into a pile of dots and hides the fact that it is one station.
 *
 * `span` is the distance between the outermost ribbons at this stop; the
 * capsule is grown a little past them so it visibly caps the bundle.
 */
function drawStationBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  span: number,
  thickness: number,
  alpha: number,
): void {
  // Perpendicular to the corridor: the bar crosses the ribbons, not along them.
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const half = span / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - nx * half, y - ny * half);
  ctx.lineTo(x + nx * half, y + ny * half);
  // Dark backing first so the capsule reads against the ribbons it covers.
  ctx.lineWidth = thickness + 1.6;
  ctx.strokeStyle = "rgba(16, 15, 12, 0.9)";
  ctx.stroke();
  ctx.lineWidth = thickness;
  ctx.strokeStyle = "rgba(244, 240, 228, 0.96)";
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

function paintBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  const random = createRandom(0x1a7e5eed);
  const lift = ctx.createRadialGradient(
    width * 0.5,
    height * 0.46,
    0,
    width * 0.5,
    height * 0.46,
    Math.max(width, height) * 0.72,
  );
  lift.addColorStop(0, "rgba(46, 40, 30, 0.45)");
  lift.addColorStop(1, "rgba(46, 40, 30, 0)");
  ctx.fillStyle = lift;
  ctx.fillRect(0, 0, width, height);

  const grainCount = Math.round((width * height) / 900);
  for (let i = 0; i < grainCount; i++) {
    ctx.fillStyle =
      random() > 0.5
        ? `rgba(232, 222, 200, ${random() * 0.016})`
        : `rgba(120, 104, 80, ${random() * 0.024})`;
    ctx.fillRect(random() * width, random() * height, 1, 1);
  }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

interface Camera {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 12;
const PRESOLVE_TICKS = 120;
const MORPH_MS = 620;
/** Camera glide when travelling or jumping to a search hit. */
const GLIDE_MS = 700;

interface HoverState {
  node: LayoutNode;
  screenX: number;
  screenY: number;
}

interface Signpost {
  step: Step;
  node: LayoutNode;
  /** Screen-space angle from the focused stop toward the destination. */
  angle: number;
}

interface TravelLog {
  stops: string[];
  legs: Array<{ from: string; to: string; mode: "ride" | "walk"; cost: number }>;
}

const GROUP_LABELS = ["every domain", "fold fringe", "merge satellites", "interchanges"];

const TransitMap = (): React.ReactElement => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [graph, setGraph] = useState<Graph | null>(null);
  const [linesFile, setLinesFile] = useState<LinesFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [settling, setSettling] = useState(true);
  const [settings, setSettings] = useState<MapSettings>(() => loadSettings());
  const [controlsOpen, setControlsOpen] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [route, setRoute] = useState<Route | null>(null);
  /** Set when a requested trip has no legal one-way path, so we can say so. */
  const [noRoute, setNoRoute] = useState<{ from: string; to: string } | null>(null);
  /** True when transit was requested but only a streets route exists. */
  const [transitFallback, setTransitFallback] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [walkingFrom, setWalkingFrom] = useState<string | null>(null);
  const [travel, setTravel] = useState<TravelLog | null>(null);
  const [copied, setCopied] = useState(false);
  /** Mirrors signpostsRef length so the walking panel re-renders with it. */
  const [signpostCount, setSignpostCount] = useState(0);
  /** Legend hover. Transient by nature, so unlike the pinned focus it is not persisted. */
  const [hoveredLine, setHoveredLine] = useState<string | null>(null);

  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const layoutRef = useRef<Layout | null>(null);
  const backdropRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const tickRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const needsFramingRef = useRef(false);
  const userMovedRef = useRef(false);
  const labelOrderRef = useRef<LayoutNode[]>([]);
  const morphFromRef = useRef<Map<string, { x: number; y: number }> | null>(null);
  const morphStartRef = useRef(0);
  const flashRef = useRef<{ id: string; at: number } | null>(null);
  const glideRef = useRef<{
    fromX: number;
    fromY: number;
    fromScale: number;
    toX: number;
    toY: number;
    toScale: number;
    at: number;
  } | null>(null);

  useEffect(() => saveSettings(settings), [settings]);

  // Refs the render loop reads, so it is created once rather than torn down and
  // restarted (which would also restart the simulation) on every state change.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const hoverIdRef = useRef<string | null>(null);
  hoverIdRef.current = hover?.node.stop.id ?? null;
  const routeRef = useRef<Route | null>(null);
  routeRef.current = route;
  const selectionRef = useRef<string[]>([]);
  selectionRef.current = selection;
  const walkingFromRef = useRef<string | null>(null);
  walkingFromRef.current = walkingFrom;
  const signpostsRef = useRef<Signpost[]>([]);
  const travelRef = useRef<TravelLog | null>(null);
  travelRef.current = travel;
  /**
   * Where each signpost was actually painted this frame. The plates are sized
   * to their text, so the click target has to come from the render rather than
   * being guessed at a fixed width.
   */
  const signpostBoxesRef = useRef<
    Array<{ post: Signpost; x: number; y: number; w: number; h: number }>
  >([]);
  const lineIndexRef = useRef<LineIndex | null>(null);
  const lineLabelsRef = useRef<ReadonlyMap<string, string>>(new Map());
  /** Hover wins over the pinned legend selection, so a scan reads immediately. */
  const litLineRef = useRef<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    fetch("./lines.json")
      .then((res) => {
        if (!res.ok) throw new Error(`lines.json responded ${res.status}`);
        return res.json() as Promise<LinesFile>;
      })
      .then((data) => {
        if (cancelled) return;
        if (!Array.isArray(data.lines)) {
          throw new Error("lines.json is missing lines");
        }
        setLinesFile(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const levels = useMemo<GroupLevel[] | null>(
    () => (graph ? buildGroupLevels(graph) : null),
    [graph],
  );

  const level = levels?.[settings.groupLevel] ?? null;

  const hubIds = useMemo(() => {
    const ids = new Set<string>();
    if (!graph) return ids;
    for (const node of graph.nodes) {
      if (nodeKind(node) === "hub") ids.add(node.id);
    }
    return ids;
  }, [graph]);

  /** Lines resolved against the active grouping level. */
  const lineIndex = useMemo<LineIndex | null>(
    () => (level && linesFile ? buildLineIndex(level, linesFile.lines) : null),
    [level, linesFile],
  );

  /**
   * Prices a hop that a drawn line covers, so trips prefer riding a line over
   * an equivalent scramble through the street mesh. Null until the lines load,
   * which simply means the first frames route at undiscounted cost.
   */
  const onLine = useMemo<LineCoverage | undefined>(() => {
    if (!lineIndex) return undefined;
    const covered = lineIndex.coveredEdges;
    return (a: string, b: string) => covered.has(segmentKey(a, b));
  }, [lineIndex]);

  const routingIndex = useMemo(
    () => (level ? buildRoutingIndex(level, onLine) : null),
    [level, onLine],
  );

  /** Display names, numbered where the generator reused one. */
  const lineLabels = useMemo(
    () => (linesFile ? buildLineLabels(linesFile.lines) : new Map<string, string>()),
    [linesFile],
  );

  lineIndexRef.current = lineIndex;
  lineLabelsRef.current = lineLabels;
  litLineRef.current = hoveredLine ?? settings.focusedLine;

  /** Uncrawled dead-ends, held back from the resting view. */
  const rumors = useMemo(
    () => (level ? findRumorStops(level, routingIndex ?? undefined) : new Set<string>()),
    [level, routingIndex],
  );

  const seedStopIds = useMemo(() => {
    if (!graph || !level) return [];
    const ids: string[] = [];
    for (const node of graph.nodes) {
      if (nodeKind(node) !== "seed") continue;
      const stop = level.stopOf.get(node.id);
      if (stop) ids.push(stop);
    }
    return ids;
  }, [graph, level]);

  const seedHops = useMemo(() => {
    if (!level || settings.seedFocusHops <= 0) return null;
    return hopsFromSeeds(level, seedStopIds);
  }, [level, seedStopIds, settings.seedFocusHops]);

  const seedHopsRef = useRef<Map<string, number> | null>(null);
  seedHopsRef.current = seedHops;

  // Rebuild the layout when the grouping or spread changes.
  useEffect(() => {
    if (!level) return;

    const previous = layoutRef.current;
    if (previous) {
      const from = new Map<string, { x: number; y: number }>();
      for (const node of previous.nodes) {
        for (const member of node.stop.members) {
          from.set(member.id, { x: node.x, y: node.y });
        }
      }
      morphFromRef.current = from;
    }

    const next = seedLayout(level, settings.spread, rumors);
    const grid = new SpatialGrid(REPULSION_RADIUS);
    for (let i = 0; i < PRESOLVE_TICKS; i++) {
      stepLayout(next, grid, 1 - i / CONVERGENCE_TICKS);
    }
    buildTrunkPaths(next);
    layoutRef.current = next;
    labelOrderRef.current = [...next.nodes].sort(
      (a, b) => b.prominence - a.prominence,
    );
    tickRef.current = PRESOLVE_TICKS;
    morphStartRef.current = performance.now();
    setSettling(true);
    needsFramingRef.current = true;
  }, [level, settings.spread, rumors]);

  /**
   * Resolve a trip, falling back to an undirected path when no legal one-way
   * route exists. Never leaves the user with silence: either a highlighted
   * route (solid, or dashed when it goes against one-way links) or an explicit
   * "no route" panel.
   */
  const resolveRoute = useCallback(
    (fromStop: string, toStop: string) => {
      if (!level || !routingIndex) return;
      if (fromStop === toStop) {
        setRoute(null);
        setNoRoute(null);
        return;
      }
      const isHub = (id: string) => hubIds.has(id);

      // Transit first when asked, but never leave the user stranded: if the
      // backbone cannot get there, fall back to streets and say so.
      if (settings.routeMode === "transit") {
        const viaTransit = findTransitRoute(
          level,
          fromStop,
          toStop,
          isHub,
          routingIndex,
        );
        if (viaTransit) {
          setRoute(viaTransit);
          setNoRoute(null);
          setTransitFallback(false);
          return;
        }
      }

      const direct = findRoute(level, fromStop, toStop, isHub, routingIndex);
      if (direct) {
        setRoute(direct);
        setNoRoute(null);
        setTransitFallback(settings.routeMode === "transit");
        return;
      }
      const relaxed = findRoute(
        level,
        fromStop,
        toStop,
        isHub,
        undefined,
        true,
        onLine,
      );
      setRoute(relaxed);
      setTransitFallback(relaxed !== null && settings.routeMode === "transit");
      setNoRoute(relaxed ? null : { from: fromStop, to: toStop });
    },
    [level, routingIndex, hubIds, settings.routeMode, onLine],
  );

  // Recompute the route when the level changes under an active selection.
  useEffect(() => {
    if (!level || selection.length !== 2) return;
    const from = level.stopOf.get(selection[0] ?? "");
    const to = level.stopOf.get(selection[1] ?? "");
    if (!from || !to) {
      setRoute(null);
        setNoRoute(null);
      return;
    }
    resolveRoute(from, to);
  }, [level, selection, resolveRoute]);

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

  /** Centre the camera on a stop, gliding rather than jumping. */
  const glideTo = useCallback((node: LayoutNode, scale?: number) => {
    const camera = cameraRef.current;
    const targetScale = scale ?? Math.max(camera.scale, 1.1);
    glideRef.current = {
      fromX: camera.x,
      fromY: camera.y,
      fromScale: camera.scale,
      toX: -node.x * targetScale,
      toY: -node.y * targetScale,
      toScale: targetScale,
      at: performance.now(),
    };
    userMovedRef.current = true;
    needsFramingRef.current = false;
  }, []);

  // --- Render loop -------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable for the map canvas");

    let frame = 0;
    const grid = new SpatialGrid(REPULSION_RADIUS);

    const advance = (steps: number) => {
      const layout = layoutRef.current;
      if (!layout || tickRef.current >= CONVERGENCE_TICKS) return;
      for (let i = 0; i < steps && tickRef.current < CONVERGENCE_TICKS; i++) {
        tickRef.current++;
        stepLayout(layout, grid, 1 - tickRef.current / CONVERGENCE_TICKS);
      }
      // Trunk elbows follow the stops, so refresh them as the map settles.
      buildTrunkPaths(layout);
      if (tickRef.current >= CONVERGENCE_TICKS) setSettling(false);
    };

    const solver = window.setInterval(() => {
      if (tickRef.current >= CONVERGENCE_TICKS) {
        window.clearInterval(solver);
        return;
      }
      if (document.hidden) advance(200);
    }, 32);

    const render = () => {
      frame = requestAnimationFrame(render);
      const layout = layoutRef.current;
      const backdrop = backdropRef.current;
      const { width, height, dpr } = sizeRef.current;
      if (!backdrop || width === 0) return;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(backdrop, 0, 0);
      if (!layout) return;

      advance(3);

      const opts = settingsRef.current;
      const camera = cameraRef.current;

      if (needsFramingRef.current && !userMovedRef.current) {
        // Frame the actual bounding box, not a radius about the origin: the
        // bundled fringe pulls the mass well off-centre, and assuming the map
        // is centred parks most of it off screen.
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const n of layout.nodes) {
          // Frame the charted network only: rumors are hidden at rest, and
          // including them shrinks the real map into a fraction of the canvas.
          if (!opts.showRumors && n.rumor) continue;
          if (n.x < minX) minX = n.x;
          if (n.x > maxX) maxX = n.x;
          if (n.y < minY) minY = n.y;
          if (n.y > maxY) maxY = n.y;
        }
        if (Number.isFinite(minX) && Number.isFinite(minY)) {
          const spanX = Math.max(maxX - minX, 1);
          const spanY = Math.max(maxY - minY, 1);
          const scale = Math.min(
            (width * 0.86) / spanX,
            (height * 0.86) / spanY,
          );
          camera.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
          camera.x = -((minX + maxX) / 2) * camera.scale;
          camera.y = -((minY + maxY) / 2) * camera.scale;
        }
        if (tickRef.current >= CONVERGENCE_TICKS) needsFramingRef.current = false;
      }

      // Camera glide toward a search hit or a travelled stop.
      const glide = glideRef.current;
      if (glide) {
        const t = Math.min(1, (performance.now() - glide.at) / GLIDE_MS);
        const e = 1 - Math.pow(1 - t, 3);
        camera.x = glide.fromX + (glide.toX - glide.fromX) * e;
        camera.y = glide.fromY + (glide.toY - glide.fromY) * e;
        camera.scale = glide.fromScale + (glide.toScale - glide.fromScale) * e;
        if (t >= 1) glideRef.current = null;
      }

      const reveal = Math.min(1, tickRef.current / (CONVERGENCE_TICKS * 0.4));
      const hoveredId = hoverIdRef.current;
      const activeRoute = routeRef.current;
      const routeSet = activeRoute ? new Set(activeRoute.stops) : null;
      const selected = new Set(selectionRef.current);
      const walking = walkingFromRef.current;
      const hops = seedHopsRef.current;
      const focusHops = opts.seedFocusHops;

      const morphT = Math.min(
        1,
        (performance.now() - morphStartRef.current) / MORPH_MS,
      );
      const morphFrom = morphT < 1 ? morphFromRef.current : null;
      const ease = 1 - Math.pow(1 - morphT, 3);
      const posOf = (node: LayoutNode): { x: number; y: number } => {
        if (!morphFrom) return node;
        const start = morphFrom.get(node.stop.representative.id);
        if (!start) return node;
        return {
          x: start.x + (node.x - start.x) * ease,
          y: start.y + (node.y - start.y) * ease,
        };
      };

      // The stop whose neighbourhood is being revealed: hover wins, else the
      // walking origin, else a single selection.
      const focusId =
        hoveredId ??
        walking ??
        (selectionRef.current.length === 1 ? selectionRef.current[0] : null);
      const focusStopId = focusId
        ? layout.byId.has(focusId)
          ? focusId
          : null
        : null;

      // Neighbours of the focused stop, with direction, computed only for that
      // one stop so the reveal stays cheap.
      const neighborDir = new Map<string, "out" | "in" | "both">();
      if (focusStopId) {
        for (const edge of layout.edges) {
          const isA = edge.a.stop.id === focusStopId;
          const isB = edge.b.stop.id === focusStopId;
          if (!isA && !isB) continue;
          const other = isA ? edge.b.stop.id : edge.a.stop.id;
          const outward = isA ? edge.jumps > 0 : edge.back > 0;
          const inward = isA ? edge.back > 0 : edge.jumps > 0;
          const dir = outward && inward ? "both" : outward ? "out" : "in";
          const existing = neighborDir.get(other);
          neighborDir.set(
            other,
            existing && existing !== dir ? "both" : dir,
          );
        }
      }

      // Rumors materialize only when you look their way: their anchor is
      // hovered, selected or being walked from, or the camera is deep enough
      // into their neighbourhood that the local view has room for them.
      const localReveal = camera.scale >= 1.6;
      const revealedAnchors = new Set<string>();
      if (focusStopId) revealedAnchors.add(focusStopId);
      for (const id of selectionRef.current) revealedAnchors.add(id);
      if (walking) revealedAnchors.add(walking);

      const rumorVisible = (node: LayoutNode): boolean => {
        if (!node.rumor) return true;
        if (opts.showRumors) return true;
        if (localReveal) return true;
        const anchor = node.bundleParent?.stop.id;
        if (anchor && revealedAnchors.has(anchor)) return true;
        return revealedAnchors.has(node.stop.id);
      };

      const dimmedBy = (stopId: string): number => {
        if (focusHops > 0 && hops) {
          const h = hops.get(stopId);
          if (h === undefined || h > focusHops) return 0.12;
        }
        return 1;
      };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(width / 2 + camera.x, height / 2 + camera.y);
      ctx.scale(camera.scale, camera.scale);

      const halfW = width / 2 / camera.scale;
      const halfH = height / 2 / camera.scale;
      const viewMinX = -camera.x / camera.scale - halfW - 140;
      const viewMaxX = -camera.x / camera.scale + halfW + 140;
      const viewMinY = -camera.y / camera.scale - halfH - 140;
      const viewMaxY = -camera.y / camera.scale + halfH + 140;

      // --- Lines -----------------------------------------------------------
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const routeLegs = activeRoute
        ? new Set(activeRoute.legs.map((l) => `${l.from}>${l.to}`))
        : null;

      // Roads a metro line already draws are not drawn again underneath it:
      // the line IS that road's rendering, so a doubled stroke would only
      // fatten and desaturate the colour.
      const lines = lineIndexRef.current;
      const linesOn = lines !== null && opts.showLines;

      for (const edge of layout.edges) {
        // A road to a hidden rumor is hidden with it.
        if (!rumorVisible(edge.a) || !rumorVisible(edge.b)) continue;
        if (opts.lineMode === "trunk" && !edge.trunk) continue;
        if (
          linesOn &&
          lines.coveredEdges.has(segmentKey(edge.a.stop.id, edge.b.stop.id))
        ) {
          continue;
        }

        const pa = posOf(edge.a);
        const pb = posOf(edge.b);
        if (
          Math.max(pa.x, pb.x) < viewMinX ||
          Math.min(pa.x, pb.x) > viewMaxX ||
          Math.max(pa.y, pb.y) < viewMinY ||
          Math.min(pa.y, pb.y) > viewMaxY
        ) {
          continue;
        }

        const aId = edge.a.stop.id;
        const bId = edge.b.stop.id;
        const onRoute =
          routeLegs !== null &&
          (routeLegs.has(`${aId}>${bId}`) || routeLegs.has(`${bId}>${aId}`));
        const touchesFocus =
          focusStopId !== null && (aId === focusStopId || bId === focusStopId);

        const muted = routeSet !== null && !onRoute;
        const focusDim = Math.min(dimmedBy(aId), dimmedBy(bId));

        // Drainage drives the hierarchy. Raising flow01 to a steep power is
        // what separates rivers from capillaries: the export's flow01 is
        // tightly bunched around 0.36, so a linear ramp would draw eleven
        // thousand near-identical roads. The exponent collapses that bunching
        // toward zero and leaves only the genuine corridors with weight.
        //
        // `trunk` is deliberately ignored here. It marks a spanning forest, and
        // the vast majority of trunk edges turn out to be low-flow, so treating
        // it as hierarchy contradicts the terrain the traffic actually shows.
        const river = Math.pow(edge.flow01, opts.flowExponent);

        // Rivers are the map's structure and must be legible on their own
        // terms, so the mesh-opacity control scales only the capillary floor —
        // letting it scale the whole ramp would dim the corridors along with
        // the noise, which is the opposite of showing drainage.
        // A highlighted route runs at full river strength whatever the zoom, so
        // the journey reads as a course down a tributary and into the main flow.
        const baseAlpha = 0.05 + opts.meshOpacity * 0.5 + river * 0.9;
        const alpha =
          (onRoute ? 0.97 : baseAlpha) *
          (muted ? 0.14 : 1) *
          (touchesFocus ? 1.9 : 1) *
          focusDim *
          reveal;
        if (alpha < 0.012) continue;

        // Cluster tint says which region a road belongs to; drainage says how
        // much it carries. Fade the tint out as flow rises so the big corridors
        // converge on bone — a river is terrain, not a regional detail, and
        // leaving it tinted makes it compete with the metro lines' colours.
        const tint = opts.clusterHues
          ? edge.internal
            ? clusterTint(edge.a.stop.cluster)
            : NEUTRAL_LINE
          : NEUTRAL_LINE;
        const toBone = Math.min(1, river * 1.4);
        const color = onRoute
          ? ROUTE_COLOR
          : `${Math.round(tint[0] + (238 - tint[0]) * toBone)}, ` +
            `${Math.round(tint[1] + (233 - tint[1]) * toBone)}, ` +
            `${Math.round(tint[2] + (219 - tint[2]) * toBone)}`;

        // Hairline to river. The floor is sub-pixel on purpose: a capillary
        // should be a suggestion of a road, not a drawn one.
        const mutual = edge.jumps > 0 && edge.back > 0;
        const widthBase = 0.16 + river * 3.84;
        const lineWidth =
          ((onRoute ? Math.max(3.2, widthBase) : widthBase) *
            (mutual ? 1.18 : 1)) /
          Math.sqrt(camera.scale);

        const oneWay = !mutual && opts.directionTapers;
        if (oneWay) {
          // Taper thick-at-source to thin-at-target. Canvas has no variable
          // stroke width, so lay down a few segments of decreasing width.
          const from = edge.jumps > 0 ? pa : pb;
          const to = edge.jumps > 0 ? pb : pa;
          const segments = 5;
          for (let i = 0; i < segments; i++) {
            const t0 = i / segments;
            const t1 = (i + 1) / segments;
            ctx.beginPath();
            ctx.moveTo(from.x + (to.x - from.x) * t0, from.y + (to.y - from.y) * t0);
            ctx.lineTo(from.x + (to.x - from.x) * t1, from.y + (to.y - from.y) * t1);
            ctx.lineWidth = lineWidth * (1.25 - t1 * 1.05);
            ctx.strokeStyle = `rgba(${color}, ${Math.min(alpha, 0.95)})`;
            ctx.stroke();
          }
          continue;
        }

        ctx.strokeStyle = `rgba(${color}, ${Math.min(alpha, 0.95)})`;
        ctx.lineWidth = lineWidth;
        // A fallback route ignores one-way links, so draw it dashed to say so.
        if (onRoute && activeRoute?.againstOneWay) {
          ctx.setLineDash([7 / camera.scale, 5 / camera.scale]);
        }
        ctx.beginPath();

        // Octilinear elbows are a poster device for major corridors. Most trunk
        // edges are low-flow, so applying elbows by `trunk` would impose a grid
        // on the whole capillary bed; restrict them to roads that read as rivers.
        if (river > 0.4 && edge.trunkPath && edge.trunkPath.length === 3) {
          // Rounded elbow so octilinear trunks read as drawn lines, not corners.
          const [p0, p1, p2] = edge.trunkPath;
          if (p0 && p1 && p2) {
            const r = Math.min(
              14,
              Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.45,
              Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.45,
            );
            const d0 = Math.max(1e-6, Math.hypot(p1.x - p0.x, p1.y - p0.y));
            const d1 = Math.max(1e-6, Math.hypot(p2.x - p1.x, p2.y - p1.y));
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x - ((p1.x - p0.x) / d0) * r, p1.y - ((p1.y - p0.y) / d0) * r);
            ctx.quadraticCurveTo(
              p1.x,
              p1.y,
              p1.x + ((p2.x - p1.x) / d1) * r,
              p1.y + ((p2.y - p1.y) / d1) * r,
            );
            ctx.lineTo(p2.x, p2.y);
          }
        } else {
          const dx = pb.x - pa.x;
          const dy = pb.y - pa.y;
          // Lean a tributary toward the river it joins. The pull is applied to
          // the intermediate control points only — the endpoints stay pinned to
          // their stops — so the road still starts and ends where it must, but
          // approaches tangentially instead of cutting across the corridor.
          let pullX = 0;
          let pullY = 0;
          const toward = edge.bundleToward;
          if (opts.bundleTributaries && toward) {
            const ra = posOf(toward.a);
            const rb = posOf(toward.b);
            const midX = (ra.x + rb.x) / 2;
            const midY = (ra.y + rb.y) / 2;
            // Weaker for roads that are themselves fairly busy, so the bending
            // fades out rather than snapping on at the threshold.
            const strength = 0.18 * (1 - edge.flow01 / 0.5);
            pullX = (midX - (pa.x + pb.x) / 2) * strength;
            pullY = (midY - (pa.y + pb.y) / 2) * strength;
          }
          ctx.moveTo(pa.x, pa.y);
          let prevX = pa.x;
          let prevY = pa.y;
          for (let i = 0; i < edge.wobble.length; i++) {
            const t = (i + 1) / (edge.wobble.length + 1);
            const off = edge.wobble[i] ?? 0;
            // Pull hardest mid-span and not at all at the ends: sin gives that
            // shape without a branch, keeping the join smooth.
            const bend = Math.sin(t * Math.PI);
            const px = pa.x + dx * t - dy * off + pullX * bend;
            const py = pa.y + dy * t + dx * off + pullY * bend;
            ctx.quadraticCurveTo(prevX, prevY, (prevX + px) / 2, (prevY + py) / 2);
            prevX = px;
            prevY = py;
          }
          ctx.quadraticCurveTo(prevX, prevY, pb.x, pb.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // --- Metro lines -----------------------------------------------------
      // Drawn after the street mesh so they sit on top of it, and before the
      // stops so station markers cap the line ends rather than being buried.

      const litLine = litLineRef.current;

      // Which lines are worth drawing at this zoom. All 66 at once is a
      // thicket from far away, so the resting view shows the busiest few and
      // the rest fade in as you close on the map — the same semantic-zoom
      // bargain the stop labels and the flow ramp already make. A pinned or
      // hovered line always draws, whatever its rank.
      const restingCount = opts.restingLineCount;
      const visibleLineIds =
        lines === null || restingCount <= 0
          ? null
          : new Set(
              lines.byProminence.slice(
                0,
                Math.min(
                  lines.byProminence.length,
                  // Roughly doubles by the time the map fills the screen.
                  Math.round(restingCount * (1 + Math.max(0, camera.scale - 0.8) * 1.6)),
                ),
              ),
            );

      /** Where each line's stops actually landed, reused by the tick pass. */
      const linePoints = new Map<string, Point[]>();
      /** The same stops shifted onto the line's parallel slot, for station glyphs. */
      const offsetPoints = new Map<string, Point[]>();
      /** The stops each line actually drew, which omits any hidden fringe. */
      const drawnLineStops = new Map<string, string[]>();
      if (linesOn) {
        for (const entry of lines.resolved) {
          // Below the resting budget and not singled out: hold it back.
          if (
            visibleLineIds !== null &&
            !visibleLineIds.has(entry.line.id) &&
            litLine !== entry.line.id
          ) {
            continue;
          }
          const points: Point[] = [];
          // Kept in step with `points`, because a line may skip stops the map
          // is hiding and the tick and station passes index the two together.
          const drawnStops: string[] = [];
          for (const stopId of entry.stops) {
            const node = layout.byId.get(stopId);
            if (!node) continue;
            // A line calling at a stop the map is currently hiding must not
            // draw out to it: the fringe is bundled far outside the framed
            // area, so such a span renders as a ray shooting off the map.
            if (!rumorVisible(node)) continue;
            const at = posOf(node);
            points.push(at);
            drawnStops.push(stopId);
          }
          if (points.length < 2) continue;
          linePoints.set(entry.line.id, points);
          drawnLineStops.set(entry.line.id, drawnStops);

          // Cull off-screen lines by their bounding box, so a zoomed-in view
          // pays for only the lines it can see.
          let minX = Infinity;
          let maxX = -Infinity;
          let minY = Infinity;
          let maxY = -Infinity;
          for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
          if (
            maxX < viewMinX ||
            minX > viewMaxX ||
            maxY < viewMinY ||
            minY > viewMaxY
          ) {
            continue;
          }

          const dimmed = litLine !== null && litLine !== entry.line.id;
          const lit = litLine === entry.line.id;
          // A highlighted route owns the map while it is shown; lines under it
          // stay legible but step back.
          const routeMuted = routeSet !== null && litLine === null;
          // At rest all 43 lines are on screen at once, which at full strength
          // is a thicket rather than a network. Hold them at a weight where the
          // colour still separates them but the stops stay the brighter layer,
          // and let zooming in — where fewer lines are in frame — bring them up.
          const restStrength = Math.min(1, 0.44 + camera.scale * 0.3);
          const alpha =
            (dimmed ? 0.07 : lit ? 0.95 : 0.72 * restStrength) *
            (routeMuted ? 0.4 : 1) *
            reveal;
          if (alpha < 0.012) continue;

          const width =
            ((lit ? 3.4 : 1.5 + restStrength * 0.9) / Math.sqrt(camera.scale)) *
            opts.nodeScale;

          // Build ONE offset polyline for the whole line and stroke it once, so
          // the arc joins actually happen at the corners between spans. Drawing
          // span by span would cap each span separately and never round the
          // junction, which is what makes a bundle look like scattered sticks
          // rather than continuous ribbons.
          //
          // Each vertex takes the offset of the span it leads into, so a line
          // steps to its new slot at the stop where its companions change —
          // which is where a real map moves it too.
          const shifted: Point[] = [];
          for (let i = 0; i < points.length; i++) {
            const here = points[i];
            if (!here) continue;
            // The span this vertex belongs to: the outgoing one, except at the
            // final stop, which takes the incoming span's offset.
            const spanIndex = Math.min(i, points.length - 2);
            const fromId = drawnStops[spanIndex];
            const toId = drawnStops[spanIndex + 1];
            let offset = 0;
            if (fromId !== undefined && toId !== undefined) {
              const bucket = lines.segments.get(segmentKey(fromId, toId));
              offset = bucket?.find((s) => s.lineId === entry.line.id)?.offset ?? 0;
            }
            const previous = points[i - 1];
            const next = points[i + 1];
            // Offset along the bisector of the adjacent spans, so the ribbon
            // keeps a constant perpendicular distance through the corner.
            const dx = (next?.x ?? here.x) - (previous?.x ?? here.x);
            const dy = (next?.y ?? here.y) - (previous?.y ?? here.y);
            const len = Math.hypot(dx, dy);
            // Coincident neighbours give no direction to offset along; nudging
            // by an arbitrary normal there throws the vertex off the map.
            if (len < 1e-6) {
              shifted.push({ x: here.x, y: here.y });
              continue;
            }
            // The gap is a screen-space quantity, so it divides by scale — but
            // when zoomed far out that inflates into huge world distances and
            // the ribbon flies off the map. Cap it against the span it belongs
            // to, so an offset can never dominate the geometry it decorates.
            const spanLength = Math.max(
              1e-6,
              Math.hypot(
                (next?.x ?? here.x) - (previous?.x ?? here.x),
                (next?.y ?? here.y) - (previous?.y ?? here.y),
              ),
            );
            const scaled =
              Math.sign(offset) *
              Math.min(Math.abs(offset) / camera.scale, spanLength * 0.4);
            shifted.push({
              x: here.x + (-dy / len) * scaled,
              y: here.y + (dx / len) * scaled,
            });
          }
          offsetPoints.set(entry.line.id, shifted);
          ctx.strokeStyle = lineRgba(entry.rgb, Math.min(alpha, 0.95));
          ctx.lineWidth = width;
          strokeRounded(ctx, shifted, 14 / camera.scale);
        }

        // --- Station ticks and interchange rings ---------------------------
        for (const entry of lines.resolved) {
          const points = linePoints.get(entry.line.id);
          if (!points) continue;
          const dimmed = litLine !== null && litLine !== entry.line.id;
          const alpha = (dimmed ? 0.1 : 0.9) * reveal;
          if (alpha < 0.02) continue;
          // A single-line stop keeps its coloured tick, drawn on the ribbon's
          // own offset position rather than the bare stop, so the tick sits on
          // the line instead of floating beside it.
          const shifted = offsetPoints.get(entry.line.id) ?? points;
          const drawn = drawnLineStops.get(entry.line.id) ?? entry.stops;
          shifted.forEach((point, i) => {
            const stopId = drawn[i];
            if (stopId === undefined) return;
            // Multi-line stops are capped by one shared bar instead.
            if (lines.interchangeStops.has(stopId)) return;
            if (
              point.x < viewMinX ||
              point.x > viewMaxX ||
              point.y < viewMinY ||
              point.y > viewMaxY
            ) {
              return;
            }
            const neighbor = shifted[i + 1] ?? shifted[i - 1];
            if (!neighbor) return;
            const angle = Math.atan2(neighbor.y - point.y, neighbor.x - point.x);
            drawLineTick(
              ctx,
              point.x,
              point.y,
              angle,
              (4.2 / Math.sqrt(camera.scale)) * opts.nodeScale,
              1.6 / Math.sqrt(camera.scale),
              lineRgba(entry.rgb, Math.min(alpha, 0.95)),
            );
          });
        }

        // --- Interchange station bars --------------------------------------
        for (const stopId of lines.interchangeStops) {
          const node = layout.byId.get(stopId);
          if (!node) continue;
          const p = posOf(node);
          if (p.x < viewMinX || p.x > viewMaxX || p.y < viewMinY || p.y > viewMaxY) {
            continue;
          }
          const ids = lines.linesAtStop.get(stopId) ?? [];
          if (ids.length === 0) continue;
          const dimmed = litLine !== null && !ids.includes(litLine);

          // Measure the bundle from where the ribbons actually are at this
          // stop: project each line's offset position onto the corridor's
          // normal, and span the extremes. Derived from the drawn geometry, so
          // the bar always matches whatever the ordering produced.
          let angle: number | null = null;
          for (const id of ids) {
            const entry = lines.byId.get(id);
            // Prefer the drawn ribbon, but fall back to the line's raw stop
            // positions: a line culled from this frame has no offset polyline,
            // and skipping it would leave a busy station with no bar at all.
            const shifted = offsetPoints.get(id) ?? linePoints.get(id);
            if (!entry || !shifted) continue;
            const at = (drawnLineStops.get(id) ?? entry.stops).indexOf(stopId);
            if (at < 0) continue;
            const here = shifted[at];
            const neighbor = shifted[at + 1] ?? shifted[at - 1];
            if (!here || !neighbor) continue;
            angle = Math.atan2(neighbor.y - here.y, neighbor.x - here.x);
            break;
          }
          if (angle === null) continue;
          const nx = -Math.sin(angle);
          const ny = Math.cos(angle);
          let lo = 0;
          let hi = 0;
          for (const id of ids) {
            const entry = lines.byId.get(id);
            const shifted = offsetPoints.get(id) ?? linePoints.get(id);
            if (!entry || !shifted) continue;
            const at = (drawnLineStops.get(id) ?? entry.stops).indexOf(stopId);
            const here = at >= 0 ? shifted[at] : undefined;
            if (!here) continue;
            const along = (here.x - p.x) * nx + (here.y - p.y) * ny;
            if (along < lo) lo = along;
            if (along > hi) hi = along;
          }
          // Lines can meet at a station without sharing track on either side,
          // in which case the measured bundle is zero wide. The bar still has
          // to read as a station, so give it a floor.
          const bundle = Math.max(hi - lo, 6 / Math.sqrt(camera.scale));
          const centreX = p.x + nx * ((lo + hi) / 2);
          const centreY = p.y + ny * ((lo + hi) / 2);
          const cap = 7 / Math.sqrt(camera.scale);
          drawStationBar(
            ctx,
            centreX,
            centreY,
            angle,
            bundle + cap,
            (3.2 / Math.sqrt(camera.scale)) * opts.nodeScale,
            (dimmed ? 0.18 : 0.95) * reveal,
          );
        }
      }

      // --- Breadcrumb trail ------------------------------------------------
      const log = travelRef.current;
      if (log && log.stops.length > 1) {
        ctx.beginPath();
        let started = false;
        for (const id of log.stops) {
          const n = layout.byId.get(id);
          if (!n) continue;
          const p = posOf(n);
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
        ctx.setLineDash([5 / camera.scale, 5 / camera.scale]);
        ctx.lineWidth = 1.6 / Math.sqrt(camera.scale);
        ctx.strokeStyle = `rgba(232, 194, 122, 0.55)`;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // --- Stops -----------------------------------------------------------
      for (const node of layout.nodes) {
        if (!rumorVisible(node)) continue;
        const p = posOf(node);
        if (p.x < viewMinX || p.x > viewMaxX || p.y < viewMinY || p.y > viewMaxY) {
          continue;
        }
        const id = node.stop.id;
        const onRoute = routeSet?.has(id) ?? false;
        const isSelected = node.stop.members.some((m) => selected.has(m.id));
        const isFocus = id === focusStopId;
        const muted = routeSet !== null && !onRoute;
        // Rumors are dust, not stations: a bare dim dot with no station ring.
        if (node.rumor) {
          const r = Math.max(0.5, 1.1 / Math.sqrt(Math.max(camera.scale, 0.32)));
          ctx.globalAlpha = reveal * 0.34 * dimmedBy(id);
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(198, 192, 178, 0.75)";
          ctx.fill();
          ctx.globalAlpha = 1;
          continue;
        }

        const radius = stopRadius(node, opts.nodeScale) /
          Math.sqrt(Math.max(camera.scale, 0.32));
        const alpha =
          reveal *
          (muted ? 0.22 : 1) *
          dimmedBy(id) *
          (isFocus || onRoute || isSelected ? 1 : 0.9);
        drawStop(
          ctx,
          p.x,
          p.y,
          radius,
          node.stop.kind,
          node.stop.members.length,
          alpha,
        );

        if (isSelected || (walking && id === walking)) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius + 4.5, 0, Math.PI * 2);
          ctx.lineWidth = 1.4;
          ctx.strokeStyle = SEED_ACCENT;
          ctx.stroke();
        }

        // Search-hit flash: a couple of expanding rings, then it fades.
        const flash = flashRef.current;
        if (flash && flash.id === id) {
          const t = (performance.now() - flash.at) / 1100;
          if (t >= 1) flashRef.current = null;
          else {
            for (let i = 0; i < 2; i++) {
              const ft = Math.min(1, t + i * 0.25);
              ctx.beginPath();
              ctx.arc(p.x, p.y, radius + 4 + ft * 26, 0, Math.PI * 2);
              ctx.lineWidth = 1.3;
              ctx.strokeStyle = `rgba(232, 194, 122, ${0.75 * (1 - ft)})`;
              ctx.stroke();
            }
          }
        }
      }

      // --- Labels ----------------------------------------------------------
      // Semantic-zoom label budget: keep the on-screen count roughly constant
      // instead of growing without bound as you zoom. Counting how many charted
      // stops actually fall inside the viewport means a sparse region shows its
      // names while a dense one stays readable.
      let inView = 0;
      for (const n of layout.nodes) {
        if (n.rumor) continue;
        if (n.x < viewMinX || n.x > viewMaxX || n.y < viewMinY || n.y > viewMaxY) {
          continue;
        }
        inView++;
      }
      // The collision pass is the real limiter, so the budget can be generous:
      // it caps how many are *considered*, not how many survive.
      const labelBudget = Math.max(
        8,
        Math.round(Math.min(60, inView * 0.85) * opts.labelDensity),
      );
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];

      const labelOrder = labelOrderRef.current;
      // Seeds, route stops, the focused stop and its neighbours always get a
      // label — the neighbour reveal is what makes roads legible without
      // traversing, so it outranks the density budget.
      const priority: LayoutNode[] = [];
      const seen = new Set<string>();
      const addPriority = (n: LayoutNode | undefined) => {
        if (!n || seen.has(n.stop.id)) return;
        if (!rumorVisible(n)) return;
        seen.add(n.stop.id);
        priority.push(n);
      };
      for (const n of layout.nodes) {
        if (n.stop.kind === "seed" || (routeSet?.has(n.stop.id) ?? false)) {
          addPriority(n);
        }
      }
      if (focusStopId) addPriority(layout.byId.get(focusStopId));
      for (const id of neighborDir.keys()) addPriority(layout.byId.get(id));

      const budgeted = labelOrder
        .filter((n) => !seen.has(n.stop.id) && rumorVisible(n))
        .sort((a, b) => {
          const ah = a.stop.kind === "hub" ? 1 : 0;
          const bh = b.stop.kind === "hub" ? 1 : 0;
          if (ah !== bh) return ah - bh;
          return b.prominence - a.prominence;
        })
        .slice(0, Math.max(0, labelBudget));

      for (const node of [...priority, ...budgeted]) {
        // Rumors are unnamed at rest; hovering one directly still shows a tooltip.
        if (node.rumor && node.stop.id !== hoveredId) continue;
        const p = posOf(node);
        const sx = width / 2 + camera.x + p.x * camera.scale;
        const sy = height / 2 + camera.y + p.y * camera.scale;
        if (sx < -90 || sx > width + 90 || sy < -40 || sy > height + 40) continue;

        const id = node.stop.id;
        const isSeed = node.stop.kind === "seed";
        const onRoute = routeSet?.has(id) ?? false;
        const dir = neighborDir.get(id);
        const isFocus = id === focusStopId;
        const extra = node.stop.members.length - 1;
        const text =
          node.stop.representative.id.toUpperCase() + (extra > 0 ? ` +${extra}` : "");
        const size = isSeed || isFocus ? 11 : Math.min(10.5, 7.5 + node.prominence * 3);
        ctx.font = `${isSeed || isFocus ? 600 : 400} ${size}px "Martian Mono", ui-monospace, monospace`;
        const halfWidth = ctx.measureText(text).width / 2;
        const top =
          sy +
          stopRadius(node, opts.nodeScale) / Math.sqrt(Math.max(camera.scale, 0.32)) +
          (isSeed ? 8 : 5);
        const box = {
          x0: sx - halfWidth - 7,
          y0: top - 5,
          x1: sx + halfWidth + 7,
          y1: top + size + 5,
        };
        const mustShow = isSeed || isFocus || onRoute || dir !== undefined;
        const collides = placed.some(
          (q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0,
        );
        if (collides && !mustShow) continue;
        placed.push(box);

        const muted = routeSet !== null && !onRoute && !isSeed;
        // Incoming-only neighbours read dimmer: you cannot walk to them.
        const dirFade = dir === "in" ? 0.5 : 1;
        const alpha =
          (isSeed ? 0.92 : isFocus ? 0.95 : onRoute ? 0.95 : dir ? 0.8 : 0.2 + node.prominence * 0.3) *
          (muted ? 0.25 : 1) *
          dirFade *
          dimmedBy(id) *
          reveal;
        ctx.fillStyle = isSeed
          ? `rgba(232, 194, 122, ${alpha})`
          : `rgba(${LABEL_COLOR}, ${alpha})`;
        ctx.fillText(text, sx, top);

        // Mark incoming-only neighbours so the direction is unambiguous.
        if (dir === "in") {
          ctx.fillStyle = `rgba(${LABEL_COLOR}, ${alpha * 0.9})`;
          ctx.fillText("← in only", sx, top + size + 2);
        }
      }

      // --- Line name plates at the termini ---------------------------------
      // Lowest priority of anything named on the map: they take the space the
      // station labels left, and yield rather than push a station name off.
      // Naming all 43 lines at once is 86 plates and reads as confetti, so at
      // rest only the longest few are named and the rest wait for a highlight
      // or a closer look — the same semantic-zoom bargain the stop labels make.
      if (linesOn) {
        const labels = lineLabelsRef.current;
        const namedBudget =
          litLine !== null ? lines.resolved.length : Math.round(4 + camera.scale * 5);
        const named = [...lines.resolved].sort(
          (a, b) => b.stops.length - a.stops.length,
        );
        let plated = 0;
        for (const entry of named) {
          if (plated >= namedBudget) break;
          const points = linePoints.get(entry.line.id);
          if (!points || points.length < 2) continue;
          const dimmed = litLine !== null && litLine !== entry.line.id;
          if (dimmed) continue;
          plated++;
          const name = (labels.get(entry.line.id) ?? entry.line.name).toUpperCase();
          const ends: Array<{ at: Point; toward: Point }> = [
            { at: points[0] as Point, toward: points[1] as Point },
            {
              at: points[points.length - 1] as Point,
              toward: points[points.length - 2] as Point,
            },
          ];
          for (const end of ends) {
            const sx = width / 2 + camera.x + end.at.x * camera.scale;
            const sy = height / 2 + camera.y + end.at.y * camera.scale;
            if (sx < -90 || sx > width + 90 || sy < -40 || sy > height + 40) continue;
            // Push the plate outward, away from where the line arrives, so it
            // reads as the end of that line rather than as a station name.
            const dx = end.at.x - end.toward.x;
            const dy = end.at.y - end.toward.y;
            const len = Math.max(1e-6, Math.hypot(dx, dy));
            const px = sx + (dx / len) * 16;
            const py = sy + (dy / len) * 16;

            ctx.font = `600 8px "Martian Mono", ui-monospace, monospace`;
            const halfWidth = ctx.measureText(name).width / 2;
            const box = {
              x0: px - halfWidth - 5,
              y0: py - 5,
              x1: px + halfWidth + 5,
              y1: py + 13,
            };
            const collides = placed.some(
              (q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0,
            );
            if (collides) continue;
            placed.push(box);
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = lineRgba(entry.rgb, 0.85 * reveal);
            ctx.fillText(name, px, py);
          }
        }
      }
      ctx.restore();

      // --- Signposts (walking mode) ----------------------------------------
      signpostBoxesRef.current = [];
      if (walking) {
        const origin = layout.byId.get(walking);
        const posts = signpostsRef.current;
        if (origin && posts.length > 0) {
          ctx.save();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const ox = width / 2 + camera.x + posOf(origin).x * camera.scale;
          const oy = height / 2 + camera.y + posOf(origin).y * camera.scale;
          const margin = 78;
          const rx = Math.max(120, width / 2 - margin);
          const ry = Math.max(90, height / 2 - margin);

          for (const post of posts) {
            // Project the true bearing onto the viewport edge, so a signpost
            // points where the destination actually lies.
            const cos = Math.cos(post.angle);
            const sin = Math.sin(post.angle);
            const scale = 1 / Math.max(Math.abs(cos) / rx, Math.abs(sin) / ry);
            const px = ox + cos * scale;
            const py = oy + sin * scale;

            const label = post.node.stop.representative.id.toUpperCase();
            const mode = post.step.mode === "ride" ? "ride" : "walk";
            // In transit mode a street exit is still shown, but marked as
            // off-network so the choice to leave the backbone is deliberate.
            const offNetwork = opts.routeMode === "transit" && !post.step.trunk;
            // An exit a line covers is named by that line, so leaving a station
            // reads as "this way for the are.na line" rather than a bare hop.
            const exitLine = linesOn
              ? lines.segments
                  .get(segmentKey(walking, post.node.stop.id))
                  ?.[0]?.lineId
              : undefined;
            const exitLineName = exitLine
              ? lineLabelsRef.current.get(exitLine) ??
                lines.byId.get(exitLine)?.line.name ??
                null
              : null;
            const exitRgb = exitLine ? lines.byId.get(exitLine)?.rgb : undefined;
            const detail = exitLineName
              ? `${exitLineName} · ${post.step.pages}`
              : offNetwork
                ? `street only · ${post.step.pages}`
                : `${mode} · ${post.step.pages}`;
            ctx.font = `600 10px "Martian Mono", ui-monospace, monospace`;
            const labelWidth = ctx.measureText(label).width;
            ctx.font = `400 8px "Martian Mono", ui-monospace, monospace`;
            const detailWidth = ctx.measureText(detail).width;
            const w = Math.max(labelWidth, detailWidth, 62) + 18;
            const h = 30;
            ctx.font = `600 10px "Martian Mono", ui-monospace, monospace`;
            const bx = Math.min(Math.max(px - w / 2, 6), width - w - 6);
            const by = Math.min(Math.max(py - h / 2, 6), height - h - 6);
            signpostBoxesRef.current.push({ post, x: bx, y: by, w, h });

            ctx.globalAlpha = offNetwork && !exitRgb ? 0.55 : 1;
            ctx.fillStyle = "rgba(16, 15, 12, 0.93)";
            ctx.strokeStyle = exitRgb
              ? lineRgba(exitRgb, 0.85)
              : offNetwork
                ? "rgba(150, 144, 132, 0.3)"
                : post.step.mode === "ride"
                  ? "rgba(232, 194, 122, 0.7)"
                  : "rgba(198, 192, 178, 0.45)";
            ctx.lineWidth = exitRgb ? 1.6 : 1;
            ctx.beginPath();
            ctx.rect(bx, by, w, h);
            ctx.fill();
            ctx.stroke();

            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = "rgba(238, 233, 219, 0.95)";
            ctx.fillText(label, bx + w / 2, by + 5);
            ctx.font = `400 8px "Martian Mono", ui-monospace, monospace`;
            ctx.fillStyle = exitRgb
              ? lineRgba(exitRgb, 0.95)
              : offNetwork
                ? "rgba(160, 154, 142, 0.6)"
                : post.step.mode === "ride"
                  ? "rgba(232, 194, 122, 0.85)"
                  : "rgba(198, 192, 178, 0.6)";
            ctx.fillText(detail, bx + w / 2, by + 18);

            // A short stub pointing from the sign back toward the origin.
            ctx.beginPath();
            ctx.moveTo(bx + w / 2 - cos * (w / 2 + 2), by + h / 2 - sin * (h / 2 + 2));
            ctx.lineTo(
              bx + w / 2 - cos * (w / 2 + 12),
              by + h / 2 - sin * (h / 2 + 12),
            );
            ctx.strokeStyle = "rgba(198, 192, 178, 0.35)";
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          ctx.restore();
        }
      }
    };

    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(solver);
    };
  }, []);

  // --- Signposts ---------------------------------------------------------
  // Recomputed only when the walking origin or level changes.
  useEffect(() => {
    const layout = layoutRef.current;
    if (!walkingFrom || !level || !layout) {
      signpostsRef.current = [];
      setSignpostCount(0);
      return;
    }
    const origin = layout.byId.get(walkingFrom);
    if (!origin) {
      signpostsRef.current = [];
      setSignpostCount(0);
      return;
    }
    const posts: Signpost[] = [];
    for (const step of stepsFrom(level, walkingFrom, onLine)) {
      const node = layout.byId.get(step.to);
      if (!node) continue;
      posts.push({
        step,
        node,
        angle: Math.atan2(node.y - origin.y, node.x - origin.x),
      });
    }
    // Strongest roads first, and cap the fan so the edge does not fill up.
    posts.sort((a, b) => b.step.pages - a.step.pages);
    const trimmed = posts.slice(0, 12);
    signpostsRef.current = trimmed;
    setSignpostCount(trimmed.length);
  }, [walkingFrom, level, settling, onLine]);

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
      const opts = settingsRef.current;
      const slop = 9 / camera.scale;
      let best: LayoutNode | null = null;
      let bestDist = Infinity;
      for (const node of layout.nodes) {
        // Only pick what is actually drawn, so clicks match what you see.
        if (node.rumor && !opts.showRumors && camera.scale < 1.6) continue;
        const reach =
          stopRadius(node, opts.nodeScale) /
            Math.sqrt(Math.max(camera.scale, 0.32)) +
          slop;
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
          glideRef.current = null;
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
      setHover({ node, screenX: e.clientX, screenY: e.clientY });
    },
    [hover, pickNode],
  );

  /** Travel to a stop while walking, extending the log and breadcrumb. */
  const travelTo = useCallback(
    (step: Step, node: LayoutNode) => {
      const from = walkingFromRef.current;
      if (!from) return;
      setTravel((current) => {
        const base: TravelLog = current ?? { stops: [from], legs: [] };
        return {
          stops: [...base.stops, step.to],
          legs: [
            ...base.legs,
            { from, to: step.to, mode: step.mode, cost: step.cost },
          ],
        };
      });
      setWalkingFrom(step.to);
      glideTo(node);
    },
    [glideTo],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (drag?.moved) return;

      // In walking mode a click on a signpost travels that road. The plates are
      // sized to their text, so hit-test the boxes the render actually painted.
      if (walkingFromRef.current) {
        for (const box of signpostBoxesRef.current) {
          if (
            e.clientX >= box.x &&
            e.clientX <= box.x + box.w &&
            e.clientY >= box.y &&
            e.clientY <= box.y + box.h
          ) {
            travelTo(box.post.step, box.post.node);
            return;
          }
        }
      }

      const node = pickNode(e.clientX, e.clientY);
      if (!node) {
        setSelection([]);
        setRoute(null);
        setNoRoute(null);
        return;
      }
      const id = node.stop.representative.id;
      const current = selectionRef.current;
      if (current.length >= 2) {
        setSelection([id]);
        setRoute(null);
        setNoRoute(null);
      } else if (current[0] === id) {
        setSelection([]);
        setRoute(null);
        setNoRoute(null);
      } else {
        setSelection([...current, id]);
      }
    },
    [pickNode, travelTo],
  );

  const startWalking = useCallback(
    (stopId: string) => {
      const layout = layoutRef.current;
      const node = layout?.byId.get(stopId);
      if (!node) return;
      setWalkingFrom(stopId);
      setTravel({ stops: [stopId], legs: [] });
      setRoute(null);
        setNoRoute(null);
      setSelection([]);
      setHover(null);
      glideTo(node, Math.max(cameraRef.current.scale, 1.4));
    },
    [glideTo],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const node = pickNode(e.clientX, e.clientY);
      if (node) startWalking(node.stop.id);
    },
    [pickNode, startWalking],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userMovedRef.current = true;
      glideRef.current = null;
      const camera = cameraRef.current;
      const { width, height } = sizeRef.current;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));
      const applied = next / camera.scale;
      const cx = e.clientX - width / 2;
      const cy = e.clientY - height / 2;
      camera.x = cx - (cx - camera.x) * applied;
      camera.y = cy - (cy - camera.y) * applied;
      camera.scale = next;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // --- Search ------------------------------------------------------------

  const hits = useMemo<SearchHit[]>(() => {
    if (!graph || !level || query.trim().length === 0) return [];
    return searchDomains(graph, level, query);
  }, [graph, level, query]);

  const goToStop = useCallback(
    (stopId: string) => {
      const layout = layoutRef.current;
      const node = layout?.byId.get(stopId);
      if (!node) return;
      glideTo(node, Math.max(cameraRef.current.scale, 1.35));
      flashRef.current = { id: stopId, at: performance.now() };
    },
    [glideTo],
  );

  /** Search result picked as a plain destination: jump there and select it. */
  const jumpToHit = useCallback(
    (hit: SearchHit) => {
      goToStop(hit.stopId);
      setSelection([hit.stopId]);
      setRoute(null);
        setNoRoute(null);
      setSearchOpen(false);
      setQuery("");
    },
    [goToStop],
  );

  /** Search result picked as a route destination from the current selection. */
  const routeToHit = useCallback(
    (hit: SearchHit) => {
      if (!level || !routingIndex) return;
      const origin = walkingFrom ?? selection[0];
      if (!origin) {
        jumpToHit(hit);
        return;
      }
      const from = level.stopOf.get(origin) ?? origin;
      if (from === hit.stopId) {
        jumpToHit(hit);
        return;
      }
      // Set the selection and resolve directly: waiting for the selection
      // effect would race the camera glide and could show nothing.
      setSelection([from, hit.stopId]);
      resolveRoute(from, hit.stopId);
      goToStop(hit.stopId);
      setSearchOpen(false);
      setQuery("");
    },
    [level, routingIndex, walkingFrom, selection, goToStop, jumpToHit, resolveRoute],
  );

  // Keyboard: "/" opens search, Escape closes it or exits walking mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }
      if (e.key === "Escape") {
        if (searchOpen) {
          setSearchOpen(false);
          setQuery("");
          return;
        }
        if (walkingFrom) {
          // Esc retraces the breadcrumb one hop at a time; from the first stop
          // (or with no trail yet) it leaves walking mode.
          const trail = travelRef.current;
          if (trail && trail.legs.length > 0) {
            const stops = trail.stops.slice(0, -1);
            const legs = trail.legs.slice(0, -1);
            const previous = stops[stops.length - 1];
            if (previous) {
              setTravel({ stops, legs });
              setWalkingFrom(previous);
              const node = layoutRef.current?.byId.get(previous);
              if (node) glideTo(node);
              return;
            }
          }
          setWalkingFrom(null);
          setTravel(null);
          signpostsRef.current = [];
          setSignpostCount(0);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, walkingFrom, glideTo]);

  // --- Derived UI --------------------------------------------------------

  const stats = useMemo(() => {
    if (!graph || !level) return null;
    return {
      domains: graph.nodes.length,
      stops: level.stops.length,
      routes: level.edges.length,
      trunk: level.edges.filter((e) => e.trunk).length,
    };
  }, [graph, level]);

  /** Legend order: busiest first, matching what the resting view draws. */
  const legendOrder = useMemo(() => {
    if (!lineIndex) return [];
    const rank = new Map(lineIndex.byProminence.map((id, i) => [id, i]));
    return [...lineIndex.resolved].sort(
      (a, b) =>
        (rank.get(a.line.id) ?? 0) - (rank.get(b.line.id) ?? 0),
    );
  }, [lineIndex]);

  /** Lines calling at the hovered stop, so the tooltip names them. */
  const hoverLines = useMemo(() => {
    if (!hover || !lineIndex) return [];
    const ids = lineIndex.linesAtStop.get(hover.node.stop.id) ?? [];
    return ids
      .map((id) => lineIndex.byId.get(id))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  }, [hover, lineIndex]);

  const hoverCluster = useMemo(() => {
    if (!graph || !hover) return null;
    return (
      graph.clusters.find((c) => c.id === hover.node.stop.cluster)?.label ?? null
    );
  }, [graph, hover]);

  const update = useCallback(<K extends keyof MapSettings>(
    key: K,
    value: MapSettings[K],
  ) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  /** Ride/walk segments for the planned route, collapsed by line. */
  const routeSegments = useMemo<RouteSegment[]>(
    () => (route && lineIndex ? narrateRoute(lineIndex, route.legs) : []),
    [route, lineIndex],
  );

  const routeNarration = useMemo(
    () =>
      routeSegments.length > 0
        ? describeRoute(routeSegments, lineLabels, settings.routeDetail === "express")
        : [],
    [routeSegments, lineLabels, settings.routeDetail],
  );

  /** The walked trail narrates the same way a planned route does. */
  const travelSegments = useMemo<RouteSegment[]>(() => {
    if (!travel || travel.legs.length === 0 || !lineIndex) return [];
    return narrateRoute(
      lineIndex,
      travel.legs.map((l) => ({
        from: l.from,
        to: l.to,
        pages: 0,
        trunk: l.mode === "ride",
        mode: l.mode,
        cost: l.cost,
      })),
    );
  }, [travel, lineIndex]);

  const travelNarration = useMemo(
    () =>
      travelSegments.length > 0
        ? describeRoute(travelSegments, lineLabels, settings.routeDetail === "express")
        : [],
    [travelSegments, lineLabels, settings.routeDetail],
  );

  const travelText = useMemo(() => {
    if (!travel || travel.legs.length === 0) return "";
    const total = travel.legs.reduce((sum, l) => sum + l.cost, 0);
    if (travelSegments.length > 0) {
      return routeToText(
        travelSegments,
        lineLabels,
        { distance: total, mode: settings.routeMode },
        settings.routeDetail === "express",
      );
    }
    const chain = travel.legs
      .map((l, i) => `${i === 0 ? l.from : ""} =${l.mode}=> ${l.to}`)
      .join(" ");
    return `${chain.trim()} (${travel.legs.length} hop${
      travel.legs.length === 1 ? "" : "s"
    }, ${total.toFixed(2)}, ${settings.routeMode})`;
  }, [travel, travelSegments, lineLabels, settings.routeMode, settings.routeDetail]);

  const routeText = useMemo(() => {
    if (!route || routeSegments.length === 0) return "";
    return routeToText(
      routeSegments,
      lineLabels,
      route,
      settings.routeDetail === "express",
    );
  }, [route, routeSegments, lineLabels, settings.routeDetail]);

  /** Shared mode switch, shown in both the route and walking panels. */
  const modeToggle = (
    <div className="galaxy-mode">
      <button
        type="button"
        className={settings.routeMode === "streets" ? "is-active" : ""}
        onClick={() => update("routeMode", "streets")}
      >
        streets
      </button>
      <button
        type="button"
        className={settings.routeMode === "transit" ? "is-active" : ""}
        onClick={() => update("routeMode", "transit")}
      >
        transit only
      </button>
    </div>
  );

  /** Express hides the intermediate stations a local run calls out. */
  const detailToggle = (
    <div className="galaxy-mode galaxy-mode--detail">
      <button
        type="button"
        className={settings.routeDetail === "express" ? "is-active" : ""}
        onClick={() => update("routeDetail", "express")}
      >
        express
      </button>
      <button
        type="button"
        className={settings.routeDetail === "local" ? "is-active" : ""}
        onClick={() => update("routeDetail", "local")}
      >
        local
      </button>
    </div>
  );

  /** Narration list, shared by the route and walking panels. */
  const narrationList = (steps: string[]): React.ReactElement => (
    <ol className="galaxy-route__narration">
      {steps.map((step, i) => (
        <li
          key={`${i}-${step}`}
          className={
            step.startsWith("calling at:") ? "galaxy-route__calling" : undefined
          }
        >
          {step}
        </li>
      ))}
    </ol>
  );

  const copyText = useCallback((text: string) => {
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      },
      () => {
        // Clipboard can be blocked; the text stays visible for manual copy.
      },
    );
  }, []);

  const unknownQuery =
    searchOpen && query.trim().length > 1 && hits.length === 0 ? query.trim() : null;

  return (
    <div className="galaxy-root">
      <canvas
        ref={canvasRef}
        className="galaxy-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onPointerLeave={() => setHover(null)}
      />

      <header className="galaxy-title">
        <span className="galaxy-title__mark">we were online</span>
        <span className="galaxy-title__sub">territory</span>
      </header>

      {/* Search ------------------------------------------------------- */}
      <div className={`galaxy-search ${searchOpen ? "is-open" : ""}`}>
        {searchOpen ? (
          <>
            <input
              ref={searchInputRef}
              className="galaxy-search__input"
              value={query}
              placeholder="find a domain"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits[0]) {
                  if (e.shiftKey) routeToHit(hits[0]);
                  else jumpToHit(hits[0]);
                }
              }}
            />
            {hits.length > 0 && (
              <ul className="galaxy-search__results">
                {hits.map((hit) => (
                  <li key={hit.domain}>
                    <button
                      type="button"
                      className="galaxy-search__go"
                      onClick={() => jumpToHit(hit)}
                    >
                      <span className="galaxy-search__domain">{hit.domain}</span>
                      {hit.collapsed && (
                        <span className="galaxy-search__inside">
                          inside {hit.stopId} +{hit.stopSize - 1}
                        </span>
                      )}
                    </button>
                    {(walkingFrom || selection.length > 0) && (
                      <button
                        type="button"
                        className="galaxy-search__route"
                        title={`route from ${walkingFrom ?? selection[0]}`}
                        onClick={() => routeToHit(hit)}
                      >
                        go here from {walkingFrom ?? selection[0]}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {unknownQuery && (
              <div className="galaxy-search__unknown">
                <div className="galaxy-search__unknown-title">
                  unknown territory
                </div>
                <div className="galaxy-search__unknown-body">
                  {unknownQuery} is not yet charted
                </div>
              </div>
            )}
          </>
        ) : (
          <button
            type="button"
            className="galaxy-search__open"
            onClick={() => {
              setSearchOpen(true);
              window.setTimeout(() => searchInputRef.current?.focus(), 0);
            }}
          >
            search <kbd>/</kbd>
          </button>
        )}
      </div>

      {/* Controls ----------------------------------------------------- */}
      <div className={`galaxy-controls ${controlsOpen ? "is-open" : ""}`}>
        <button
          type="button"
          className="galaxy-controls__toggle"
          onClick={() => setControlsOpen((v) => !v)}
        >
          {controlsOpen ? "hide controls" : "controls"}
        </button>

        {controlsOpen && (
          <div className="galaxy-controls__body">
            <label className="galaxy-field">
              <span>grouping</span>
              <input
                type="range"
                min={0}
                max={3}
                step={1}
                value={settings.groupLevel}
                onChange={(e) => update("groupLevel", Number(e.target.value))}
              />
              <em>{GROUP_LABELS[settings.groupLevel]}</em>
            </label>

            <label className="galaxy-field galaxy-field--row">
              <input
                type="checkbox"
                checked={settings.showRumors}
                onChange={(e) => update("showRumors", e.target.checked)}
              />
              <span>show uncharted (rumors)</span>
            </label>

            <label className="galaxy-field">
              <span>spread</span>
              <input
                type="range"
                min={0.4}
                max={6}
                step={0.1}
                value={settings.spread}
                onChange={(e) => update("spread", Number(e.target.value))}
              />
              <em>{settings.spread.toFixed(1)}x</em>
            </label>

            <label className="galaxy-field galaxy-field--row">
              <input
                type="checkbox"
                checked={settings.lineMode === "trunk"}
                onChange={(e) =>
                  update("lineMode", e.target.checked ? "trunk" : "all")
                }
              />
              <span>trunk only</span>
            </label>

            <label className="galaxy-field">
              <span>flow contrast</span>
              <input
                type="range"
                min={0.5}
                max={5}
                step={0.1}
                value={settings.flowExponent}
                onChange={(e) => update("flowExponent", Number(e.target.value))}
              />
              <em>
                {settings.flowExponent.toFixed(1)}
                {settings.flowExponent <= 1
                  ? " — flat"
                  : settings.flowExponent >= 3.5
                    ? " — rivers only"
                    : ""}
              </em>
            </label>

            <label className="galaxy-field galaxy-field--row">
              <input
                type="checkbox"
                checked={settings.bundleTributaries}
                onChange={(e) => update("bundleTributaries", e.target.checked)}
              />
              <span>bundle tributaries</span>
            </label>

            <label className="galaxy-field">
              <span>lines at rest</span>
              <input
                type="range"
                min={0}
                max={Math.max(20, lineIndex?.resolved.length ?? 20)}
                step={1}
                value={settings.restingLineCount}
                onChange={(e) =>
                  update("restingLineCount", Number(e.target.value))
                }
              />
              <em>
                {settings.restingLineCount === 0
                  ? "all"
                  : `busiest ${settings.restingLineCount}, more on zoom`}
              </em>
            </label>

            <label className="galaxy-field">
              <span>mesh opacity</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={settings.meshOpacity}
                disabled={settings.lineMode === "trunk"}
                onChange={(e) => update("meshOpacity", Number(e.target.value))}
              />
              <em>{settings.meshOpacity.toFixed(2)}</em>
            </label>

            <label className="galaxy-field galaxy-field--row">
              <input
                type="checkbox"
                checked={settings.clusterHues}
                onChange={(e) => update("clusterHues", e.target.checked)}
              />
              <span>cluster hues</span>
            </label>

            <label className="galaxy-field">
              <span>label density</span>
              <input
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={settings.labelDensity}
                onChange={(e) => update("labelDensity", Number(e.target.value))}
              />
              <em>{settings.labelDensity.toFixed(1)}x</em>
            </label>

            <label className="galaxy-field">
              <span>node size</span>
              <input
                type="range"
                min={0.4}
                max={3}
                step={0.1}
                value={settings.nodeScale}
                onChange={(e) => update("nodeScale", Number(e.target.value))}
              />
              <em>{settings.nodeScale.toFixed(1)}x</em>
            </label>

            <label className="galaxy-field galaxy-field--row">
              <input
                type="checkbox"
                checked={settings.directionTapers}
                onChange={(e) => update("directionTapers", e.target.checked)}
              />
              <span>direction tapers</span>
            </label>

            <label className="galaxy-field">
              <span>hops from seeds</span>
              <input
                type="range"
                min={0}
                max={8}
                step={1}
                value={settings.seedFocusHops}
                onChange={(e) => update("seedFocusHops", Number(e.target.value))}
              />
              <em>{settings.seedFocusHops === 0 ? "off" : settings.seedFocusHops}</em>
            </label>

            <button
              type="button"
              className="galaxy-controls__reset"
              onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
            >
              reset
            </button>
          </div>
        )}
      </div>

      {stats && (
        <footer className="galaxy-legend">
          <span>{stats.domains.toLocaleString()} domains</span>
          <span>{stats.stops.toLocaleString()} stops</span>
          <span>{stats.routes.toLocaleString()} routes</span>
          <span>{stats.trunk.toLocaleString()} trunk</span>
        </footer>
      )}

      {settling && <div className="galaxy-status">settling</div>}
      {error && <div className="galaxy-status galaxy-status--error">{error}</div>}

      {/* Walking / route panel ---------------------------------------- */}
      {walkingFrom && (
        <div className="galaxy-route galaxy-route--walk">
          <div className="galaxy-route__title">
            walking
            <button
              type="button"
              className="galaxy-route__exit"
              onClick={() => {
                setWalkingFrom(null);
                setTravel(null);
                signpostsRef.current = [];
                setSignpostCount(0);
              }}
            >
              exit
            </button>
          </div>
          <div className="galaxy-route__from">at {walkingFrom}</div>
          {modeToggle}
          <div className="galaxy-route__help">
            {travel && travel.legs.length > 0
              ? "esc steps back one hop"
              : "esc exits walking"}
          </div>
          {signpostCount === 0 && (
            <div className="galaxy-route__dead">
              no roads lead out of here
            </div>
          )}
          {travel && travel.legs.length > 0 && (
            <>
              {travelSegments.length > 0 && detailToggle}
              {travelNarration.length > 0 ? (
                narrationList(travelNarration)
              ) : (
                <ol className="galaxy-route__stops">
                  {travel.stops.map((id, i) => (
                    <li key={`${id}-${i}`}>{id}</li>
                  ))}
                </ol>
              )}
              <button
                type="button"
                className="galaxy-route__copy"
                onClick={() => copyText(travelText)}
              >
                {copied ? "copied" : "copy trail"}
              </button>
            </>
          )}
        </div>
      )}

      {!walkingFrom && selection.length === 1 && !route && (
        <div className="galaxy-route galaxy-route--hint">
          <div className="galaxy-route__title">pick a destination</div>
          <div className="galaxy-route__from">from {selection[0]}</div>
          {modeToggle}
          <button
            type="button"
            className="galaxy-route__copy"
            onClick={() => selection[0] && startWalking(selection[0])}
          >
            walk from here
          </button>
        </div>
      )}

      {!walkingFrom && noRoute && (
        <div className="galaxy-route galaxy-route--none">
          <div className="galaxy-route__title">no route found</div>
          <div className="galaxy-route__from">
            from {noRoute.from} to {noRoute.to}
          </div>
          <div className="galaxy-route__dead">
            no chain of links connects these, in either direction
          </div>
        </div>
      )}

      {!walkingFrom && route && (
        <div className="galaxy-route">
          <div className="galaxy-route__title">
            {route.legs.length} {route.legs.length === 1 ? "hop" : "hops"}
            <span className="galaxy-route__distance">
              distance {route.distance.toFixed(2)}
            </span>
          </div>
          {route.againstOneWay && (
            <div className="galaxy-route__caveat">
              requires going against one-way links
            </div>
          )}
          {transitFallback && (
            <div className="galaxy-route__caveat">
              no transit route — showing streets
            </div>
          )}
          <div className="galaxy-route__modeline">
            via {route.mode}
            {routeSegments.length > 0 && ` · ${summarizeRoute(routeSegments)}`}
          </div>
          {modeToggle}
          {routeSegments.length > 0 && detailToggle}
          {routeNarration.length > 0 ? (
            narrationList(routeNarration)
          ) : (
            <ol className="galaxy-route__stops">
              {route.stops.map((id, i) => (
                <li key={`${id}-${i}`}>
                  {id}
                  {route.legs[i] && (
                    <span className="galaxy-route__mode">
                      {route.legs[i]?.mode}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {routeText && (
            <button
              type="button"
              className="galaxy-route__copy"
              onClick={() => copyText(routeText)}
            >
              {copied ? "copied" : "copy route"}
            </button>
          )}
        </div>
      )}

      {/* Lines legend ------------------------------------------------- */}
      {lineIndex && lineIndex.resolved.length > 0 && (
        <div className={`galaxy-lines ${settings.legendOpen ? "is-open" : ""}`}>
          <div className="galaxy-lines__head">
            <button
              type="button"
              className="galaxy-lines__toggle"
              onClick={() => update("legendOpen", !settings.legendOpen)}
            >
              {settings.legendOpen ? "hide lines" : "lines"}
              <span className="galaxy-lines__count">
                {lineIndex.resolved.length}
              </span>
            </button>
            <button
              type="button"
              className={`galaxy-lines__power ${settings.showLines ? "is-on" : ""}`}
              title={settings.showLines ? "hide all lines" : "show all lines"}
              onClick={() => update("showLines", !settings.showLines)}
            >
              {settings.showLines ? "on" : "off"}
            </button>
          </div>

          {settings.legendOpen && (
            <ul
              className="galaxy-lines__list"
              onMouseLeave={() => setHoveredLine(null)}
            >
              {legendOrder.map((entry, rank) => {
                const id = entry.line.id;
                const pinned = settings.focusedLine === id;
                // Lines past the resting budget are drawn only on zoom or when
                // pinned, so the legend says so rather than leaving the reader
                // wondering why a colour is not on the map.
                const restingOnly =
                  settings.restingLineCount > 0 &&
                  rank >= settings.restingLineCount;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={`galaxy-lines__item ${pinned ? "is-pinned" : ""} ${restingOnly ? "is-resting-only" : ""}`}
                      onMouseEnter={() => setHoveredLine(id)}
                      onFocus={() => setHoveredLine(id)}
                      onBlur={() => setHoveredLine(null)}
                      onClick={() =>
                        update("focusedLine", pinned ? null : id)
                      }
                    >
                      <span
                        className="galaxy-lines__swatch"
                        style={{ background: entry.line.color }}
                      />
                      <span className="galaxy-lines__name">
                        {lineLabels.get(id) ?? entry.line.name}
                      </span>
                      <span className="galaxy-lines__stops">
                        {entry.stops.length}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {hover && (
        <div
          className="galaxy-tooltip"
          style={{ left: hover.screenX + 16, top: hover.screenY + 16 }}
        >
          <div className="galaxy-tooltip__domain">
            {hover.node.stop.representative.id}
          </div>
          <dl className="galaxy-tooltip__rows">
            <div>
              <dt>kind</dt>
              <dd>{hover.node.stop.kind}</dd>
            </div>
            <div>
              <dt>inbound</dt>
              <dd>{hover.node.stop.visits}</dd>
            </div>
            <div>
              <dt>routes</dt>
              <dd>{hover.node.degree}</dd>
            </div>
            {hover.node.stop.members.length > 1 && (
              <div>
                <dt>holds</dt>
                <dd>{hover.node.stop.members.length} domains</dd>
              </div>
            )}
            {hoverCluster && (
              <div>
                <dt>region</dt>
                <dd>{hoverCluster}</dd>
              </div>
            )}
          </dl>
          {hoverLines.length > 0 && (
            <div className="galaxy-tooltip__lines">
              {hoverLines.map((entry) => (
                <span key={entry.line.id}>
                  <i style={{ background: entry.line.color }} />
                  {lineLabels.get(entry.line.id) ?? entry.line.name}
                </span>
              ))}
            </div>
          )}
          {hover.node.stop.members.length > 1 && (
            <div className="galaxy-tooltip__fan">
              {hover.node.stop.members.slice(1, 7).map((m) => (
                <span key={m.id}>{m.id}</span>
              ))}
              {hover.node.stop.members.length > 7 && (
                <span className="galaxy-tooltip__more">
                  +{hover.node.stop.members.length - 7} more
                </span>
              )}
            </div>
          )}
          {/* The tooltip follows the cursor and is not hit-testable, so the
              walk affordance lives on the selection panel and double-click. */}
          <div className="galaxy-tooltip__hint">double-click to walk from here</div>
        </div>
      )}
    </div>
  );
};

const container = document.getElementById("reactContent");
if (!container) throw new Error("#reactContent is missing from the page");

interface RootHost extends HTMLElement {
  __galaxyRoot?: ReactDOM.Root;
}
const host = container as RootHost;
const root = host.__galaxyRoot ?? ReactDOM.createRoot(host);
host.__galaxyRoot = root;
root.render(<TransitMap />);
