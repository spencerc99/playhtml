// ABOUTME: Turns the armed scissors inventory item into a drag-to-cut interaction on host-page elements.
// ABOUTME: Coordinates the isolated gesture guide, local persistence, DOM rendering, undo, and cleanup.

import { injectShadow } from "../../entrypoints/content/inject-ui";
import type { InventoryAPI } from "../inventory/types";
import { buildStructuralSelector } from "../dom-anchor";
import { CutRenderer, isScissorsEffect } from "./CutRenderer";
import { CutStore, type CutRecord } from "./CutStore";
import { cutRectangle, type CutStyle, type Point } from "./geometry";

export const SCISSORS_ITEM_ID = "scissors";

const MIN_GESTURE_LENGTH = 24;
const MIN_TARGET_WIDTH = 56;
const MIN_TARGET_HEIGHT = 24;
const MAX_TARGET_DESCENDANTS = 200;
const CUT_GAPS: Record<CutStyle, number> = {
  paper: 30,
  cloth: 26,
  pixel: 24,
};
const EXTENSION_HOST_SELECTOR =
  '[id^="we-were-online"], [id^="wewere-"], [id^="playhtml-historical-overlay"]';

interface Gesture {
  pointerId: number;
  target: HTMLElement;
  selector: string;
  rect: DOMRect;
  start: Point;
  end: Point;
}

const GUIDE_CSS = `
:host { all: initial; }
svg { position: fixed; inset: 0; width: 100vw; height: 100vh; overflow: visible; }
line.back { stroke: rgba(255,255,255,.9); stroke-width: 7; stroke-linecap: round; }
line.cut { stroke: #d14b45; stroke-width: 3; stroke-linecap: round; stroke-dasharray: 8 6; }
`;

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

