// ABOUTME: Placement mode for the message bottle — while it's armed, a faded ghost
// ABOUTME: bottle rides the cursor and a click drops a real bottle there (opening the letter).

import browser from "webextension-polyfill";
import type { InventoryAPI } from "../inventory/types";
import { anchorFromPoint } from "../bottle-anchor";
import { pouchCount } from "../letter-pouch";
import type { BottleManager } from "../BottleManager";

const BOTTLE_ITEM_ID = "message-bottle";
const GHOST_ICON = browser.runtime.getURL("inventory/bottle.svg");

/**
 * CSS for the placement ghost. Injected once into the bottles' shadow root so
 * the ghost inherits the shadow's isolation. Kept tiny and inline (like the
 * other injected surfaces) rather than a .scss to avoid leaking onto host pages.
 */
export const BOTTLE_PLACEMENT_CSS = `
/*
 * The ghost renders bottle.svg, whose card body fills ~37% of the square SVG's
 * width and ~77% of its height (x 38-82, y 14-106 in a 120 box). The real
 * placed bottle shows a 32px-wide x 64px-tall card above the slot line
 * ($capsuleW x $visibleH in MessageBottle.scss). Sizing the ghost element to
 * 88px square makes the card render ~32px wide (88 * 44/120) x ~67px tall — a
 * match for the on-page bottle. The card bottom sits ~88% down the element, so
 * the -88% Y translate lands that bottom (the slot) at the cursor.
 */
.wwo-bottle-ghost {
  position: fixed; left: 0; top: 0; width: 88px; height: 88px;
  pointer-events: none; z-index: 2147483646;
  background-image: url("${GHOST_ICON}");
  background-size: contain; background-repeat: no-repeat; background-position: center bottom;
  opacity: 0;
  /* Position via CSS vars (set on pointermove) so the deny animation can
     compose with the cursor position instead of an inline transform clobbering it. */
  --gx: 0px; --gy: 0px;
  transform: translate(var(--gx), var(--gy)) translate(-50%, -88%);
  filter: drop-shadow(0 4px 6px rgba(60,40,15,.28));
  transition: opacity .12s ease;
}
.wwo-bottle-ghost.show { opacity: .5; }
/* refused placement (empty pouch): a brief red-tinted shake in place */
.wwo-bottle-ghost.deny {
  filter: drop-shadow(0 4px 6px rgba(60,40,15,.28)) sepia(1) saturate(6) hue-rotate(-20deg);
  animation: wwo-bottle-deny .42s ease;
}
@keyframes wwo-bottle-deny {
  0%, 100% { transform: translate(var(--gx), var(--gy)) translate(-50%, -88%); }
  25% { transform: translate(var(--gx), var(--gy)) translate(-58%, -88%); }
  75% { transform: translate(var(--gx), var(--gy)) translate(-42%, -88%); }
}
`;

/**
 * Wire the message bottle's placement mode. While the bottle is armed, a faded
 * ghost follows the cursor and clicking drops a bottle at that exact spot,
 * opening its letter immediately (then disarms). Returns a cleanup fn.
 */
export function initBottlePlacement(
  inventory: InventoryAPI,
  manager: BottleManager,
  ghostHost: Element,
): () => void {
  const ghost = document.createElement("div");
  ghost.className = "wwo-bottle-ghost";
  ghostHost.appendChild(ghost);

  let armed = false;
  let last = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  const positionGhost = (x: number, y: number) => {
    ghost.style.setProperty("--gx", `${x}px`);
    ghost.style.setProperty("--gy", `${y}px`);
  };

  const onMove = (e: PointerEvent) => {
    last = { x: e.clientX, y: e.clientY };
    positionGhost(e.clientX, e.clientY);
  };

  // Briefly flash the ghost red-tinted when a placement is refused (empty pouch).
  let denyTimer: ReturnType<typeof setTimeout> | null = null;
  const flashDenied = () => {
    ghost.classList.add("deny");
    if (denyTimer) clearTimeout(denyTimer);
    denyTimer = setTimeout(() => ghost.classList.remove("deny"), 420);
  };

  // Capture-phase click so we place the bottle before the host page's own
  // handlers act on the click (and preventDefault/stop so it doesn't also
  // follow a link or press a button underneath).
  const onClick = (e: MouseEvent) => {
    if (!armed) return;
    e.preventDefault();
    e.stopPropagation();
    // No letters to write means no bottle to seal — refuse the placement so the
    // user can't reach a write scroll they can't finish (mirrors the auto-empty
    // prompt, which also hides itself when the pouch is empty). Stay armed so
    // they can try again once a letter regrows.
    if (pouchCount() < 1) {
      flashDenied();
      return;
    }
    const anchor = anchorFromPoint(e.clientX, e.clientY);
    manager.placeAndOpen(anchor);
    inventory.disarm();
  };

  const startArmed = () => {
    if (armed) return;
    armed = true;
    positionGhost(last.x, last.y);
    ghost.classList.add("show");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("click", onClick, true);
  };

  const stopArmed = () => {
    if (!armed) return;
    armed = false;
    ghost.classList.remove("show");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("click", onClick, true);
  };

  const off = inventory.onArmedChange((tool) => {
    if (tool?.itemId === BOTTLE_ITEM_ID) startArmed();
    else stopArmed();
  });

  return () => {
    off();
    stopArmed();
    if (denyTimer) clearTimeout(denyTimer);
    ghost.remove();
  };
}
