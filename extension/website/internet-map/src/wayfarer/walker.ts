// ABOUTME: A character that walks the road network, steered by a heading or a route.
// ABOUTME: Pure state machine over the road graph; nothing here touches the DOM or canvas.

/**
 * The walker lives ON the roads. Its position is a road segment and a distance
 * along it, or a settlement it is standing in, or a short off-road leg between
 * a settlement and one of its buildings. Every frame it is given a desired
 * heading (where the cursor is pointing, or a held key) and it picks the road
 * that best agrees, so leading it around feels like steering a character
 * through streets rather than dragging a marker over a picture.
 *
 * Roads follow the same polyline the bake drew — `roadPath` in cell space —
 * so the walker can never drift off the pavement it claims to be on.
 */
import { RoadGraph, findRoute, Mode } from "../route";
import { roadPath, GRIDDED } from "../ascii/roadgeom";

export interface WalkerWorld {
  roads: RoadGraph;
  roadA: Uint32Array;
  roadB: Uint32Array;
  subX: Float32Array;
  subY: Float32Array;
  subGrid?: Float32Array;
  subPages?: Uint32Array;
  pageX: Float32Array;
  pageY: Float32Array;
  pageSub: Uint32Array;
  /** cell geometry, because roads bend in cells, not world units */
  x0: number;
  y0: number;
  cellW: number;
  cellH: number;
}

/** A road as a world-space polyline with cumulative lengths, from road_a to road_b. */
export interface EdgePath {
  pts: Float32Array;
  cum: Float32Array;
  len: number;
}

export interface WalkerInput {
  /** unit-ish heading the walker should try to follow; null to stand still */
  heading: { x: number; y: number } | null;
  sprint: boolean;
}

export type Standing =
  | { kind: "node"; node: number }
  | { kind: "page"; page: number; node: number };

export interface Arrival {
  kind: "node" | "page";
  node: number;
  page: number;
  /** true when this was the end of a planned journey */
  final: boolean;
}

/** How far a heading may disagree with a road before the walker refuses it. */
const TURN_LIMIT = Math.cos((105 * Math.PI) / 180);
/** Disagree by more than this mid-road and the walker turns around. */
const REVERSE_LIMIT = -0.35;
/** A road's traffic lifts walking speed: a busy road is a fast road. */
const BUSY_BOOST = 0.55;
const SPRINT = 2.2;

export class Walker {
  /** world position and unit heading, updated every step */
  x = 0; y = 0; hx = 1; hy = 0;
  /** what the walker is standing on when not moving along a road */
  standing: Standing | null = null;
  /** the road under the walker, when on one */
  edge = -1;
  /** distance from the road's `a` end */
  s = 0;
  /** +1 walks towards `b`, -1 towards `a` */
  dir: 1 | -1 = 1;
  /** an off-road leg between a settlement and a building */
  leg: { x0: number; y0: number; x1: number; y1: number; s: number; len: number;
         node: number; page: number; toPage: boolean } | null = null;
  /** a planned journey: roads still to walk, then the building at the end */
  plan: { steps: { edge: number; dir: 1 | -1 }[]; page: number; node: number } | null = null;
  /** world units walked in total */
  odometer = 0;
  /** world units per second on an untravelled road */
  baseSpeed: number;
  /** the walker's speed this frame, for the HUD */
  speed = 0;
  moving = false;

  private paths = new Map<number, EdgePath>();
  private arrivals: Arrival[] = [];

  constructor(private w: WalkerWorld, cellsPerSecond = 26) {
    this.baseSpeed = cellsPerSecond * w.cellW;
  }

  /** Arrivals since the last drain: settlements entered and buildings reached. */
  drainArrivals(): Arrival[] {
    const out = this.arrivals;
    this.arrivals = [];
    return out;
  }

  // ------------------------------------------------------------ placement

  /** Stand in a settlement. */
  placeAtNode(node: number) {
    this.leg = null; this.plan = null; this.edge = -1;
    this.standing = { kind: "node", node };
    this.x = this.w.subX[node]; this.y = this.w.subY[node];
  }

  /** Stand at a building: the walker is off the road, at its door. */
  placeAtPage(page: number) {
    const node = this.w.pageSub[page];
    this.leg = null; this.plan = null; this.edge = -1;
    this.standing = { kind: "page", page, node };
    this.x = this.w.pageX[page]; this.y = this.w.pageY[page];
  }

