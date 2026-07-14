// ABOUTME: Renders locally stored page cuts as two displaced, clipped DOM clones.
// ABOUTME: Leaves the original element in layout but hidden so the page keeps its geometry.

import type { CutRecord } from "./CutStore";
import {
  polygonClipPath,
  tearRectangle,
  type CutStyle,
  type Point,
} from "./geometry";

interface RenderedCut {
  target: HTMLElement;
  effect: HTMLDivElement;
  tear: Point[];
  normal: Point;
  width: number;
  height: number;
  gap: number;
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
  style: CutStyle,
  side: 1 | -1,
): HTMLDivElement {
  const piece = document.createElement("div");
  piece.setAttribute("data-wwo-scissors-piece", style);
  const rotation = style === "paper" ? side * 0.7 : 0;
  const baseTransform = `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg)`;
  piece.style.cssText = [
    "position:absolute",
    "inset:0",
    `width:${width}px`,
    `height:${height}px`,
    `clip-path:${polygonClipPath(polygon, width, height)}`,
    `transform:${baseTransform}`,
    `transform-origin:${side === 1 ? "100% 50%" : "0% 50%"}`,
    "backface-visibility:hidden",
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

  if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    if (style === "cloth") {
      piece.animate?.(
        [
          { transform: `${baseTransform} rotateX(0deg) translateY(0)` },
          {
            transform: `${baseTransform} rotateX(${side * 5}deg) rotateZ(${side * 0.8}deg) translateY(${side * 2}px)`,
          },
        ],
        {
          duration: side === 1 ? 2100 : 2600,
          direction: "alternate",
          easing: "ease-in-out",
          iterations: Infinity,
        },
      );
    } else if (style === "pixel") {
      piece.animate?.(
        [
          { transform: baseTransform },
          { transform: `${baseTransform} translate(${side * 2}px, ${-side * 2}px)` },
        ],
        {
          duration: 900,
          direction: "alternate",
          easing: "steps(2, end)",
          iterations: Infinity,
        },
      );
    } else {
      piece.animate?.(
        [
          { transform: `translate(${offset.x * 0.2}px, ${offset.y * 0.2}px)` },
          { transform: baseTransform },
        ],
        { duration: 520, easing: "cubic-bezier(.2,.85,.25,1.15)" },
      );
    }
  }
  return piece;
}

function createTearEdge(
  tear: Point[],
  width: number,
  height: number,
  offset: Point,
  style: CutStyle,
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("data-wwo-scissors-edge", style);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.cssText = [
    "position:absolute",
    "inset:0",
    `width:${width}px`,
    `height:${height}px`,
    "overflow:visible",
    `transform:translate(${offset.x}px, ${offset.y}px)`,
    "pointer-events:none",
  ].join(";");

  const points = tear.map((point) => `${point.x},${point.y}`).join(" ");
  const shadow = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  shadow.setAttribute("points", points);
  shadow.setAttribute("fill", "none");
  shadow.setAttribute("stroke", style === "pixel" ? "rgba(10,10,10,.72)" : "rgba(55,38,26,.28)");
  shadow.setAttribute("stroke-width", style === "pixel" ? "2" : "5");
  shadow.setAttribute("stroke-linejoin", style === "pixel" ? "miter" : "round");

  const fiber = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  fiber.setAttribute("points", points);
  fiber.setAttribute("fill", "none");
  fiber.setAttribute(
    "stroke",
    style === "cloth" ? "rgba(255,250,238,.95)" : "rgba(255,255,255,.88)",
  );
  fiber.setAttribute("stroke-width", style === "pixel" ? "1" : "2.5");
  fiber.setAttribute("stroke-linecap", style === "pixel" ? "square" : "round");
  if (style !== "pixel") fiber.setAttribute("stroke-dasharray", style === "cloth" ? "2 3" : "1 4");
  svg.append(shadow, fiber);
  return svg;
}

