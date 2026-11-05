// ABOUTME: The animate picker (outline under the pointer) and the suggestion card, in a shadow root.
// ABOUTME: Nothing is applied until the person picks; "pick myself" always shows the whole menu.

import { OFFERS, OFFER_BY_ID, type OfferId } from "./offers";
import { OUR_UI_ATTR, bestTarget } from "./element";
import type { AnimationRecord } from "./apply";

const CARD_CSS = `
:host { all: initial; }
.card {
  position: absolute; z-index: 2147483600; width: 280px; box-sizing: border-box;
  background: #f5f7f8; color: #15191d; border: 1px solid #c9cfd3; border-radius: 10px;
  box-shadow: 0 6px 24px rgba(21, 25, 29, .16); padding: 12px 12px 10px;
  font: 13px/1.35 'Atkinson Hyperlegible', system-ui, sans-serif;
}
.thing { font-family: 'Source Serif 4', Georgia, serif; font-style: italic; font-size: 19px; margin: 0 0 2px; }
.meta { font: 10px/1.3 'Martian Mono', ui-monospace, Menlo, monospace; color: #59626a; margin-bottom: 10px; }
.meta button { all: unset; cursor: pointer; text-decoration: underline dotted; }
.opt {
  display: block; width: 100%; text-align: left; box-sizing: border-box; cursor: pointer;
  margin: 0 0 6px; padding: 8px 10px; border-radius: 7px; border: 1px solid #c9cfd3;
  background: #fff; color: inherit; font: inherit;
}
.opt:hover, .opt:focus-visible { border-color: var(--me, #59626a); outline: none; background: #e9ecee; }
.opt .cap { display: block; margin-top: 3px; font: 10px 'Martian Mono', ui-monospace, monospace; color: #59626a; }
.row { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
.link { all: unset; cursor: pointer; font-size: 12px; color: #59626a; text-decoration: underline; }
.note { margin-top: 8px; font-size: 11px; color: #59626a; }
.all { margin-top: 6px; }
.loading { color: #59626a; font-style: italic; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; vertical-align: -1px; margin-right: 4px; }
`;

export interface CardHandlers {
  onPick(offer: OfferId, line: string, source: "model" | "hand"): void;
  onUndo?(): void;
  onClose(): void;
  onEditModel?(): void;
}

export class AnimateUi {
  private host: HTMLElement;
  private root: ShadowRoot;
  private outline: HTMLElement;
  private hint: HTMLElement;
  private card: HTMLElement | null = null;
  private picking = false;
  private pickCb: ((el: HTMLElement) => void) | null = null;
  private hovered: HTMLElement | null = null;

  constructor(private color: string) {
    this.host = document.createElement("div");
    this.host.setAttribute(OUR_UI_ATTR, "root");
    this.host.style.cssText =
      "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483600;";
    this.root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CARD_CSS;
    this.root.appendChild(style);
    this.outline = document.createElement("div");
    this.outline.style.cssText = `position:fixed;pointer-events:none;border:2px dashed ${color};border-radius:4px;display:none;z-index:2147483500;`;
    this.hint = document.createElement("div");
    this.hint.style.cssText =
      "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#15191d;color:#f5f7f8;padding:6px 12px;border-radius:999px;font:12px 'Atkinson Hyperlegible',system-ui,sans-serif;display:none;z-index:2147483600;pointer-events:none;";
    this.hint.textContent = "pick something to animate · esc to stop";
    this.root.append(this.outline, this.hint);
    document.body.appendChild(this.host);
  }

  get isPicking() {
    return this.picking;
  }

  startPicking(cb: (el: HTMLElement) => void) {
    this.closeCard();
    this.picking = true;
    this.pickCb = cb;
    this.hint.style.display = "block";
    document.addEventListener("mousemove", this.onMove, true);
    document.addEventListener("click", this.onClick, true);
    document.addEventListener("keydown", this.onKey, true);
    document.documentElement.style.cursor = "crosshair";
  }

  stopPicking() {
    this.picking = false;
    this.pickCb = null;
    this.hint.style.display = "none";
    this.outline.style.display = "none";
    document.removeEventListener("mousemove", this.onMove, true);
    document.removeEventListener("click", this.onClick, true);
    document.removeEventListener("keydown", this.onKey, true);
    document.documentElement.style.cursor = "";
  }

  /** Outline an element (used while the card is open, too). */
  outlineEl(el: HTMLElement | null) {
    if (!el) {
      this.outline.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(this.outline.style, {
      display: "block",
      left: `${r.left - 3}px`,
      top: `${r.top - 3}px`,
      width: `${r.width + 2}px`,
      height: `${r.height + 2}px`,
    });
  }

  /** Hide everything we draw, e.g. right before a screenshot. */
  setHidden(hidden: boolean) {
    this.host.style.visibility = hidden ? "hidden" : "visible";
  }

  private onMove = (e: MouseEvent) => {
    const el = bestTarget(document.elementFromPoint(e.clientX, e.clientY));
    this.hovered = el;
    this.outlineEl(el);
  };

  private onClick = (e: MouseEvent) => {
    const el =
      bestTarget(document.elementFromPoint(e.clientX, e.clientY)) ??
      this.hovered;
    e.preventDefault();
    e.stopPropagation();
    if (!el) return;
    const cb = this.pickCb;
    this.stopPicking();
    this.outlineEl(el);
    cb?.(el);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      this.stopPicking();
    }
  };

