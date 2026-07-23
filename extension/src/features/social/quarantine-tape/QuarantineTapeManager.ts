// ABOUTME: Owns quarantine-tape state, the full-viewport overlay, and the commit/rip gestures.
// ABOUTME: The local strip array is the session source of truth; the worker (via quarantine-api) is the store.

import { injectShadow } from "../../../entrypoints/content/inject-ui";
import {
  getElementVerdicts,
  getVerdict,
  postElementMark,
  postElementRip,
  postRip,
  postStrip,
} from "./quarantine-api";
import {
  buildSharedDefs,
  buildTapeGroup,
  edgeSegments,
  pointToXY,
  segmentCross,
  segmentCrossesRect,
  snapToWall,
  TYPE_STYLE,
  vh,
} from "./tape-render";
import {
  isFullyTorn,
  SET_THRESHOLD,
  type EdgePoint,
  type ElementMark,
  type Strip,
  type TapeType,
} from "./types";

const SVGNS = "http://www.w3.org/2000/svg";
const SLASH_MIN_LEN = 36; // min drag distance (px) for a rip to count — keeps it heavy/intentional
const MIN_IMAGE = 40; // px — smallest image (either side) that counts as a tape target
const TARGET_HOVER_CLASS = "wwo-qt-target-hover"; // host-page outline on the hovered image

export const QUARANTINE_TAPE_CSS = `
:host { pointer-events: none; }
.qt-overlay { position: fixed; inset: 0; width: 100vw; height: 100vh; overflow: visible; pointer-events: none; }
.qt-overlay.armed { pointer-events: auto; cursor: crosshair; }
`;

// Injected into the HOST document (not the shadow root) so the outline can reach
// the page's own <img> elements. The armed tape type sets --qt-target-color.
const TARGET_HOVER_CSS = `
.${TARGET_HOVER_CLASS} {
  outline: 3px dashed var(--qt-target-color, #f0a92b) !important;
  outline-offset: 3px;
}
`;

export class QuarantineTapeManager {
  private readonly playerPid: string;

  private host: HTMLElement | null = null;
  private overlay: SVGSVGElement | null = null;
  private defs!: SVGDefsElement;
  private gEdges!: SVGGElement;
  private gStrips!: SVGGElement;
  private gElements!: SVGGElement;
  private gPreview!: SVGGElement;
  private gSlash!: SVGGElement;
  private targetStyle: HTMLStyleElement | null = null;

  private strips: Strip[] = [];
  private elementMarks: ElementMark[] = [];

  // arming
  private equipped: TapeType | null = null;
  // commit gesture
  private pending: EdgePoint | null = null;
  private cursor = { x: 0, y: 0 };
  private previewRaf = 0;
  // rip gesture
  private slashStart: { x: number; y: number } | null = null;
  // element-tape gesture (drag across a hovered image)
  private hoverTarget: HTMLImageElement | null = null;
  private elementDragStart: { x: number; y: number; img: HTMLImageElement } | null = null;
  private elementPreviewRaf = 0;
  private scrollRaf = 0;

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
    this.gElements = document.createElementNS(SVGNS, "g"); // tape over specific images
    this.gPreview = document.createElementNS(SVGNS, "g");
    this.gSlash = document.createElementNS(SVGNS, "g");
    overlay.append(this.gEdges, this.gStrips, this.gElements, this.gPreview, this.gSlash);

    // The hover outline decorates the host page's own <img> elements, so its CSS
    // must live in the host document — the overlay's styles are trapped in the
    // shadow root and can't reach them.
    const targetStyle = document.createElement("style");
    targetStyle.textContent = TARGET_HOVER_CSS;
    document.head.appendChild(targetStyle);
    this.targetStyle = targetStyle;

    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("click", this.onClick, true);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("dragstart", this.onDragStart);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("scroll", this.onScroll, { passive: true });

    // Seed from the worker's verdict (fetched once — the worker is the store,
    // there's no live channel; the local array is the session source of truth).
    const strips = await getVerdict(location.href);
    if (this.destroyed) return () => {};
    this.strips = strips;
    this.renderStrips();

    // Element marks are keyed by image src; ask the worker about the images
    // present now (late-loading images aren't chased — kept deliberately simple).
    const srcs = Array.from(new Set(this.tapeableImages().map((img) => img.src)));
    const verdicts = await getElementVerdicts(srcs);
    if (this.destroyed) return () => {};
    this.elementMarks = Object.values(verdicts).flat();
    this.renderElementMarks();

