// ABOUTME: Renders locally stored page cuts as two displaced, clipped DOM clones.
// ABOUTME: Leaves the original element in layout but hidden so the page keeps its geometry.

import type { CutRecord } from "./CutStore";
import { cutRectangle, polygonClipPath, type Point } from "./geometry";

interface RenderedCut {
  target: HTMLElement;
  effect: HTMLDivElement;
}

const EFFECT_ATTRIBUTE = "data-wwo-scissors-effect";

function copyComputedTree(source: HTMLElement, clone: HTMLElement): void {
  const sourceElements = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const cloneElements = [clone, ...clone.querySelectorAll<HTMLElement>("*")];

  for (let elementIndex = 0; elementIndex < sourceElements.length; elementIndex += 1) {
    const sourceElement = sourceElements[elementIndex];
    const cloneElement = cloneElements[elementIndex];
    if (!cloneElement) break;

    const computed = window.getComputedStyle(sourceElement);
    for (let propertyIndex = 0; propertyIndex < computed.length; propertyIndex += 1) {
      const property = computed[propertyIndex];
      cloneElement.style.setProperty(
        property,
        computed.getPropertyValue(property),
        computed.getPropertyPriority(property),
      );
    }
  }
}

function removeDocumentIdentity(element: HTMLElement): void {
  element.removeAttribute("id");
  for (const descendant of element.querySelectorAll<HTMLElement>("[id]")) {
    descendant.removeAttribute("id");
  }
}

function positionEffect(effect: HTMLElement, target: HTMLElement): DOMRect {
  const rect = target.getBoundingClientRect();
  effect.style.left = `${rect.left}px`;
  effect.style.top = `${rect.top}px`;
  effect.style.width = `${rect.width}px`;
  effect.style.height = `${rect.height}px`;
  return rect;
}

function createPiece(
  target: HTMLElement,
  polygon: Point[],
  width: number,
  height: number,
  offset: Point,
): HTMLDivElement {
  const piece = document.createElement("div");
  piece.style.cssText = [
    "position:absolute",
    "inset:0",
    `width:${width}px`,
    `height:${height}px`,
    `clip-path:${polygonClipPath(polygon, width, height)}`,
    `transform:translate(${offset.x}px, ${offset.y}px)`,
    "pointer-events:none",
  ].join(";");

  const clone = target.cloneNode(true) as HTMLElement;
  copyComputedTree(target, clone);
  removeDocumentIdentity(clone);
  clone.setAttribute("aria-hidden", "true");
  clone.inert = true;
  clone.style.setProperty("position", "absolute", "important");
  clone.style.setProperty("inset", "0", "important");
  clone.style.setProperty("width", `${width}px`, "important");
  clone.style.setProperty("height", `${height}px`, "important");
  clone.style.setProperty("min-width", "0", "important");
  clone.style.setProperty("min-height", "0", "important");
  clone.style.setProperty("max-width", "none", "important");
  clone.style.setProperty("max-height", "none", "important");
  clone.style.setProperty("margin", "0", "important");
  clone.style.setProperty("transform", "none", "important");
  clone.style.setProperty("visibility", "visible", "important");
  clone.style.setProperty("pointer-events", "none", "important");
  clone.style.setProperty("box-sizing", "border-box", "important");
  piece.appendChild(clone);
  return piece;
}

export class CutRenderer {
  private rendered: RenderedCut[] = [];
  private originalVisibility = new Map<
    HTMLElement,
    { value: string; priority: string }
  >();

  render(cuts: CutRecord[]): void {
    this.clear();

    for (const cut of cuts) {
      let target: Element | null = null;
      try {
        target = document.querySelector(cut.selector);
      } catch {
        continue;
      }
      if (!(target instanceof HTMLElement)) continue;

      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      const start = {
        x: cut.start.x * rect.width,
        y: cut.start.y * rect.height,
      };
      const end = {
        x: cut.end.x * rect.width,
        y: cut.end.y * rect.height,
      };
      const geometry = cutRectangle(rect.width, rect.height, start, end);
      if (!geometry) continue;

      const effect = document.createElement("div");
      effect.setAttribute(EFFECT_ATTRIBUTE, cut.id);
      effect.setAttribute("aria-hidden", "true");
      effect.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483600;overflow:visible;contain:layout style;";
      positionEffect(effect, target);

      const halfGap = cut.gap / 2;
      effect.append(
        createPiece(target, geometry.first, rect.width, rect.height, {
          x: geometry.normal.x * halfGap,
          y: geometry.normal.y * halfGap,
        }),
        createPiece(target, geometry.second, rect.width, rect.height, {
          x: -geometry.normal.x * halfGap,
          y: -geometry.normal.y * halfGap,
        }),
      );

      this.originalVisibility.set(target, {
        value: target.style.visibility,
        priority: target.style.getPropertyPriority("visibility"),
      });
      target.style.setProperty("visibility", "hidden", "important");
      document.body.appendChild(effect);
      this.rendered.push({ target, effect });
    }
  }

  refreshPositions(): void {
    for (const { target, effect } of this.rendered) {
      if (target.isConnected) positionEffect(effect, target);
    }
  }

  clear(): void {
    for (const { effect } of this.rendered) effect.remove();
    this.rendered = [];

    for (const [target, visibility] of this.originalVisibility) {
      if (visibility.value) {
        target.style.setProperty(
          "visibility",
          visibility.value,
          visibility.priority,
        );
      } else {
        target.style.removeProperty("visibility");
      }
    }
    this.originalVisibility.clear();
  }
}

export function isScissorsEffect(element: Element): boolean {
  return Boolean(element.closest(`[${EFFECT_ATTRIBUTE}]`));
}