  /** The settlement nearest a point in the world, by straight distance. */
  nearestNode(x: number, y: number): number {
    const { subX, subY } = this.w;
    let best = -1, bd = Infinity;
    for (let i = 0; i < subX.length; i++) {
      const d = (subX[i] - x) ** 2 + (subY[i] - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** The settlement the walker is in or heading to, for route planning. */
  get node(): number {
    if (this.standing) return this.standing.node;
    if (this.leg) return this.leg.node;
    if (this.edge >= 0) return this.dir > 0 ? this.w.roadB[this.edge] : this.w.roadA[this.edge];
    return -1;
  }

  // ------------------------------------------------------------ planning

  /**
   * Walk to a building along the roads people actually use.
   *
   * From the middle of a road the journey can start at either end; both are
   * solved and the shorter total, including the rest of this road, wins.
   * Returns false when no road leads there.
   */
  travelTo(page: number, mode: Mode = "fast"): boolean {
    const target = this.w.pageSub[page];
    const starts: { node: number; lead: number; edge: number; dir: 1 | -1 }[] = [];
    if (this.standing) starts.push({ node: this.standing.node, lead: 0, edge: -1, dir: 1 });
    else if (this.leg) starts.push({ node: this.leg.node, lead: 0, edge: -1, dir: 1 });
    else if (this.edge >= 0) {
      const p = this.pathOf(this.edge);
      starts.push({ node: this.w.roadB[this.edge], lead: p.len - this.s, edge: this.edge, dir: 1 });
      starts.push({ node: this.w.roadA[this.edge], lead: this.s, edge: this.edge, dir: -1 });
    }
    if (!starts.length) return false;

    let best: { total: number; steps: { edge: number; dir: 1 | -1 }[] } | null = null;
    for (const st of starts) {
      const steps: { edge: number; dir: 1 | -1 }[] = [];
      let total = st.lead;
      if (st.edge >= 0) steps.push({ edge: st.edge, dir: st.dir });
      if (st.node !== target) {
        const r = findRoute(this.w.roads, st.node, target, mode);
        if (!r.ok) continue;
        for (let i = 0; i < r.edges.length; i++) {
          const e = r.edges[i];
          steps.push({ edge: e, dir: this.w.roadA[e] === r.nodes[i] ? 1 : -1 });
          total += this.w.roads.len[e];
        }
      }
      if (!best || total < best.total) best = { total, steps };
    }
    if (!best) return false;

    // Standing at a building means walking back to the road first.
    if (this.standing?.kind === "page" && this.standing.page !== page) {
      this.startLeg(this.standing.node, this.standing.page, false);
    } else if (this.standing?.kind === "page" && this.standing.page === page) {
      this.arrivals.push({ kind: "page", node: target, page, final: true });
      return true;
    }
    // From the middle of a road the plan's first step is this road, walked
    // towards whichever end won; keep our place on it rather than restarting.
    if (this.edge >= 0 && best.steps[0]?.edge === this.edge) {
      this.dir = best.steps[0].dir;
      best.steps.shift();
    }
    this.plan = { steps: best.steps, page, node: target };
    return true;
  }

  /** Abandon a planned journey and answer to the heading again. */
  cancel() {
    this.plan = null;
  }

  // ------------------------------------------------------------ stepping

  /** Advance the walker by `dt` seconds. */
  step(dt: number, input: WalkerInput) {
    this.moving = false;
    this.speed = 0;
    if (dt <= 0) return;
    let budget = dt;
    // a frame may cross a junction; let it, a bounded number of times
    for (let guard = 0; guard < 4 && budget > 1e-6; guard++) {
      budget = this.advance(budget, input);
    }
  }

  private advance(dt: number, input: WalkerInput): number {
    const sprint = input.sprint ? SPRINT : 1;

    // ── an off-road leg: the door and the street ──────────────────────────
    if (this.leg) {
      const L = this.leg;
      const v = this.baseSpeed * 0.8 * sprint;
      const move = Math.min(v * dt, L.len - L.s);
      L.s += move;
      this.odometer += move;
      const t = L.len > 0 ? L.s / L.len : 1;
      this.x = L.x0 + (L.x1 - L.x0) * t;
      this.y = L.y0 + (L.y1 - L.y0) * t;
      this.setHeading(L.x1 - L.x0, L.y1 - L.y0);
      this.speed = v; this.moving = move > 0;
      if (L.s >= L.len - 1e-6) {
        this.leg = null;
        if (L.toPage) {
          this.standing = { kind: "page", page: L.page, node: L.node };
          this.x = this.w.pageX[L.page]; this.y = this.w.pageY[L.page];
          // the journey ends at the door, not at the kerb: the plan stays
          // until now so a heading cannot pull the walker away mid-leg
          this.plan = null;
          this.arrivals.push({ kind: "page", node: L.node, page: L.page, final: true });
        } else {
          this.standing = { kind: "node", node: L.node };
          this.x = this.w.subX[L.node]; this.y = this.w.subY[L.node];
        }
        return dt - (v > 0 ? move / v : dt);
      }
      return 0;
    }

    // ── standing somewhere: decide whether to set off ─────────────────────
    if (this.standing) {
      if (this.standing.kind === "page") {
        if (this.plan) {
          // a plan from a building starts by walking to the street
          this.startLeg(this.standing.node, this.standing.page, false);
          return dt;
        }
        if (!input.heading) return 0;
        this.startLeg(this.standing.node, this.standing.page, false);
        return dt;
      }
      const node = this.standing.node;
      if (this.plan) {
        if (this.plan.steps.length) {
          const st = this.plan.steps.shift()!;
          this.enterEdge(st.edge, st.dir);
        } else if (this.plan.page >= 0 && this.plan.node === node) {
          const page = this.plan.page;
          const dx = this.w.pageX[page] - this.x, dy = this.w.pageY[page] - this.y;
          if (Math.hypot(dx, dy) < this.w.cellW * 0.5) {
            this.plan = null;
            this.standing = { kind: "page", page, node };
            this.arrivals.push({ kind: "page", node, page, final: true });
            return 0;
          }
          this.startLeg(node, page, true);
          return dt;
        } else {
          this.plan = null;
          return 0;
        }
      } else {
        if (!input.heading) return 0;
        const e = this.chooseEdge(node, input.heading);
        if (!e) return 0;
        this.enterEdge(e.edge, e.dir);
      }
    }

    // ── on a road ─────────────────────────────────────────────────────────
    if (this.edge < 0) return 0;
    const P = this.pathOf(this.edge);
    if (!this.plan && input.heading) {
      const [tx, ty] = this.tangentAt(P, this.s, this.dir);
      const dot = tx * input.heading.x + ty * input.heading.y;
      if (dot < REVERSE_LIMIT) this.dir = this.dir > 0 ? -1 : 1;
    } else if (!this.plan && !input.heading) {
      // nobody is leading: stop where you are
      const [tx, ty] = this.tangentAt(P, this.s, this.dir);
      this.setHeading(tx, ty);
      return 0;
    }
    const busy = this.w.roads.busy[this.edge] || 0;
    const v = this.baseSpeed * (1 + BUSY_BOOST * busy) * sprint;
    const want = v * dt;
    const room = this.dir > 0 ? P.len - this.s : this.s;
    const move = Math.min(want, room);
    this.s += this.dir * move;
    this.odometer += move;
    this.speed = v; this.moving = move > 0;
    const [px, py] = this.pointAt(P, this.s);
    this.x = px; this.y = py;
    const [tx, ty] = this.tangentAt(P, this.s, this.dir);
    this.setHeading(tx, ty);

    if (move >= room - 1e-6) {
      const node = this.dir > 0 ? this.w.roadB[this.edge] : this.w.roadA[this.edge];
      this.edge = -1;
      this.standing = { kind: "node", node };
      this.x = this.w.subX[node]; this.y = this.w.subY[node];
      const final = !!this.plan && this.plan.steps.length === 0 && this.plan.page < 0;
      this.arrivals.push({ kind: "node", node, page: -1, final });
      if (final) this.plan = null;
      return dt - move / v;
    }
    return 0;
  }

  // ------------------------------------------------------------ helpers

  private startLeg(node: number, page: number, toPage: boolean) {
    const nx = this.w.subX[node], ny = this.w.subY[node];
    const px = this.w.pageX[page], py = this.w.pageY[page];
    const [x0, y0, x1, y1] = toPage ? [nx, ny, px, py] : [px, py, nx, ny];
    this.standing = null;
    this.edge = -1;
    this.leg = { x0, y0, x1, y1, s: 0, len: Math.hypot(x1 - x0, y1 - y0), node, page, toPage };
    this.x = x0; this.y = y0;
  }

  private enterEdge(edge: number, dir: 1 | -1) {
    const P = this.pathOf(edge);
    this.standing = null;
    this.edge = edge;
    this.dir = dir;
    this.s = dir > 0 ? 0 : P.len;
  }

  /** The road leaving `node` that best agrees with `heading`, or null. */
  private chooseEdge(node: number, heading: { x: number; y: number }):
      { edge: number; dir: 1 | -1 } | null {
    const g = this.w.roads;
    const hl = Math.hypot(heading.x, heading.y) || 1;
    const hx = heading.x / hl, hy = heading.y / hl;
    let best = -1, bestDot = TURN_LIMIT;
    let bestDir: 1 | -1 = 1;
    for (let k = g.start[node]; k < g.start[node + 1]; k++) {
      const e = g.edge[k];
      const dir: 1 | -1 = this.w.roadA[e] === node ? 1 : -1;
      const P = this.pathOf(e);
      const [tx, ty] = this.tangentAt(P, dir > 0 ? 0 : P.len, dir);
      const dot = tx * hx + ty * hy;
      if (dot > bestDot) { bestDot = dot; best = e; bestDir = dir; }
    }
    return best < 0 ? null : { edge: best, dir: bestDir };
  }

  private setHeading(dx: number, dy: number) {
    const l = Math.hypot(dx, dy);
    if (l > 1e-9) { this.hx = dx / l; this.hy = dy / l; }
  }

  /** The road's polyline in world units, built once per road. */
  pathOf(e: number): EdgePath {
    let P = this.paths.get(e);
    if (P) return P;
    const w = this.w;
    const a = w.roadA[e], b = w.roadB[e];
    const ax = (w.subX[a] - w.x0) / w.cellW, ay = (w.subY[a] - w.y0) / w.cellH;
    const bx = (w.subX[b] - w.x0) / w.cellW, by = (w.subY[b] - w.y0) / w.cellH;
    const gridded = !!(w.subGrid && w.subPages && w.subGrid[a] === w.subGrid[b] &&
                       w.subPages[a] >= GRIDDED && w.subPages[b] >= GRIDDED);
    const cells = roadPath(ax, ay, bx, by, gridded ? w.subGrid![a] : null);
    const n = cells.length / 2;
    const pts = new Float32Array(cells.length);
    const cum = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // the bake floors to a cell and draws in it; walk through the cell's middle
      pts[i * 2] = w.x0 + (Math.floor(cells[i * 2]) + 0.5) * w.cellW;
      pts[i * 2 + 1] = w.y0 + (Math.floor(cells[i * 2 + 1]) + 0.5) * w.cellH;
    }
    // the ends sit exactly on the settlements, whatever cell they fell in
    pts[0] = w.subX[a]; pts[1] = w.subY[a];
    pts[cells.length - 2] = w.subX[b]; pts[cells.length - 1] = w.subY[b];
    for (let i = 1; i < n; i++) {
      cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2],
                                       pts[i * 2 + 1] - pts[i * 2 - 1]);
    }
    P = { pts, cum, len: cum[n - 1] || 1e-6 };
    this.paths.set(e, P);
    return P;
  }

