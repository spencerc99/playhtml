// ABOUTME: Walk mode for the internet map: a character on the roads, led by the cursor, followed by the camera.
// ABOUTME: Owns input, the follow camera, the HUD panel and the character's drawing; the walker owns the roads.

/**
 * Third-person navigation. Instead of dragging the map around, you lead a
 * character along its roads: the cursor is where you want to go, the
 * character picks the street that goes that way, and the camera keeps it in
 * view with a little room ahead. Click a building and the character walks
 * there by the route people actually take; the HUD is a passport of where
 * you have been.
 *
 * The same class drives the extension widget, where nobody is steering and
 * the journeys come from the sites the person is visiting.
 */
import { Camera, flyTo } from "../camera";
import { BakedMap } from "../ascii/bake";
import { Arrays, Labels } from "../data";
import { RoadGraph } from "../route";
import { Theme } from "../theme";
import { Walker, Arrival } from "./walker";
import { subHost } from "./locate";

export interface WayfarerContext {
  cam: Camera;
  ctx: CanvasRenderingContext2D;
  baked: BakedMap;
  A: Arrays;
  labels: Labels;
  roads: RoadGraph;
  theme: () => Theme;
  /** request a repaint (coalesced by the caller) */
  draw: () => void;
  /** paint the cells of these roads in a colour, as the route overlay does */
  paintEdges: (edges: number[], fill: string) => void;
  /** which building is under a screen point, or -1 */
  buildingAt: (sx: number, sy: number) => number;
  /** mark a landing: a ring and a name that fade */
  land: (x: number, y: number, r: number, name: string) => void;
  /** turn place names on or off while walking */
  setLabels: (on: boolean) => void;
  /** the mode switched; the caller swaps panels */
  onModeChange: (active: boolean) => void;
  /** the HUD panel, or null in the widget where there is none */
  panel: HTMLElement | null;
}

export interface WayfarerStatus {
  state: "standing" | "walking" | "arrived";
  /** where the walker is, in words */
  at: string;
  host: string;
  domain: string;
  page: number;
  /** where a journey is taking it, if anywhere */
  dest: { page: number; name: string } | null;
  blocks: number;
  places: number;
}

/** cell size on screen the mode settles at, and the range wheel zoom may roam */
const STREET_PX = 12;
const ZOOM_MIN_PX = 4.5;
const ZOOM_MAX_PX = 30;
/** the cursor has to be this far from the character before it leads */
const DEAD_ZONE_PX = 34;
/** after an arrival the cursor must travel this far before it leads again */
const REARM_PX = 28;
/** how much of the screen is kept ahead of the character */
const LOOKAHEAD = 0.14;
/** and how far behind the middle it may ever fall */
const MAX_LAG = 0.18;
const TRAIL_MAX = 900;
/**
 * A planned journey takes about this long whatever its length, so a walk
 * across the map is not a wait and a walk across town is not a blink. Leading
 * by hand stays at the walker's own pace.
 */
const TRIP_SECONDS = 7;
const TRIP_MIN_CELLS_PER_S = 30;
const TRIP_MAX_CELLS_PER_S = 700;
const PASSPORT_MAX = 8;

