// ABOUTME: Turns the armed hammer inventory item into persistent click-to-damage interactions.
// ABOUTME: Coordinates target selection, local impact storage, rendering, undo, and cleanup.

import type { InventoryAPI } from "../inventory/types";
import { buildStructuralSelector } from "../dom-anchor";
import { isScissorsEffect } from "../scissors/CutRenderer";
import { HammerRenderer, isHammerEffect } from "./HammerRenderer";
import { HammerStore, type HammerHitRecord } from "./HammerStore";

export const HAMMER_ITEM_ID = "hammer";

const MIN_TARGET_WIDTH = 32;
const MIN_TARGET_HEIGHT = 24;
const MAX_TARGET_DESCENDANTS = 240;
const EXTENSION_HOST_SELECTOR =
  '[id^="we-were-online"], [id^="wewere-"], [id^="playhtml-historical-overlay"]';

function hasUsableSize(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.width >= MIN_TARGET_WIDTH &&
    rect.height >= MIN_TARGET_HEIGHT &&
    rect.width <= window.innerWidth * 1.25 &&
    rect.height <= window.innerHeight * 1.25 &&
    element.querySelectorAll("*").length <= MAX_TARGET_DESCENDANTS
  );
}

export function findHammerTarget(start: EventTarget | null): HTMLElement | null {
  let current = start instanceof Element ? start : null;
  const explicitTarget = current?.closest<HTMLElement>("[data-wwo-hammer-target]");
  if (explicitTarget && hasUsableSize(explicitTarget)) return explicitTarget;

  while (current && current !== document.body && current !== document.documentElement) {
    if (
      current instanceof HTMLElement &&
      !current.matches("script, style, iframe, canvas, video") &&
      !current.closest(EXTENSION_HOST_SELECTOR) &&
      !isScissorsEffect(current) &&
      !isHammerEffect(current) &&
      hasUsableSize(current)
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function createHitId(): string {
  const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  return `hit-${Date.now()}-${random}`;
}

function stopPageInteraction(event: Event): void {
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
}

export class HammerController {
  private store = new HammerStore(window.location.href);
  private renderer = new HammerRenderer();
  private enabled = false;
  private offArmed: (() => void) | null = null;
  private cursorStyle: HTMLStyleElement | null = null;
  private suppressClickUntil = 0;

  constructor(private inventory: InventoryAPI) {}

  async init(): Promise<void> {
    this.renderer.render(await this.store.load());
    this.offArmed = this.inventory.onArmedChange((armed) => {
      this.setEnabled(armed?.itemId === HAMMER_ITEM_ID);
    });
    this.setEnabled(this.inventory.getArmed()?.itemId === HAMMER_ITEM_ID);

    window.addEventListener("pointerdown", this.onPointerDown, true);
    window.addEventListener("click", this.onClick, true);
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("scroll", this.onScroll, true);
    window.addEventListener("resize", this.onLayoutChange);
    window.addEventListener("load", this.onLayoutChange);
  }

  destroy(): void {
    this.setEnabled(false);
    this.offArmed?.();
    this.offArmed = null;
    window.removeEventListener("pointerdown", this.onPointerDown, true);
    window.removeEventListener("click", this.onClick, true);
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("resize", this.onLayoutChange);
    window.removeEventListener("load", this.onLayoutChange);
    this.renderer.clear();
  }

  private setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.cursorStyle?.remove();
    this.cursorStyle = null;
    document.documentElement.classList.toggle("wwo-hammer-armed", enabled);
    if (!enabled) return;

    const style = document.createElement("style");
    style.textContent =
      "html.wwo-hammer-armed, html.wwo-hammer-armed * { cursor: cell !important; }";
    document.head.appendChild(style);
    this.cursorStyle = style;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0) return;
    const target = findHammerTarget(event.target);
    if (!target) return;
    const selector = buildStructuralSelector(target);
    if (!selector) return;
    const rect = target.getBoundingClientRect();
    const hit: HammerHitRecord = {
      id: createHitId(),
      selector,
      point: {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      },
      createdAt: Date.now(),
    };
    this.suppressClickUntil = performance.now() + 500;
    stopPageInteraction(event);
    window.dispatchEvent(
      new CustomEvent("wwo:inventory-strike", {
        detail: { itemId: HAMMER_ITEM_ID, motion: "swing" },
      }),
    );
    void this.store
      .put(hit)
      .then((hits) => this.renderer.render(hits, hit.id))
      .catch((error) => {
        console.error("[we-were-online] hammer impact failed:", error);
      });
  };

  private onClick = (event: MouseEvent): void => {
    if (this.enabled && performance.now() < this.suppressClickUntil) {
      stopPageInteraction(event);
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    const undoShortcut =
      event.key === "Delete" ||
      event.key === "Backspace" ||
      ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z");
    if (!undoShortcut) return;
    stopPageInteraction(event);
    void this.store
      .removeLatest()
      .then((hits) => this.renderer.render(hits))
      .catch((error) => {
        console.error("[we-were-online] hammer undo failed:", error);
      });
  };

  private onScroll = (): void => {
    this.renderer.refreshPositions();
  };

  private onLayoutChange = (): void => {
    this.renderer.render(this.store.list());
  };
}
