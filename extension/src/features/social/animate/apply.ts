// ABOUTME: Turns a picked element into a real playhtml element for the chosen offer, and undoes it.
// ABOUTME: Lives in WWO's own room, so only visitors with the extension see or change it.

import { OFFER_BY_ID, type OfferId } from "./offers";
import type { ElementRef } from "./element";

export interface AnimationRecord {
  key: string;
  ref: ElementRef;
  offer: OfferId;
  /** What the model (or person) called it, e.g. "desk lamp". */
  thing: string;
  by: string;
  color: string;
  at: number;
  /** Which model suggested it, or "picked by hand". */
  source: string;
}

interface Applied {
  record: AnimationRecord;
  element: HTMLElement;
  prevStyle: string | null;
  prevId: string;
  badge?: HTMLElement;
}

export const ANIMATE_CSS = `
[data-wwo-anim] { transition: filter .35s ease, transform .35s ease, background-color .35s ease; }
[data-wwo-anim="switch"].clicked { filter: brightness(.32) saturate(.4) !important; }
[data-wwo-anim="flip"].clicked { transform: scaleX(-1) !important; }
[data-wwo-anim="mark"].clicked { background-color: rgba(255, 224, 102, .7) !important; }
[data-wwo-anim="count"], [data-wwo-anim="wear"], [data-wwo-anim="switch"], [data-wwo-anim="flip"], [data-wwo-anim="mark"], [data-wwo-anim="grow"] { cursor: pointer; }
.wwo-anim-badge {
  position: absolute; z-index: 2147483000; pointer-events: none;
  font: 600 11px/1 ui-monospace, Menlo, monospace; color: #15191d;
  background: #f5f7f8; border: 1px solid #59626a; border-radius: 9px;
  padding: 3px 6px; transform: translate(-50%, -50%);
}
`;

export function hashKey(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export class Animator {
  private applied = new Map<string, Applied>();
  private badgeLayer: HTMLElement | null = null;
  private onResize = () => this.placeBadges();

  constructor(
    private setupPlayElement: (el: HTMLElement) => void,
    private removePlayElement?: (el: HTMLElement) => void,
  ) {
    window.addEventListener("resize", this.onResize);
  }

  isApplied(el: Element): AnimationRecord | null {
    for (const a of this.applied.values())
      if (a.element === el) return a.record;
    return null;
  }

  has(key: string) {
    return this.applied.has(key);
  }

  keys() {
    return Array.from(this.applied.keys());
  }

  apply(element: HTMLElement, record: AnimationRecord) {
    if (this.applied.has(record.key)) return;
    const offer = OFFER_BY_ID.get(record.offer);
    if (!offer) return;
    const prev: Applied = {
      record,
      element,
      prevStyle: element.getAttribute("style"),
      prevId: element.id,
    };
    if (!element.id) element.id = `wwo-anim-${record.key}`;
    element.setAttribute("data-wwo-anim", record.offer);
    element.title = element.title || `${offer.line} (we were online)`;

    if (record.offer === "count") {
      const badge = this.makeBadge();
      prev.badge = badge;
      Object.assign(element, {
        defaultData: { count: 0 },
        onClick: (_e: MouseEvent, { data, setData }: any) =>
          setData({ count: (data?.count ?? 0) + 1 }),
        updateElement: ({ data }: any) => {
          badge.textContent = String(data?.count ?? 0);
          this.placeBadge(element, badge);
        },
      });
    } else if (record.offer === "wear") {
      Object.assign(element, {
        defaultData: { touches: 0 },
        onClick: (_e: MouseEvent, { data, setData }: any) =>
          setData({ touches: (data?.touches ?? 0) + 1 }),
        updateElement: ({ element: el, data }: any) => {
          const t = data?.touches ?? 0;
          const sepia = Math.min(t * 0.05, 0.9);
          const fade = Math.min(t * 0.012, 0.3);
          (el as HTMLElement).style.filter =
            `sepia(${sepia}) contrast(${1 - fade}) brightness(${1 + fade / 2})`;
          (el as HTMLElement).title =
            `touched ${t} time${t === 1 ? "" : "s"} (we were online)`;
        },
      });
    }
    element.setAttribute(offer.capability, "");
    this.applied.set(record.key, prev);
    this.setupPlayElement(element);
  }

  undo(key: string) {
    const a = this.applied.get(key);
    if (!a) return;
    const offer = OFFER_BY_ID.get(a.record.offer);
    try {
      this.removePlayElement?.(a.element);
    } catch {
      // Removal is best effort in this prototype.
    }
    if (offer) a.element.removeAttribute(offer.capability);
    a.element.removeAttribute("data-wwo-anim");
    a.element.classList.remove("clicked", "toggled");
    if (a.prevStyle === null) a.element.removeAttribute("style");
    else a.element.setAttribute("style", a.prevStyle);
    if (!a.prevId) a.element.removeAttribute("id");
    a.badge?.remove();
    this.applied.delete(key);
  }

  destroy() {
    for (const key of this.keys()) this.undo(key);
    window.removeEventListener("resize", this.onResize);
    this.badgeLayer?.remove();
  }

  private makeBadge(): HTMLElement {
    if (!this.badgeLayer) {
      this.badgeLayer = document.createElement("div");
      this.badgeLayer.setAttribute("data-wwo-animate-ui", "badges");
      this.badgeLayer.style.cssText =
        "position:absolute;left:0;top:0;width:0;height:0;";
      document.body.appendChild(this.badgeLayer);
    }
    const badge = document.createElement("span");
    badge.className = "wwo-anim-badge";
    badge.textContent = "0";
    this.badgeLayer.appendChild(badge);
    return badge;
  }

  private placeBadge(el: HTMLElement, badge: HTMLElement) {
    const r = el.getBoundingClientRect();
    badge.style.left = `${r.right + window.scrollX}px`;
    badge.style.top = `${r.top + window.scrollY}px`;
  }

  private placeBadges() {
    for (const a of this.applied.values())
      if (a.badge) this.placeBadge(a.element, a.badge);
  }
}
