// ABOUTME: Owns quarantine-tape state, the full-viewport overlay, and the commit/rip gestures.
// ABOUTME: The local strip array is the session source of truth; the worker (via quarantine-api) is the store.

import { injectShadow } from "../../../entrypoints/content/inject-ui";
import { getVerdict, postStrip, postRip } from "./quarantine-api";
import {
  buildSharedDefs,
  buildTapeGroup,
  edgeSegments,
  pointToXY,
  segmentCross,
  snapToWall,
  TYPE_STYLE,
} from "./tape-render";
import { isFullyTorn, SET_THRESHOLD, type EdgePoint, type Strip, type TapeType } from "./types";

const SVGNS = "http://www.w3.org/2000/svg";
const SLASH_MIN_LEN = 36; // min drag distance (px) for a rip to count — keeps it heavy/intentional

export const QUARANTINE_TAPE_CSS = `
:host { pointer-events: none; }
.qt-overlay { position: fixed; inset: 0; width: 100vw; height: 100vh; overflow: visible; pointer-events: none; }
.qt-overlay.armed { pointer-events: auto; cursor: crosshair; }
`;

export class QuarantineTapeManager {
  private readonly playerPid: string;

  private host: HTMLElement | null = null;
  private overlay: SVGSVGElement | null = null;
  private defs!: SVGDefsElement;
  private gEdges!: SVGGElement;
  private gStrips!: SVGGElement;
  private gPreview!: SVGGElement;
  private gSlash!: SVGGElement;

  private strips: Strip[] = [];

  // arming
  private equipped: TapeType | null = null;
  // commit gesture
  private pending: EdgePoint | null = null;
  private cursor = { x: 0, y: 0 };
  private previewRaf = 0;
  // rip gesture
  private slashStart: { x: number; y: number } | null = null;

  private destroyed = false;

  constructor(playerPid: string) {
    this.playerPid = playerPid;
  }

  async init(): Promise<() => void> {
    const { host, shadow } = injectShadow({
      hostId: "we-were-online-quarantine-tape",
      hostStyle: "position:fixed;inset:0;pointer-events:none;z-index:2147483644;",
      css: QUARANTINE_TAPE_CSS,
    });
    this.host = host;

    const overlay = document.createElementNS(SVGNS, "svg");
    overlay.setAttribute("class", "qt-overlay");
    shadow.appendChild(overlay);
    this.overlay = overlay;

    this.defs = document.createElementNS(SVGNS, "defs");
    overlay.appendChild(this.defs);
    buildSharedDefs(this.defs);

    this.gEdges = document.createElementNS(SVGNS, "g");
    this.gStrips = document.createElementNS(SVGNS, "g");
    this.gPreview = document.createElementNS(SVGNS, "g");
    this.gSlash = document.createElementNS(SVGNS, "g");
    overlay.append(this.gEdges, this.gStrips, this.gPreview, this.gSlash);

    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("click", this.onClick, true);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("dragstart", this.onDragStart);
    window.addEventListener("resize", this.onResize);

    // Seed from the worker's verdict (fetched once — the worker is the store,
    // there's no live channel; the local array is the session source of truth).
    const strips = await getVerdict(location.href);
    if (this.destroyed) return () => {};
    this.strips = strips;
    this.renderStrips();

    return () => this.destroy();
  }

  /** Called by the registry adapter when a quarantine-tape item is armed/disarmed. */
  setEquipped(type: TapeType | null) {
    if (this.equipped === type) return;
    this.equipped = type;
    this.pending = null;
    this.overlay?.classList.toggle("armed", !!type);
    this.gPreview.replaceChildren();
    this.renderEdges();
  }

  private ripPositions(s: Strip): number[] {
    return s.rips.map((r) => r.pos);
  }

