// ABOUTME: Shared bits for the sealing ceremony — the card dimensions, slot fissure DOM (the thin dark
// ABOUTME: seam that opens then closes as the packet tucks in), the ceremony's prop contract, and eases.

import type { BottleNote } from "../../features/BottleManager";

export interface SealingProps {
  text: string;
  authorColor: string;
  slotX: number;
  slotY: number;
  /** Segment style preset id — carried through from the stamped letter. */
  styleId?: string;
  /** The bottle's existing notes (oldest first). Folded down onto the new note
   * during the ceremony. */
  notes?: BottleNote[];
  /** The newly stamped letter as a note. It is the packet's face — the sheet the
   * earlier notes fold onto — so the fresh stamp reads through the fold. */
  newNote?: BottleNote;
  /** The container the overlay + ceremony portal into. The ceremony renders the
   * real letter segments within it so fonts + styling match the scroll. */
  portalContainer?: Element | null;
  /** Fires once the ceremony has mounted and painted its first frame. The parent
   * hides the DOM scroll on this signal so the fold strip takes over in place
   * with no jump. */
  onFirstFrame?: () => void;
  onComplete: () => void;
}

// Card target dimensions (matches the on-page mb-capsule visible portion). The
// packet shrinks toward this footprint as it tucks into the slot.
export const CARD_W_PX = 32;
export const CARD_H_PX = 64;

// Fissure close duration — how long the slot seam takes to draw back shut after
// the packet has sunk through it.
export const T_FISSURE_CLOSE = 700;

// ============================
// Slot fissure (CSS — structural, no color). A thin dark seam at the slot that
// opens as the packet arrives and draws shut behind it.
// ============================
export function createSlotFissure(
  container: HTMLElement,
  slotX: number,
  slotY: number,
): {
  open: () => void;
  close: () => void;
  dispose: () => void;
} {
  const fissureBaseW = Math.max(CARD_W_PX * 2.4, 80);
  const fissure = document.createElement("div");
  fissure.style.cssText = [
    "position:fixed",
    `left:${slotX}px`,
    `top:${slotY}px`,
    "transform:translate(-50%, -50%) scaleY(0)",
    `width:${fissureBaseW}px`,
    "height:3px",
    "background:linear-gradient(to right,transparent 0%,rgba(20,15,10,0.06) 12%,rgba(20,15,10,0.62) 38%,rgba(20,15,10,0.78) 50%,rgba(20,15,10,0.62) 62%,rgba(20,15,10,0.06) 88%,transparent 100%)",
    "filter:blur(0.4px)",
    "opacity:0",
    "pointer-events:none",
    "z-index:5",
    "transform-origin:center center",
    "transition:transform 350ms cubic-bezier(0.4,0,0.6,1), opacity 350ms ease-out",
  ].join(";");
  container.appendChild(fissure);

  return {
    open() {
      fissure.style.opacity = "1";
      fissure.style.transform = "translate(-50%, -50%) scaleY(1.6)";
    },
    close() {
      fissure.style.transition = `transform ${T_FISSURE_CLOSE}ms cubic-bezier(0.6,0,0.4,1), opacity ${T_FISSURE_CLOSE}ms ease-in`;
      fissure.style.transform = "translate(-50%, -50%) scaleY(0)";
      fissure.style.opacity = "0";
    },
    dispose() {
      if (fissure.parentNode) fissure.parentNode.removeChild(fissure);
    },
  };
}

// ============================
// Slot cover — a fixed pane pinned along the slot line, covering everything
// BELOW it. Painted above the plunging card (appended after it) but tinted to
// match the overlay scrim, so as the card descends the part that crosses the
// slot line is swallowed — it reads as sinking THROUGH the hole, bottom first,
// instead of just travelling down past the slot on top of the backdrop.
// ============================
export function createSlotCover(
  container: HTMLElement,
  slotX: number,
  slotY: number,
  cardH: number,
): { dispose: () => void } {
  // A small pocket at the slot, only as wide as the card's sink path and only
  // as tall as the card's descent (plus margin) — not a slab across the page.
  // Its sides and bottom fade out so it reads as a soft shadowed pocket the card
  // sinks into rather than a hard box, and its top edge sits on the slot line.
  const coverW = Math.max(CARD_W_PX * 3, 120);
  const coverH = Math.round(cardH * 1.5 + 24);
  const cover = document.createElement("div");
  cover.style.cssText = [
    "position:fixed",
    `left:${slotX}px`,
    `top:${slotY}px`,
    "transform:translateX(-50%)",
    `width:${coverW}px`,
    `height:${coverH}px`,
    // Match the .mb-overlay backdrop tint so, over the ceremony scrim, the pocket
    // reads as the same ground the card sinks into and the card vanishes as it
    // crosses in. Radial fade keeps the edges soft (no boxy seam).
    "background:radial-gradient(ellipse 60% 90% at 50% 0%,rgba(20,16,12,0.72) 0%,rgba(20,16,12,0.55) 45%,transparent 78%)",
    "pointer-events:none",
    // Above the plunging card within the ceremony container.
    "z-index:6",
  ].join(";");
  container.appendChild(cover);
  return {
    dispose() {
      if (cover.parentNode) cover.parentNode.removeChild(cover);
    },
  };
}

// ============================
// Eases
// ============================
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
export function easeInQuad(t: number): number {
  return t * t;
}
export function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}