function createBlackHole(
  tear: Point[],
  normal: Point,
  width: number,
  height: number,
  gap: number,
): HTMLDivElement {
  const halfWidth = gap / 2 + 5;
  const band = [
    ...tear.map((point) => ({
      x: point.x + normal.x * halfWidth,
      y: point.y + normal.y * halfWidth,
    })),
    ...[...tear].reverse().map((point) => ({
      x: point.x - normal.x * halfWidth,
      y: point.y - normal.y * halfWidth,
    })),
  ];
  const hole = document.createElement("div");
  hole.setAttribute("data-wwo-scissors-hole", "");
  hole.style.cssText = [
    "position:absolute",
    "inset:0",
    `width:${width}px`,
    `height:${height}px`,
    `clip-path:${polygonClipPath(band, width, height)}`,
    "background:radial-gradient(ellipse at center,#050505 0%,#000 72%,#16100d 100%)",
    "box-shadow:inset 0 0 10px rgba(0,0,0,.9)",
    "pointer-events:none",
  ].join(";");
  return hole;
}

function exposesPageRoot(
  target: HTMLElement,
  rect: DOMRect,
  tear: Point[],
): boolean | null {
  if (typeof document.elementFromPoint !== "function") return false;
  const midpoint = tear[Math.floor(tear.length / 2)];
  const x = rect.left + midpoint.x;
  const y = rect.top + midpoint.y;
  if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) {
    return null;
  }
  const underneath =
    typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(x, y)
      : [document.elementFromPoint(x, y)].filter((element): element is Element => Boolean(element));

  for (const element of underneath) {
    if (element === target || target.contains(element)) continue;
    if (element === document.body || element === document.documentElement) {
      return true;
    }
    if (element instanceof HTMLElement && element.contains(target)) {
      const computed = window.getComputedStyle(element);
      const transparent =
        computed.backgroundColor === "transparent" ||
        computed.backgroundColor === "rgba(0, 0, 0, 0)";
      if (transparent && computed.backgroundImage === "none") continue;
    }
    return false;
  }
  return true;
}

function syncBlackHole(rendered: RenderedCut, rect: DOMRect): void {
  if (rendered.effect.hasAttribute("data-wwo-scissors-hole-checked")) return;
  const exposesRoot = exposesPageRoot(rendered.target, rect, rendered.tear);
  if (exposesRoot === null) return;
  rendered.effect.setAttribute("data-wwo-scissors-hole-checked", "");
  if (!exposesRoot) return;
  rendered.effect.prepend(
    createBlackHole(
      rendered.tear,
      rendered.normal,
      rendered.width,
      rendered.height,
      rendered.gap,
    ),
  );
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
      const geometry = tearRectangle(
        rect.width,
        rect.height,
        start,
        end,
        cut.style,
        cut.seed,
      );
      if (!geometry) continue;

      const effect = document.createElement("div");
      effect.setAttribute(EFFECT_ATTRIBUTE, cut.id);
      effect.setAttribute("data-wwo-scissors-style", cut.style);
      effect.setAttribute("aria-hidden", "true");
      effect.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483600;overflow:visible;contain:layout style;perspective:700px;";
      positionEffect(effect, target);

      const halfGap = cut.gap / 2;
      const firstOffset = {
          x: geometry.normal.x * halfGap,
          y: geometry.normal.y * halfGap,
      };
      const secondOffset = {
          x: -geometry.normal.x * halfGap,
          y: -geometry.normal.y * halfGap,
      };
      const firstPiece = createPiece(
        target,
        geometry.first,
        rect.width,
        rect.height,
        firstOffset,
        cut.style,
        1,
      );
      const secondPiece = createPiece(
        target,
        geometry.second,
        rect.width,
        rect.height,
        secondOffset,
        cut.style,
        -1,
      );

      this.originalVisibility.set(target, {
        value: target.style.visibility,
        priority: target.style.getPropertyPriority("visibility"),
      });
      target.style.setProperty("visibility", "hidden", "important");
      const rendered = {
        target,
        effect,
        tear: geometry.tear,
        normal: geometry.normal,
        width: rect.width,
        height: rect.height,
        gap: cut.gap,
      };
      syncBlackHole(rendered, rect);
      effect.append(
        firstPiece,
        secondPiece,
        createTearEdge(
          geometry.tear,
          rect.width,
          rect.height,
          firstOffset,
          cut.style,
        ),
        createTearEdge(
          geometry.tear,
          rect.width,
          rect.height,
          secondOffset,
          cut.style,
        ),
      );
      document.body.appendChild(effect);
      this.rendered.push(rendered);
    }
  }

  refreshPositions(): void {
    for (const rendered of this.rendered) {
      if (rendered.target.isConnected) {
        const rect = positionEffect(rendered.effect, rendered.target);
        syncBlackHole(rendered, rect);
      }
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