  // ----- render passes -----
  private renderStrips() {
    // drop stale clip defs from removed strips
    const liveClips = new Set(this.strips.map((s) => `clip-${s.seed}-`));
    this.defs.querySelectorAll("[id^='clip-']").forEach((n) => {
      if (![...liveClips].some((p) => n.id.startsWith(p))) n.remove();
    });
    this.gStrips.replaceChildren();

    // setness counts only strips that aren't fully torn down
    const standing = this.strips.filter((s) => !isFullyTorn(s));
    const setness = Math.min(1, standing.length / (SET_THRESHOLD + 2));
    const provisional = standing.length < SET_THRESHOLD;
    for (const s of this.strips) {
      const a = pointToXY(s.a),
        b = pointToXY(s.b);
      const torn = isFullyTorn(s);
      const opacity = torn ? 0.35 : 0.55 + setness * 0.45;
      this.gStrips.appendChild(
        buildTapeGroup(
          this.defs,
          a.x,
          a.y,
          b.x,
          b.y,
          s.type,
          s.seed,
          opacity,
          provisional && !torn,
          this.ripPositions(s),
          torn,
        ),
      );
    }
  }

  private renderEdges() {
    this.gEdges.replaceChildren();
    if (!this.equipped) return;
    const color = TYPE_STYLE[this.equipped].base;
    for (const [x1, y1, x2, y2] of edgeSegments()) {
      const ln = document.createElementNS(SVGNS, "line");
      ln.setAttribute("x1", String(x1));
      ln.setAttribute("y1", String(y1));
      ln.setAttribute("x2", String(x2));
      ln.setAttribute("y2", String(y2));
      ln.setAttribute("stroke", color);
      ln.setAttribute("stroke-width", "6");
      ln.setAttribute("stroke-opacity", "0.6");
      ln.setAttribute("style", "filter: drop-shadow(0 0 9px " + color + ");");
      this.gEdges.appendChild(ln);
    }
  }

  private renderPreview() {
    if (this.previewRaf) return; // coalesce mousemoves to one paint per frame
    this.previewRaf = requestAnimationFrame(() => {
      this.previewRaf = 0;
      this.gPreview.replaceChildren();
      if (!this.equipped || !this.pending) return;
      const a = pointToXY(this.pending);
      const snap = snapToWall(this.cursor.x, this.cursor.y);
      const end = snap ? pointToXY(snap) : this.cursor;
      this.gPreview.appendChild(
        buildTapeGroup(this.defs, a.x, a.y, end.x, end.y, this.equipped, 7, 0.62, true),
      );

      const nub = document.createElementNS(SVGNS, "circle");
      nub.setAttribute("cx", String(a.x));
      nub.setAttribute("cy", String(a.y));
      nub.setAttribute("r", "6");
      nub.setAttribute("fill", TYPE_STYLE[this.equipped].base);
      nub.setAttribute("stroke", "#161616");
      nub.setAttribute("stroke-width", "1.5");
      this.gPreview.appendChild(nub);
    });
  }

  // ----- interaction -----
  private onMouseMove = (e: MouseEvent) => {
    this.cursor = { x: e.clientX, y: e.clientY };
    if (this.equipped && this.pending) this.renderPreview();

    if (this.slashStart) {
      // draw a live blade trail while dragging
      this.gSlash.replaceChildren();
      const ln = document.createElementNS(SVGNS, "line");
      ln.setAttribute("x1", String(this.slashStart.x));
      ln.setAttribute("y1", String(this.slashStart.y));
      ln.setAttribute("x2", String(e.clientX));
      ln.setAttribute("y2", String(e.clientY));
      ln.setAttribute("stroke", "#fff");
      ln.setAttribute("stroke-width", "2.5");
      ln.setAttribute("stroke-opacity", "0.85");
      ln.setAttribute("style", "filter: drop-shadow(0 0 4px rgba(0,0,0,0.6));");
      this.gSlash.appendChild(ln);
    }
  };

  private onMouseDown = (e: MouseEvent) => {
    if (this.equipped) return; // armed → laying tape via click, not ripping
    this.slashStart = { x: e.clientX, y: e.clientY };
    document.body.style.userSelect = "none"; // don't select page text mid-slash
  };

  // Images are natively draggable: without this the browser hijacks the gesture
  // with an HTML5 drag (dragstart fires, mouseup never does), so armed placement
  // and mid-slash drags silently do nothing.
  private onDragStart = (e: DragEvent) => {
    if (this.equipped || this.slashStart) e.preventDefault();
  };