export function findCutTarget(start: EventTarget | null): HTMLElement | null {
  let current = start instanceof Element ? start : null;
  const explicitTarget = current?.closest<HTMLElement>("[data-wwo-cut-target]");
  if (explicitTarget && hasUsableSize(explicitTarget)) return explicitTarget;

  while (current && current !== document.body && current !== document.documentElement) {
    if (
      current instanceof HTMLElement &&
      !current.matches("script, style, iframe, canvas, video") &&
      !current.closest(EXTENSION_HOST_SELECTOR) &&
      !isScissorsEffect(current) &&
      hasUsableSize(current)
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function cutStyleForTarget(target: HTMLElement): CutStyle {
  const style = target.closest<HTMLElement>("[data-wwo-scissors-style]")?.dataset
    .wwoScissorsStyle;
  if (style === "cloth" || style === "pixel") return style;
  return "paper";
}

function createCutId(): string {
  const randomValues = crypto.getRandomValues(new Uint32Array(2));
  const suffix = Array.from(randomValues, (value) => value.toString(36)).join(
    "-",
  );
  return `cut-${Date.now()}-${suffix}`;
}

function stopPageInteraction(event: Event): void {
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
}

export class ScissorsController {
  private store = new CutStore(window.location.href);
  private renderer = new CutRenderer();
  private gesture: Gesture | null = null;
  private enabled = false;
  private guideHost: HTMLElement | null = null;
  private guideLines: SVGLineElement[] = [];
  private cursorStyle: HTMLStyleElement | null = null;
  private offArmed: (() => void) | null = null;

  constructor(private inventory: InventoryAPI) {}

  async init(): Promise<void> {
    const cuts = await this.store.load();
    this.renderer.render(cuts);
    this.mountGuide();

    this.offArmed = this.inventory.onArmedChange((armed) => {
      this.setEnabled(armed?.itemId === SCISSORS_ITEM_ID);
    });
    this.setEnabled(this.inventory.getArmed()?.itemId === SCISSORS_ITEM_ID);

    window.addEventListener("pointerdown", this.onPointerDown, true);
    window.addEventListener("pointermove", this.onPointerMove, true);
    window.addEventListener("pointerup", this.onPointerUp, true);
    window.addEventListener("pointercancel", this.onPointerCancel, true);
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
    window.removeEventListener("pointermove", this.onPointerMove, true);
    window.removeEventListener("pointerup", this.onPointerUp, true);
    window.removeEventListener("pointercancel", this.onPointerCancel, true);
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("resize", this.onLayoutChange);
    window.removeEventListener("load", this.onLayoutChange);
    this.renderer.clear();
    this.guideHost?.remove();
    this.guideHost = null;
    this.cursorStyle?.remove();
    this.cursorStyle = null;
  }

  private mountGuide(): void {
    const { host, shadow } = injectShadow({
      hostId: "we-were-online-scissors",
      hostStyle:
        "position:fixed;inset:0;pointer-events:none;z-index:2147483644;",
      css: GUIDE_CSS,
    });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const back = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const cut = document.createElementNS("http://www.w3.org/2000/svg", "line");
    back.classList.add("back");
    cut.classList.add("cut");
    svg.style.display = "none";
    svg.append(back, cut);
    shadow.appendChild(svg);
    this.guideHost = host;
    this.guideLines = [back, cut];
  }

  private setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.gesture = null;
      this.hideGuide();
      document.documentElement.classList.remove("wwo-scissors-armed");
      this.cursorStyle?.remove();
      this.cursorStyle = null;
      return;
    }

    document.documentElement.classList.add("wwo-scissors-armed");
    const style = document.createElement("style");
    style.textContent =
      "html.wwo-scissors-armed, html.wwo-scissors-armed * { cursor: crosshair !important; }";
    document.head.appendChild(style);
    this.cursorStyle = style;
  }

  private showGuide(gesture: Gesture): void {
    const svg = this.guideLines[0]?.ownerSVGElement;
    if (!svg) return;
    svg.style.display = "block";
    for (const line of this.guideLines) {
      line.setAttribute("x1", `${gesture.start.x}`);
      line.setAttribute("y1", `${gesture.start.y}`);
      line.setAttribute("x2", `${gesture.end.x}`);
      line.setAttribute("y2", `${gesture.end.y}`);
    }
  }

  private hideGuide(): void {
    const svg = this.guideLines[0]?.ownerSVGElement;
    if (svg) svg.style.display = "none";
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0 || this.gesture) return;
    const target = findCutTarget(event.target);
    if (!target) return;
    const selector = buildStructuralSelector(target);
    if (!selector) return;

    const rect = target.getBoundingClientRect();
    this.gesture = {
      pointerId: event.pointerId,
      target,
      selector,
      rect,
      start: { x: event.clientX, y: event.clientY },
      end: { x: event.clientX, y: event.clientY },
    };
    this.showGuide(this.gesture);
    stopPageInteraction(event);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
    this.gesture.end = { x: event.clientX, y: event.clientY };
    this.showGuide(this.gesture);
    stopPageInteraction(event);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
    stopPageInteraction(event);
    void this.finishGesture(event).catch((error) => {
      console.error("[we-were-online] scissors cut failed:", error);
    });
  };

  private async finishGesture(event: PointerEvent): Promise<void> {
    const gesture = this.gesture;
    this.gesture = null;
    this.hideGuide();
    if (!gesture || !gesture.target.isConnected) return;

    gesture.end = { x: event.clientX, y: event.clientY };
    const distance = Math.hypot(
      gesture.end.x - gesture.start.x,
      gesture.end.y - gesture.start.y,
    );
    if (distance < MIN_GESTURE_LENGTH) return;

    const localStart = {
      x: gesture.start.x - gesture.rect.left,
      y: gesture.start.y - gesture.rect.top,
    };
    const localEnd = {
      x: gesture.end.x - gesture.rect.left,
      y: gesture.end.y - gesture.rect.top,
    };
    if (
      !cutRectangle(
        gesture.rect.width,
        gesture.rect.height,
        localStart,
        localEnd,
      )
    ) {
      return;
    }

    const style = cutStyleForTarget(gesture.target);
    const record: CutRecord = {
      id: createCutId(),
      selector: gesture.selector,
      start: {
        x: localStart.x / gesture.rect.width,
        y: localStart.y / gesture.rect.height,
      },
      end: {
        x: localEnd.x / gesture.rect.width,
        y: localEnd.y / gesture.rect.height,
      },
      style,
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
      gap: CUT_GAPS[style],
      createdAt: Date.now(),
    };
    window.dispatchEvent(
      new CustomEvent("wwo:inventory-strike", {
        detail: { itemId: SCISSORS_ITEM_ID, motion: "snip" },
      }),
    );
    const cuts = await this.store.put(record);
    this.renderer.render(cuts);
  }

  private onPointerCancel = (event: PointerEvent): void => {
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
    this.gesture = null;
    this.hideGuide();
    stopPageInteraction(event);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || this.gesture) return;
    const undoShortcut =
      event.key === "Delete" ||
      event.key === "Backspace" ||
      ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z");
    if (!undoShortcut) return;
    stopPageInteraction(event);
    void this.undoLatest().catch((error) => {
      console.error("[we-were-online] scissors undo failed:", error);
    });
  };

  private async undoLatest(): Promise<void> {
    const cuts = await this.store.removeLatest();
    this.renderer.render(cuts);
  }

  private onScroll = (): void => {
    this.renderer.refreshPositions();
  };

  private onLayoutChange = (): void => {
    this.renderer.render(this.store.list());
  };
}