  private segAt(P: EdgePath, s: number): number {
    const { cum } = P;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    return lo;
  }

  pointAt(P: EdgePath, s: number): [number, number] {
    const i = this.segAt(P, s);
    const a = P.cum[i], b = P.cum[i + 1] ?? a;
    const t = b > a ? Math.max(0, Math.min(1, (s - a) / (b - a))) : 0;
    const j = Math.min(i + 1, P.cum.length - 1);
    return [P.pts[i * 2] + (P.pts[j * 2] - P.pts[i * 2]) * t,
            P.pts[i * 2 + 1] + (P.pts[j * 2 + 1] - P.pts[i * 2 + 1]) * t];
  }

  /** Unit direction of travel at `s`, for a walker moving in `dir`. */
  tangentAt(P: EdgePath, s: number, dir: 1 | -1): [number, number] {
    // look a little way ahead so a corner is anticipated, not discovered
    const ahead = Math.min(P.len, Math.max(0, s + dir * this.w.cellW * 3));
    const [ax, ay] = this.pointAt(P, s);
    const [bx, by] = this.pointAt(P, ahead);
    let dx = bx - ax, dy = by - ay;
    if (Math.hypot(dx, dy) < 1e-6) {
      const i = Math.min(this.segAt(P, s), P.cum.length - 2);
      dx = (P.pts[i * 2 + 2] - P.pts[i * 2]) * dir;
      dy = (P.pts[i * 2 + 3] - P.pts[i * 2 + 1]) * dir;
    }
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }
}
