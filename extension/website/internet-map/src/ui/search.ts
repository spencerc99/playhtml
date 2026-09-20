// ABOUTME: Name search over domains and subdomains, flying the camera to a place.
// ABOUTME: Lowercase index built once at load, so filtering never allocates per keystroke.

import { Camera, flyTo } from "../camera";
import { fmt } from "./chrome";

/**
 * One searchable place. `kind` is what the row is labelled as; `id` is the
 * caller's own handle for it, which comes back on selection so the map can
 * light the district up.
 */
export interface SearchPlace {
  name: string;
  kind: "domain" | "subdomain";
  id: number;
  x: number;
  y: number;
  /** the bundle's own radius, which is what the label layer gates a name on */
  r: number;
  visits: number;
}

export interface SearchOptions {
  cam: Camera;
  /** every domain first, then every hostname; order is the caller's tie-break */
  places: SearchPlace[];
  /**
   * How wide the place actually reads on the map, around its anchor. The
   * bundle's own radius is the spread of every page a group owns, outliers
   * included, so framing by it lands far too high over a domain whose pages
   * mostly sit in one block. The caller measures the pages instead.
   */
  spreadOf: (p: SearchPlace) => number;
  /**
   * The zoom range over which this tier of name is drawn at all. Arriving
   * somewhere you cannot read the name of defeats the point of having searched
   * for it, so the framing gives up filling the screen before it gives up the
   * label.
   */
  labelWindow: (p: SearchPlace) => [number, number];
  /** repaint after each fly frame */
  onFrame: () => void;
  /** called once the camera has arrived, to mark where we landed */
  onArrive: (p: SearchPlace) => void;
}

const MAX_RESULTS = 12;
/** how much of the viewport width a landed district should span */
const FILL_FRACTION = 0.6;

export class MapSearch {
  private input: HTMLInputElement;
  private list: HTMLElement;
  /** lowercase names, parallel to opts.places, so a keystroke allocates nothing */
  private keys: string[];
  private hits: SearchPlace[] = [];
  private cursor = -1;

  constructor(private opts: SearchOptions) {
    this.input = document.getElementById("search") as HTMLInputElement;
    this.list = document.getElementById("results")!;
    this.keys = opts.places.map((p) => p.name.toLowerCase());

    this.input.addEventListener("input", () => this.query(this.input.value));
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    this.list.addEventListener("mousedown", (e) => {
      const row = (e.target as HTMLElement).closest(".res") as HTMLElement | null;
      if (!row) return;
      e.preventDefault();
      this.choose(Number(row.dataset.i));
    });
    addEventListener("keydown", (e) => this.onGlobalKey(e));
  }

  focus() {
    this.input.focus();
    this.input.select();
  }

  /** Jump straight to the best match for a name, for ?q= on load. */
  jump(text: string) {
    const hits = this.rank(text.trim().toLowerCase(), 1);
    if (hits.length) {
      this.input.value = hits[0].name;
      this.fly(hits[0]);
    }
  }

  private onGlobalKey(e: KeyboardEvent) {
    const typing = document.activeElement === this.input;
    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this.focus();
      return;
    }
    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      this.focus();
    }
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!this.hits.length) return;
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      this.cursor = (this.cursor + d + this.hits.length) % this.hits.length;
      this.markCursor();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (this.hits.length) this.choose(Math.max(0, this.cursor));
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.input.value = "";
      this.close();
      this.input.blur();
    }
  }

  private query(text: string) {
    const t = text.trim().toLowerCase();
    if (!t) { this.close(); return; }
    this.hits = this.rank(t, MAX_RESULTS);
    this.cursor = this.hits.length ? 0 : -1;
    this.render();
  }

  /**
   * Rank by how the name matched, then by traffic.
   *
   * An exact name beats a prefix, which beats a substring anywhere else —
   * that is the order of how sure we are the person meant this place. A
   * domain outranks the hostnames under it at the same match quality, and
   * within a tier the busier place comes first.
   */
  private rank(t: string, limit: number): SearchPlace[] {
    if (!t) return [];
    const scored: { p: SearchPlace; s: number }[] = [];
    for (let i = 0; i < this.keys.length; i++) {
      const key = this.keys[i];
      const at = key.indexOf(t);
      if (at < 0) continue;
      const p = this.opts.places[i];
      const s = (key.length === t.length ? 8 : 0) + (at === 0 ? 4 : 0)
              + (p.kind === "domain" ? 2 : 0);
      scored.push({ p, s });
    }
    scored.sort((a, b) => (b.s - a.s) || (b.p.visits - a.p.visits));
    return scored.slice(0, limit).map((x) => x.p);
  }

  private render() {
    this.list.replaceChildren();
    if (!this.hits.length) {
      this.list.classList.remove("on");
      return;
    }
    for (let i = 0; i < this.hits.length; i++) {
      const h = this.hits[i];
      const row = document.createElement("div");
      row.className = "res";
      row.dataset.i = String(i);
      const b = document.createElement("b");
      b.textContent = h.name;
      const s = document.createElement("small");
      s.textContent = fmt(h.visits);
      row.append(b, s);
      this.list.appendChild(row);
    }
    this.list.classList.add("on");
    this.markCursor();
  }

  private markCursor() {
    const rows = this.list.children;
    for (let i = 0; i < rows.length; i++) rows[i].classList.toggle("on", i === this.cursor);
    (rows[this.cursor] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }

  private close() {
    this.hits = [];
    this.cursor = -1;
    this.list.replaceChildren();
    this.list.classList.remove("on");
  }

  private choose(i: number) {
    const p = this.hits[i];
    if (!p) return;
    this.input.value = p.name;
    this.close();
    this.input.blur();
    this.fly(p);
  }

  /**
   * Frame the place rather than merely centring it: the zoom is chosen so the
   * district covers FILL_FRACTION of the viewport width, clamped to the
   * camera's own limits so a single-page place does not fly into the void.
   */
  private fly(p: SearchPlace) {
    const cam = this.opts.cam;
    const span = Math.max(this.opts.spreadOf(p) * 2, 1e-6);
    const [lo, hi] = this.opts.labelWindow(p);
    const fill = Math.max(lo, Math.min(hi, (FILL_FRACTION * cam.W) / span));
    const k = Math.max(cam.kFit * 0.3, Math.min(cam.kFit * 20000, fill));
    flyTo(cam, p.x, p.y, k, this.opts.onFrame, () => this.opts.onArrive(p));
  }
}

export function searchPanelHTML() {
  return `
  <div id="search-win" class="win"><div class="body">
    <input id="search" type="text" placeholder="find a domain  /" spellcheck="false"
           autocomplete="off" autocapitalize="off" />
    <div id="results"></div>
  </div></div>`;
}