  private place(card: HTMLElement, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, r.left + window.scrollX),
      window.scrollX + window.innerWidth - 290,
    );
    const below = r.bottom + 10 + 260 < window.innerHeight;
    const top = below
      ? r.bottom + window.scrollY + 10
      : Math.max(window.scrollY + 8, r.top + window.scrollY - 10 - 260);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  private newCard(el: HTMLElement) {
    this.closeCard(false);
    const card = document.createElement("div");
    card.className = "card";
    card.style.setProperty("--me", this.color);
    this.root.appendChild(card);
    this.place(card, el);
    this.card = card;
    document.addEventListener("keydown", this.onCardKey, true);
    return card;
  }

  private onCardKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.closeCard();
  };

  closeCard(clearOutline = true) {
    this.card?.remove();
    this.card = null;
    document.removeEventListener("keydown", this.onCardKey, true);
    if (clearOutline) this.outlineEl(null);
  }

  showLoading(el: HTMLElement) {
    const card = this.newCard(el);
    card.innerHTML = `<p class="loading">looking at it…</p>`;
  }

  showSuggestions(
    el: HTMLElement,
    opts: {
      thing: string;
      suggestions: { offer: OfferId; line: string }[];
      modelLabel: string;
      error?: string;
    },
    h: CardHandlers,
  ) {
    const card = this.newCard(el);
    const head = document.createElement("p");
    head.className = "thing";
    head.textContent = opts.error ? "pick what it does" : opts.thing;
    const meta = document.createElement("div");
    meta.className = "meta";
    const modelBtn = document.createElement("button");
    modelBtn.textContent = opts.modelLabel;
    modelBtn.title = "change which model makes suggestions";
    modelBtn.onclick = () => h.onEditModel?.();
    meta.append(opts.error ? "" : "suggested by ", modelBtn);
    card.append(head, meta);
    if (opts.error) {
      const err = document.createElement("p");
      err.className = "note";
      err.textContent = opts.error;
      card.appendChild(err);
    }
    for (const s of opts.suggestions)
      card.appendChild(
        this.optionButton(s.offer, s.line, () =>
          h.onPick(s.offer, s.line, "model"),
        ),
      );

    const all = document.createElement("div");
    all.className = "all";
    all.hidden = opts.suggestions.length > 0;
    for (const o of OFFERS) {
      if (opts.suggestions.some((s) => s.offer === o.id)) continue;
      all.appendChild(
        this.optionButton(o.id, o.line, () => h.onPick(o.id, o.line, "hand")),
      );
    }
    card.appendChild(all);

    const row = document.createElement("div");
    row.className = "row";
    const more = document.createElement("button");
    more.className = "link";
    more.textContent = all.hidden ? "something else" : "";
    more.onclick = () => {
      all.hidden = false;
      more.remove();
    };
    const cancel = document.createElement("button");
    cancel.className = "link";
    cancel.textContent = "leave it be";
    cancel.onclick = () => h.onClose();
    if (all.hidden) row.append(more);
    else row.append(document.createElement("span"));
    row.append(cancel);
    card.appendChild(row);

    const note = document.createElement("p");
    note.className = "note";
    note.textContent =
      "Only people with we were online will see it. The site stays the same for everyone else.";
    card.appendChild(note);
    (card.querySelector(".opt") as HTMLElement | null)?.focus();
  }

  showExisting(
    el: HTMLElement,
    rec: AnimationRecord,
    mine: boolean,
    h: CardHandlers,
  ) {
    const card = this.newCard(el);
    const offer = OFFER_BY_ID.get(rec.offer);
    const head = document.createElement("p");
    head.className = "thing";
    head.textContent = rec.thing;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `<span class="dot"></span>`;
    (meta.firstChild as HTMLElement).style.background = rec.color;
    meta.append(
      mine ? "you animated this" : "someone animated this",
      ` · ${new Date(rec.at).toLocaleDateString()}`,
    );
    const what = document.createElement("p");
    what.textContent = offer?.line ?? rec.offer;
    card.append(head, meta, what);
    const row = document.createElement("div");
    row.className = "row";
    if (mine && h.onUndo) {
      const undo = document.createElement("button");
      undo.className = "link";
      undo.textContent = "undo";
      undo.onclick = () => h.onUndo?.();
      row.append(undo);
    } else row.append(document.createElement("span"));
    const close = document.createElement("button");
    close.className = "link";
    close.textContent = "close";
    close.onclick = () => h.onClose();
    row.append(close);
    card.appendChild(row);
  }

  private optionButton(offer: OfferId, line: string, onClick: () => void) {
    const b = document.createElement("button");
    b.className = "opt";
    b.textContent = line;
    const cap = document.createElement("span");
    cap.className = "cap";
    cap.textContent = OFFER_BY_ID.get(offer)?.capability ?? "";
    b.appendChild(cap);
    b.onclick = onClick;
    return b;
  }

  destroy() {
    this.stopPicking();
    this.closeCard();
    this.host.remove();
  }
}