    return () => this.destroy();
  }

  /** Called by the registry adapter when a quarantine-tape item is armed/disarmed. */
  setEquipped(type: TapeType | null) {
    if (this.equipped === type) return;
    this.equipped = type;
    this.pending = null;
    this.overlay?.classList.toggle("armed", !!type);
    this.gPreview.replaceChildren();
    if (!type) this.clearHoverTarget();
    this.renderEdges();
  }

  private ripPositions(s: { rips: { pos: number }[] }): number[] {
    return s.rips.map((r) => r.pos);
  }

  /** Every image on the page big enough to be a tape target. */
  private tapeableImages(): HTMLImageElement[] {
    return Array.from(document.querySelectorAll<HTMLImageElement>("img")).filter((img) => {
      const r = img.getBoundingClientRect();
      return r.width >= MIN_IMAGE && r.height >= MIN_IMAGE;
    });
  }

  /** The live element(s) currently showing a given artifact src. */
  private elementsForSrc(src: string): HTMLImageElement[] {
    return this.tapeableImages().filter((img) => img.src === src);
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

  /**
   * Element marks render as an X of two diagonals across the image's CURRENT
   * bounds, re-measured every render — so the tape tracks the element through
   * scroll and reflow. The verdict itself is keyed by src, not by position.
   */
  private renderElementMarks() {
    this.gElements.replaceChildren();
    const setness = Math.min(1, this.elementMarks.length / (SET_THRESHOLD + 2));
    for (const m of this.elementMarks) {
      const torn = isFullyTorn(m);
      // one verdict can paint every copy of that image on the page
      for (const el of this.elementsForSrc(m.src)) {
        const r = el.getBoundingClientRect();
        if (r.width < 10 || r.height < 10) continue;
        // skip if entirely off-screen (cheap cull)
        if (r.bottom < -200 || r.top > vh() + 200) continue;
        const opacity = torn ? 0.3 : 0.75 + setness * 0.25;
        const inset = 2;
        // an X: TL→BR and TR→BL across the element box
        const diagonals: Array<[number, number, number, number]> = [
          [r.left + inset, r.top + inset, r.right - inset, r.bottom - inset],
          [r.right - inset, r.top + inset, r.left + inset, r.bottom - inset],
        ];
        diagonals.forEach(([x1, y1, x2, y2], i) => {
          this.gElements.appendChild(
            buildTapeGroup(
              this.defs,
              x1,
              y1,
              x2,
              y2,
              m.type,
              m.seed + i * 7717,
              opacity,
              false,
              this.ripPositions(m),
              torn,
            ),
          );
        });
      }
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

  /**
   * Ghost of the X about to be taped over the dragged image. Opacity ramps with
   * drag distance and stays dashed until the drag passes the commit threshold,
   * so "not far enough yet" reads in the gesture itself.
   */
  private renderElementPreview(cx: number, cy: number) {
    if (this.elementPreviewRaf) return; // one paint per frame, like the strip preview
    this.elementPreviewRaf = requestAnimationFrame(() => {
      this.elementPreviewRaf = 0;
      this.gPreview.replaceChildren();
      const drag = this.elementDragStart;
      if (!drag || !this.equipped) return;
      const r = drag.img.getBoundingClientRect();
      const dist = Math.hypot(cx - drag.x, cy - drag.y);
      const committing = dist >= SLASH_MIN_LEN;
      const opacity = committing ? 0.62 : 0.12 + 0.4 * (dist / SLASH_MIN_LEN);
      const inset = 2;
      const diagonals: Array<[number, number, number, number]> = [
        [r.left + inset, r.top + inset, r.right - inset, r.bottom - inset],
        [r.right - inset, r.top + inset, r.left + inset, r.bottom - inset],
      ];
      for (const [i, [x1, y1, x2, y2]] of diagonals.entries()) {
        this.gPreview.appendChild(
          buildTapeGroup(
            this.defs, x1, y1, x2, y2, this.equipped, 4242 + i * 7717, opacity, !committing,
          ),
        );
      }
    });
  }

  /**
   * While armed and not mid-pull, highlight the image under the cursor as a tape
   * target. Dragging across a highlighted image tapes that element instead of
   * stringing a wall-to-wall strip.
   */
  private updateHoverTarget(e: MouseEvent) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const img =
      el instanceof HTMLImageElement && el.getBoundingClientRect().width >= MIN_IMAGE ? el : null;
    if (img === this.hoverTarget) return;
    this.hoverTarget?.classList.remove(TARGET_HOVER_CLASS);
    this.hoverTarget = img;
    if (this.hoverTarget && this.equipped) {
      this.hoverTarget.style.setProperty("--qt-target-color", TYPE_STYLE[this.equipped].base);
      this.hoverTarget.classList.add(TARGET_HOVER_CLASS);
    }
  }

  private clearHoverTarget() {
    this.hoverTarget?.classList.remove(TARGET_HOVER_CLASS);
    this.hoverTarget = null;
  }

  // ----- interaction -----
  private onMouseMove = (e: MouseEvent) => {
    this.cursor = { x: e.clientX, y: e.clientY };
    if (this.equipped && this.pending) this.renderPreview();
    // Don't re-target mid-drag — the image being taped stays the target even if
    // the cursor leaves its bounds.
    if (this.equipped && !this.pending && !this.elementDragStart) {
      this.updateHoverTarget(e);
    }

    // Dragging across an image: preview the X of tape that will land on it, so
    // the gesture reads like the wall-to-wall pull — see the tape before you
    // commit it.
    if (this.elementDragStart && this.equipped) {
      this.renderElementPreview(e.clientX, e.clientY);
      return;
    }

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
    if (this.equipped) {
      // Armed AND on a hovered image → the drag tapes that element. Armed but
      // not on an image → the click-edge commit flow (onClick) still runs.
      if (this.hoverTarget) {
        e.preventDefault(); // belt-and-braces against the native image drag
        this.elementDragStart = { x: e.clientX, y: e.clientY, img: this.hoverTarget };
        document.body.style.userSelect = "none";
      }
      return; // armed → laying tape, not ripping
    }
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
    // --- armed: drag across a hovered image tapes that element ---
    const elDrag = this.elementDragStart;
    this.elementDragStart = null;
    if (elDrag && this.equipped) {
      document.body.style.userSelect = "";
      this.gPreview.replaceChildren(); // drop the ghost X, committed or not
      const dist = Math.hypot(e.clientX - elDrag.x, e.clientY - elDrag.y);
      if (dist >= SLASH_MIN_LEN) {
        void this.commitElementMark(elDrag.img.src, this.equipped);
        this.clearHoverTarget();
      }
      return;
    }

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

    // the same slash stroke rips any standing element mark it crosses (tested
    // against the live element rect, since element tape is content-bound)
    for (const m of this.elementMarks) {
      if (isFullyTorn(m)) continue;
      const crossed = this.elementsForSrc(m.src).some((el) =>
        segmentCrossesRect(start, end, el.getBoundingClientRect()),
      );
      if (!crossed) continue;
      void this.ripElementMark(m);
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

  // ----- element mark commit (optimistic, reconciled) -----
  private async commitElementMark(src: string, type: TapeType) {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const seed = (Math.random() * 1e9) | 0;
    // First tape on an image creates the verdict; taping an already-taped image
    // adds another layer of corroboration. Same act either way.
    const optimistic: ElementMark = {
      id: tempId,
      src,
      type,
      seed,
      createdBy: this.playerPid,
      createdAt: new Date().toISOString(),
      rips: [],
      ripsRequired: null,
    };
    this.elementMarks.push(optimistic);
    this.renderElementMarks();

    const server = await postElementMark({ src, type, seed, createdBy: this.playerPid });
    if (this.destroyed) return;

    const idx = this.elementMarks.findIndex((m) => m.id === tempId);
    if (idx === -1) return; // removed while in flight
    if (server) {
      this.elementMarks[idx] = server; // swap temp id for the server record
    } else {
      this.elementMarks.splice(idx, 1); // failure — undo the optimistic mark
    }
    this.renderElementMarks();
  }

  // ----- element mark rip (optimistic, reconciled) -----
  private async ripElementMark(mark: ElementMark) {
    // snapshot rips-required at the first rip, from the standing layers on this src
    if (mark.ripsRequired === null) {
      const layers = this.elementMarks.filter(
        (m) => m.src === mark.src && !isFullyTorn(m),
      ).length;
      mark.ripsRequired = layers >= SET_THRESHOLD ? SET_THRESHOLD : 1;
    }
    const pos = 0.5;
    mark.rips.push({ by: this.playerPid, at: Date.now(), pos });
    this.renderElementMarks();

    // Temp (not-yet-persisted) marks have no server id; the rip rides along when
    // the mark's commit reconciles.
    if (mark.id.startsWith("temp-")) return;

    const server = await postElementRip({
      src: mark.src,
      markId: mark.id,
      by: this.playerPid,
      pos,
    });
    if (this.destroyed) return;
    if (!server) return; // keep the optimistic rip; a broken fetch shouldn't undo intent

    const idx = this.elementMarks.findIndex((m) => m.id === server.id);
    if (idx === -1) return;
    this.elementMarks[idx] = server; // reconcile with the authoritative rip set
    this.renderElementMarks();
  }

  private onResize = () => {
    this.renderEdges();
    this.renderStrips();
    this.renderElementMarks();
  };

  // Element tape is bound to content, so it must follow the page as it scrolls.
  private onScroll = () => {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.renderElementMarks();
    });
  };

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.previewRaf) cancelAnimationFrame(this.previewRaf);
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    if (this.elementPreviewRaf) cancelAnimationFrame(this.elementPreviewRaf);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("click", this.onClick, true);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("dragstart", this.onDragStart);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("scroll", this.onScroll);
    this.clearHoverTarget();
    document.body.style.userSelect = "";
    this.targetStyle?.remove();
    this.targetStyle = null;
    this.host?.remove();
    this.host = null;
    this.overlay = null;
  }
}