  private onClick = (e: MouseEvent) => {
    if (!this.equipped) return;
    const snap = snapToWall(e.clientX, e.clientY);
    if (!snap) return;
    e.preventDefault();
    e.stopPropagation();
    if (!this.pending) {
      this.pending = snap;
      this.renderPreview();
      return;
    }
    void this.commitStrip(this.pending, snap, this.equipped);
    this.pending = null;
    this.gPreview.replaceChildren();
  };

  private onMouseUp = (e: MouseEvent) => {
    const start = this.slashStart;
    this.slashStart = null;
    this.gSlash.replaceChildren();
    document.body.style.userSelect = "";
    if (!start) return;
    const end = { x: e.clientX, y: e.clientY };
    const dragLen = Math.hypot(end.x - start.x, end.y - start.y);
    if (dragLen < SLASH_MIN_LEN) return; // too short — not an intentional rip

    for (const s of this.strips) {
      if (isFullyTorn(s)) continue;
      const a = pointToXY(s.a),
        b = pointToXY(s.b);
      const hit = segmentCross(start, end, a, b);
      if (!hit) continue;
      void this.ripStrip(s, hit.tOnStrip);
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (this.pending) {
      this.pending = null;
      this.gPreview.replaceChildren();
    } else if (this.equipped) {
      // Disarm through the inventory so the satchel state stays in sync; the
      // adapter's onArmedChange calls back into setEquipped(null).
      this.onDisarmRequest?.();
    }
  };

  /** Set by the registry adapter so Esc can disarm the inventory. */
  onDisarmRequest: (() => void) | null = null;

  // ----- commit (optimistic, reconciled) -----
  private async commitStrip(a: EdgePoint, b: EdgePoint, type: TapeType) {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const seed = (Math.random() * 1e9) | 0;
    const optimistic: Strip = {
      id: tempId,
      type,
      a,
      b,
      seed,
      createdBy: this.playerPid,
      createdAt: new Date().toISOString(),
      rips: [],
      ripsRequired: null,
    };
    this.strips.push(optimistic);
    this.renderStrips();

    const server = await postStrip({
      url: location.href,
      type,
      a,
      b,
      seed,
      createdBy: this.playerPid,
    });
    if (this.destroyed) return;

    const idx = this.strips.findIndex((s) => s.id === tempId);
    if (idx === -1) return; // removed while in flight
    if (server) {
      this.strips[idx] = server; // swap temp id for the server record
    } else {
      this.strips.splice(idx, 1); // failure — undo the optimistic strip
    }
    this.renderStrips();
  }

  // ----- rip (optimistic, reconciled) -----
  private async ripStrip(strip: Strip, pos: number) {
    // snapshot rips-required at the first rip (locks provisional vs set)
    if (strip.ripsRequired === null) {
      const standing = this.strips.filter((s) => !isFullyTorn(s)).length;
      strip.ripsRequired = standing >= SET_THRESHOLD ? SET_THRESHOLD : 1;
    }
    strip.rips.push({ by: this.playerPid, at: Date.now(), pos });
    this.renderStrips();

    // Temp (not-yet-persisted) strips have no server id to rip against; the rip
    // rides along when the strip's commit reconciles.
    if (strip.id.startsWith("temp-")) return;

    const server = await postRip({
      url: location.href,
      stripId: strip.id,
      by: this.playerPid,
      pos,
    });
    if (this.destroyed) return;
    if (!server) return; // keep the optimistic rip; a broken fetch shouldn't undo intent

    const idx = this.strips.findIndex((s) => s.id === server.id);
    if (idx === -1) return;
    this.strips[idx] = server; // reconcile with the authoritative rip set
    this.renderStrips();
  }

  private onResize = () => {
    this.renderEdges();
    this.renderStrips();
  };

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.previewRaf) cancelAnimationFrame(this.previewRaf);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("click", this.onClick, true);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("dragstart", this.onDragStart);
    window.removeEventListener("resize", this.onResize);
    document.body.style.userSelect = "";
    this.host?.remove();
    this.host = null;
    this.overlay = null;
  }
}