const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export class Wayfarer {
  readonly walker: Walker;
  active = false;
  /** space: stop answering to the cursor without leaving the mode */
  paused = false;
  /** the extension widget: no one is steering, journeys arrive from outside */
  widget = false;
  /** how long a planned journey should take on screen */
  tripSeconds = TRIP_SECONDS;
  private walkingPace: number;

  private pointer: { x: number; y: number } | null = null;
  /**
   * Arriving somewhere disarms the cursor until it moves again, so a
   * journey's end is not immediately undone by wherever the pointer happened
   * to be left. The same on entering the mode.
   */
  private leadArmed = false;
  private armAt: { x: number; y: number } | null = null;
  private keys = new Set<string>();
  private sprint = false;
  private trail: number[] = [];
  private passport: string[] = [];
  private dest: { page: number; name: string } | null = null;
  private raf = 0;
  private last = 0;
  private hudAt = 0;
  private status: WayfarerStatus | null = null;
  private listeners: ((s: WayfarerStatus) => void)[] = [];
  private keyHandlers: { down: (e: KeyboardEvent) => void; up: (e: KeyboardEvent) => void } | null = null;
  private subHosts: string[];

  constructor(private c: WayfarerContext) {
    const { A, baked } = c;
    this.walker = new Walker({
      roads: c.roads,
      roadA: A.road_a as Uint32Array, roadB: A.road_b as Uint32Array,
      subX: A.sub_x as Float32Array, subY: A.sub_y as Float32Array,
      subGrid: A.sub_grid as Float32Array | undefined,
      subPages: A.sub_pages as Uint32Array | undefined,
      pageX: A.page_x as Float32Array, pageY: A.page_y as Float32Array,
      pageSub: A.page_sub as Uint32Array,
      x0: baked.x0, y0: baked.y0, cellW: baked.cellW, cellH: baked.cellH,
    });
    this.subHosts = c.labels.subs.map(subHost);
    this.walkingPace = this.walker.baseSpeed;
  }

  onStatus(fn: (s: WayfarerStatus) => void) { this.listeners.push(fn); }

  // ------------------------------------------------------------ mode

  /**
   * Start walking. At a building if one is given, else in the settlement
   * nearest the middle of the view, so entering the mode never teleports far.
   */
  enter(opts: { page?: number; node?: number; instant?: boolean } = {}) {
    const wasActive = this.active;
    this.active = true;
    const { cam, baked } = this.c;
    if (opts.page !== undefined && opts.page >= 0) this.walker.placeAtPage(opts.page);
    else if (opts.node !== undefined && opts.node >= 0) this.walker.placeAtNode(opts.node);
    else if (!wasActive) this.walker.placeAtNode(this.walker.nearestNode(cam.cx, cam.cy));
    this.trail.length = 0;
    this.dest = null;
    this.disarm();
    const k = STREET_PX / baked.cellW;
    if (opts.instant || this.widget) {
      cam.cx = this.walker.x; cam.cy = this.walker.y; cam.k = k;
    } else {
      flyTo(cam, this.walker.x, this.walker.y, k, () => this.c.draw());
    }
    if (!wasActive) {
      this.c.setLabels(true);
      this.c.onModeChange(true);
      if (!this.widget) this.bindKeys();
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.tick(t));
    }
    this.note(this.walker.standing?.kind === "page" ? "arrived" : "standing");
    this.updateHud(true);
    this.c.draw();
  }

  leave() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.unbindKeys();
    this.pointer = null;
    this.keys.clear();
    this.c.setLabels(false);
    this.c.onModeChange(false);
    this.c.draw();
  }

  toggle() { if (this.active) this.leave(); else this.enter(); }

  // ------------------------------------------------------------ input

  /** the cursor moved over the map */
  pointerMove(sx: number, sy: number) {
    this.pointer = { x: sx, y: sy };
    if (!this.leadArmed) {
      if (!this.armAt) this.armAt = { x: sx, y: sy };
      else if (Math.hypot(sx - this.armAt.x, sy - this.armAt.y) > REARM_PX) this.leadArmed = true;
    }
  }

  /** stop answering to the cursor until it is moved again */
  private disarm() {
    this.leadArmed = false;
    this.armAt = this.pointer ? { ...this.pointer } : null;
  }

  pointerLeave() { this.pointer = null; }

  /** a click: a building is a destination, open ground calls the walker off */
  click(sx: number, sy: number) {
    const page = this.c.buildingAt(sx, sy);
    if (page >= 0) this.travel(page);
    else if (this.walker.plan) this.cancelTrip();
  }

  private cancelTrip() {
    this.walker.cancel();
    this.walker.baseSpeed = this.walkingPace;
    this.dest = null;
    this.updateHud(true);
  }

  /** Walk to a building by road. Returns false when no road leads there. */
  travel(page: number): boolean {
    const ok = this.walker.travelTo(page);
    if (!ok) return false;
    const cells = this.planLength() / this.c.baked.cellW / this.tripSeconds;
    this.walker.baseSpeed = Math.max(TRIP_MIN_CELLS_PER_S, Math.min(TRIP_MAX_CELLS_PER_S, cells))
      * this.c.baked.cellW;
    this.dest = { page, name: this.pageName(page) };
    this.paused = false;
    this.note("walking");
    this.updateHud(true);
    return true;
  }

  /** How far the current plan still has to go, in world units. */
  planLength(): number {
    const w = this.walker;
    let total = 0;
    if (w.leg) total += w.leg.len - w.leg.s;
    if (w.edge >= 0) {
      const P = w.pathOf(w.edge);
      total += w.dir > 0 ? P.len - w.s : w.s;
    }
    if (w.plan && !w.leg) {
      for (const st of w.plan.steps) total += this.c.roads.len[st.edge];
      const A = this.c.A;
      const nx = (A.sub_x as Float32Array)[w.plan.node], ny = (A.sub_y as Float32Array)[w.plan.node];
      total += Math.hypot((A.page_x as Float32Array)[w.plan.page] - nx,
                          (A.page_y as Float32Array)[w.plan.page] - ny);
    }
    return total;
  }

  private bindKeys() {
    const down = (e: KeyboardEvent) => {
      if (!this.active) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      if (k === "shift") { this.sprint = true; return; }
      if (k === " ") { e.preventDefault(); this.paused = !this.paused; this.updateHud(true); return; }
      if (k === "escape") { this.leave(); return; }
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k) &&
          !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this.keys.add(k);
        this.leadArmed = true;
        if (this.walker.plan) this.cancelTrip();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "shift") this.sprint = false;
      this.keys.delete(k);
    };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    this.keyHandlers = { down, up };
  }

  /** the arrows or WASD held right now, as a heading */
  private keyHeading(): { x: number; y: number } | null {
    let x = 0, y = 0;
    if (this.keys.has("arrowup") || this.keys.has("w")) y -= 1;
    if (this.keys.has("arrowdown") || this.keys.has("s")) y += 1;
    if (this.keys.has("arrowleft") || this.keys.has("a")) x -= 1;
    if (this.keys.has("arrowright") || this.keys.has("d")) x += 1;
    return x || y ? { x, y } : null;
  }

  private unbindKeys() {
    if (!this.keyHandlers) return;
    removeEventListener("keydown", this.keyHandlers.down);
    removeEventListener("keyup", this.keyHandlers.up);
    this.keyHandlers = null;
  }

  // ------------------------------------------------------------ the loop

  private tick(now: number) {
    if (!this.active) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const { cam, baked } = this.c;
    const w = this.walker;

    // what leads the walker this frame
    let heading: { x: number; y: number } | null = null;
    if (!w.plan && !this.widget) {
      heading = this.keyHeading();
      if (!heading && this.pointer && !this.paused && this.leadArmed) {
        const dx = this.pointer.x - cam.toScreenX(w.x);
        const dy = this.pointer.y - cam.toScreenY(w.y);
        if (Math.hypot(dx, dy) > DEAD_ZONE_PX) heading = { x: dx, y: dy };
      }
    }
    const wasMoving = w.moving;
    w.step(dt, { heading, sprint: this.sprint });

    // breadcrumbs, one per cell or so
    if (w.moving) {
      const n = this.trail.length;
      if (!n || Math.hypot(w.x - this.trail[n - 2], w.y - this.trail[n - 1]) > baked.cellW) {
        this.trail.push(w.x, w.y);
        if (this.trail.length > TRAIL_MAX * 2) this.trail.splice(0, this.trail.length - TRAIL_MAX * 2);
      }
    }

    for (const a of w.drainArrivals()) this.arrived(a);

    // the camera follows, with a little room ahead in the direction of travel
    const look = (LOOKAHEAD * Math.min(cam.W, cam.H)) / cam.k;
    const tx = w.x + (w.moving ? w.hx * look : 0);
    const ty = w.y + (w.moving ? w.hy * look : 0);
    const ease = 1 - Math.exp(-dt * (this.widget ? 5 : 6));
    cam.cx += (tx - cam.cx) * ease;
    cam.cy += (ty - cam.cy) * ease;
    // A planned trip can be quick enough to outrun the easing; whatever the
    // speed, the walker stays inside the middle of the view.
    const lagX = tx - cam.cx, lagY = ty - cam.cy;
    const lag = Math.hypot(lagX, lagY);
    const maxLag = (MAX_LAG * Math.min(cam.W, cam.H)) / cam.k;
    if (lag > maxLag) {
      cam.cx = tx - (lagX / lag) * maxLag;
      cam.cy = ty - (lagY / lag) * maxLag;
    }
    if (this.widget) {
      // pull back on a long road, close in at the door
      const px = w.moving ? Math.max(6, STREET_PX - Math.min(6, this.planLength() / (baked.cellW * 60))) : STREET_PX;
      const kt = px / baked.cellW;
      cam.k += (kt - cam.k) * (1 - Math.exp(-dt * 2));
    } else {
      cam.k = Math.max(ZOOM_MIN_PX / baked.cellW, Math.min(ZOOM_MAX_PX / baked.cellW, cam.k));
    }

    if (w.moving !== wasMoving || now - this.hudAt > 160) this.updateHud(false);
    if (w.moving || wasMoving || this.dest) this.c.draw();
    else if (now - this.hudAt < 200) this.c.draw();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private arrived(a: Arrival) {
    const host = this.subHosts[a.node] ?? "";
    if (host && this.passport[this.passport.length - 1] !== host) {
      this.passport.push(host);
      if (this.passport.length > PASSPORT_MAX) this.passport.shift();
    }
    if (a.kind === "page" && a.final) {
      const A = this.c.A;
      this.c.land((A.page_x as Float32Array)[a.page], (A.page_y as Float32Array)[a.page],
                  this.c.baked.cellW * 6, this.pageName(a.page));
      this.dest = null;
      this.walker.baseSpeed = this.walkingPace;
      this.disarm();
      this.note("arrived");
      this.updateHud(true);
    }
  }

  // ------------------------------------------------------------ naming

  private pageName(page: number): string {
    const { labels } = this.c;
    return labels.titles[page] || labels.pages[page] || "";
  }

  private whereAmI(): { at: string; host: string; domain: string; page: number } {
    const w = this.walker;
    const { A, labels } = this.c;
    const SUB_DOM = A.sub_dom as Uint32Array;
    const domOf = (sub: number) => labels.doms[SUB_DOM[sub]] ?? "";
    if (w.standing?.kind === "page") {
      const p = w.standing.page;
      return { at: labels.pages[p], host: this.subHosts[w.standing.node], domain: domOf(w.standing.node), page: p };
    }
    if (w.standing) {
      const n = w.standing.node;
      return { at: this.subHosts[n], host: this.subHosts[n], domain: domOf(n), page: -1 };
    }
    if (w.leg) {
      const n = w.leg.node;
      return { at: `${w.leg.toPage ? "walking up to" : "leaving"} ${labels.pages[w.leg.page]}`,
               host: this.subHosts[n], domain: domOf(n), page: -1 };
    }
    if (w.edge >= 0) {
      const a = (A.road_a as Uint32Array)[w.edge], b = (A.road_b as Uint32Array)[w.edge];
      const [from, to] = w.dir > 0 ? [a, b] : [b, a];
      const near = w.s < w.pathOf(w.edge).len / 2 ? a : b;
      const fh = this.subHosts[from], th = this.subHosts[to];
      return { at: fh === th ? `the streets of ${fh}` : `the road from ${fh} to ${th}`,
               host: this.subHosts[near], domain: domOf(near), page: -1 };
    }
    return { at: "", host: "", domain: "", page: -1 };
  }

  /** Refresh the status, and tell listeners only when something they show has changed. */
  private note(state: WayfarerStatus["state"]) {
    const where = this.whereAmI();
    const prev = this.status;
    this.status = {
      state, ...where, dest: this.dest,
      blocks: Math.round(this.walker.odometer / this.c.baked.cellW),
      places: this.passport.length,
    };
    const changed = !prev || prev.state !== state || prev.at !== where.at ||
      prev.page !== where.page || prev.dest?.page !== this.dest?.page;
    if (changed) for (const fn of this.listeners) fn(this.status);
  }

  get currentStatus(): WayfarerStatus | null { return this.status; }

  // ------------------------------------------------------------ HUD

  private updateHud(_force: boolean) {
    this.hudAt = performance.now();
    const w = this.walker;
    const state: WayfarerStatus["state"] = w.moving ? "walking"
      : w.standing?.kind === "page" ? "arrived" : "standing";
    this.note(state);
    const p = this.c.panel;
    if (!p) return;
    const s = this.status!;
    const set = (id: string, text: string) => {
      const el = p.querySelector<HTMLElement>(`#${id}`);
      if (el && el.textContent !== text) el.textContent = text;
    };
    set("wk-at", s.at || "nowhere in particular");
    set("wk-dom", s.host && s.domain && s.host !== s.domain ? s.domain : "");
    const dir = DIRS[Math.round(((Math.atan2(w.hy, w.hx) * 180) / Math.PI + 90 + 360) / 45) % 8];
    set("wk-heading", w.moving
      ? `${dir} · ${Math.round(w.speed / this.c.baked.cellW)} blocks/s${this.sprint ? " · running" : ""}`
      : this.paused ? "paused · space to resume" : w.plan ? "setting off" : "standing");
    set("wk-odo", `${s.blocks.toLocaleString()} blocks · ${s.places} ${s.places === 1 ? "place" : "places"}`);
    const dest = p.querySelector<HTMLElement>("#wk-dest-row");
    if (dest) dest.style.display = this.dest ? "" : "none";
    if (this.dest) {
      const left = w.plan ? w.plan.steps.length : 0;
      set("wk-dest", `${this.dest.name}${left ? ` · ${left} ${left === 1 ? "road" : "roads"} to go` : ""}`);
    }
    const pass = p.querySelector<HTMLElement>("#wk-passport");
    if (pass) {
      const text = this.passport.length ? this.passport.join("  ·  ") : "nowhere yet";
      if (pass.textContent !== text) pass.textContent = text;
    }
  }

  // ------------------------------------------------------------ drawing

  /** Draw the character and everything that belongs to it, after the map. */
  draw() {
    if (!this.active) return;
    const { ctx, cam, baked } = this.c;
    const t = this.c.theme();
    const w = this.walker;
    const cw = baked.cellW * cam.k;

    // the planned road ahead, in the route ink
    if (w.plan) {
      const edges = w.plan.steps.map((s) => s.edge);
      if (w.edge >= 0) edges.unshift(w.edge);
      ctx.save();
      ctx.globalAlpha = 0.55;
      this.c.paintEdges(edges, t.routeInk);
      ctx.restore();
    }

    // breadcrumbs
    if (this.trail.length >= 4) {
      ctx.save();
      ctx.strokeStyle = t.walkerTrail;
      ctx.lineWidth = Math.max(1.5, cw * 0.28);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      const n = this.trail.length / 2;
      const chunk = 40;
      for (let i = 0; i < n - 1; i += chunk) {
        ctx.globalAlpha = 0.12 + 0.5 * (i / n);
        ctx.beginPath();
        ctx.moveTo(cam.toScreenX(this.trail[i * 2]), cam.toScreenY(this.trail[i * 2 + 1]));
        for (let j = i + 1; j <= Math.min(n - 1, i + chunk); j++) {
          ctx.lineTo(cam.toScreenX(this.trail[j * 2]), cam.toScreenY(this.trail[j * 2 + 1]));
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // the destination door
    if (this.dest) {
      const A = this.c.A;
      const dx = cam.toScreenX((A.page_x as Float32Array)[this.dest.page]);
      const dy = cam.toScreenY((A.page_y as Float32Array)[this.dest.page]);
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      ctx.save();
      ctx.strokeStyle = t.routeTo;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5 + 0.5 * pulse;
      ctx.beginPath();
      ctx.arc(dx + cw / 2, dy + (baked.cellH * cam.k) / 2, Math.max(9, cw) * (1 + 0.35 * pulse), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // the character
    const sx = cam.toScreenX(w.x), sy = cam.toScreenY(w.y);
    const r = Math.max(7, cw * 0.85);
    ctx.save();
    ctx.fillStyle = t.walkerHalo;
    ctx.globalAlpha = 0.82;
    ctx.beginPath(); ctx.arc(sx, sy, r + 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = t.walker;
    ctx.fillStyle = t.walker;
    ctx.lineWidth = Math.max(2, r * 0.22);
    ctx.beginPath(); ctx.arc(sx, sy, r * 0.78, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, r * 0.28, 0, Math.PI * 2); ctx.fill();
    // which way it faces
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx + w.hx * r * 0.78, sy + w.hy * r * 0.78);
    ctx.lineTo(sx + w.hx * r * 1.45, sy + w.hy * r * 1.45);
    ctx.stroke();
    // a bob while walking, so it reads as walking and not sliding
    if (w.moving) {
      const step = Math.sin(performance.now() / 90) * r * 0.18;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(sx - w.hy * step, sy + w.hx * step, r * 0.12, 0, Math.PI * 2); ctx.fill();
    }

    // where it is, in words, over its head — unless it is at a door, where
    // the landing mark and the building's own label already say so
    const s = this.status;
    if (s && s.at && s.page < 0 && !this.widget) {
      const px = 12 * t.labelScale;
      ctx.font = `${px}px MEKText, monospace`;
      ctx.textBaseline = "bottom";
      ctx.textAlign = "center";
      ctx.lineWidth = Math.max(3, px * 0.3);
      ctx.strokeStyle = t.labelHalo;
      ctx.lineJoin = "round";
      const label = s.page >= 0 ? this.pageName(s.page) : s.host;
      ctx.strokeText(label, sx, sy - r - 6);
      ctx.fillStyle = t.label;
      ctx.fillText(label, sx, sy - r - 6);
    }
    ctx.restore();
  }
}
