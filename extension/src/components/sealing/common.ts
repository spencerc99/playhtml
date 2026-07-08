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
