// ABOUTME: Applies cumulative hammer dents to live elements and draws persistent crack overlays.
// ABOUTME: Keeps controls interactive while restoring every modified inline style on cleanup.

import type { HammerHitRecord } from "./HammerStore";

interface RenderedDamage {
  target: HTMLElement;
  effect: HTMLDivElement;
}

interface InlineProperty {
  value: string;
  priority: string;
}

type OriginalDamageStyles = Record<
  "translate" | "rotate" | "scale" | "transform-origin",
  InlineProperty
>;

const EFFECT_ATTRIBUTE = "data-wwo-hammer-effect";

function readInlineProperty(target: HTMLElement, property: string): InlineProperty {
  return {
    value: target.style.getPropertyValue(property),
    priority: target.style.getPropertyPriority(property),
  };
}

function restoreInlineProperty(
  target: HTMLElement,
  property: string,
  original: InlineProperty,
): void {
  if (original.value) {
    target.style.setProperty(property, original.value, original.priority);
  } else {
    target.style.removeProperty(property);
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

function hashId(id: string): number {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function createImpact(
  hit: HammerHitRecord,
  rect: DOMRect,
  animateImpact: boolean,
): HTMLDivElement {
  const impact = document.createElement("div");
  impact.setAttribute("data-wwo-hammer-impact", hit.id);
  const x = hit.point.x * rect.width;
  const y = hit.point.y * rect.height;
  impact.style.cssText = [
    "position:absolute",
    `left:${x}px`,
    `top:${y}px`,
    "width:1px",
    "height:1px",
    "pointer-events:none",
  ].join(";");

  const dent = document.createElement("div");
  dent.style.cssText = [
    "position:absolute",
    "left:-16px",
    "top:-16px",
    "width:32px",
    "height:32px",
    "border-radius:50%",
    "background:radial-gradient(circle,rgba(0,0,0,.38) 0 8%,rgba(255,255,255,.28) 10%,rgba(45,35,28,.22) 18%,transparent 56%)",
    "mix-blend-mode:multiply",
  ].join(";");
  impact.appendChild(dent);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "-40 -40 80 80");
  svg.style.cssText =
    "position:absolute;left:-40px;top:-40px;width:80px;height:80px;overflow:visible;";
  const random = seededRandom(hashId(hit.id));
  for (let ray = 0; ray < 7; ray += 1) {
    const angle = (ray / 7) * Math.PI * 2 + (random() - 0.5) * 0.45;
    const middleLength = 9 + random() * 8;
    const endLength = middleLength + 8 + random() * 17;
    const bend = (random() - 0.5) * 5;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      `M 0 0 L ${Math.cos(angle) * middleLength + bend} ${Math.sin(angle) * middleLength - bend} L ${Math.cos(angle) * endLength} ${Math.sin(angle) * endLength}`,
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "rgba(28,22,18,.68)");
    path.setAttribute("stroke-width", `${0.7 + random() * 0.8}`);
    path.setAttribute("stroke-linecap", "round");
    svg.appendChild(path);
  }
  impact.appendChild(svg);

  if (
    animateImpact &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    impact.animate?.(
      [
        { opacity: 0, transform: "scale(.25)" },
        { opacity: 1, transform: "scale(1.15)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 420, easing: "cubic-bezier(.2,.9,.2,1)" },
    );
  }
  return impact;
}

export class HammerRenderer {
  private rendered: RenderedDamage[] = [];
  private originalStyles = new Map<HTMLElement, OriginalDamageStyles>();

  render(hits: HammerHitRecord[], latestHitId?: string): void {
    this.clear();
    const bySelector = new Map<string, HammerHitRecord[]>();
    for (const hit of hits) {
      const existing = bySelector.get(hit.selector) ?? [];
      existing.push(hit);
      bySelector.set(hit.selector, existing);
    }

    for (const [selector, targetHits] of bySelector) {
      let target: Element | null = null;
      try {
        target = document.querySelector(selector);
      } catch {
        continue;
      }
      if (!(target instanceof HTMLElement)) continue;
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      this.originalStyles.set(target, {
        translate: readInlineProperty(target, "translate"),
        rotate: readInlineProperty(target, "rotate"),
        scale: readInlineProperty(target, "scale"),
        "transform-origin": readInlineProperty(target, "transform-origin"),
      });
      const lastHit = targetHits[targetHits.length - 1];
      const hitCount = targetHits.length;
      const horizontal = (lastHit.point.x - 0.5) * Math.min(18, hitCount * 4);
      const vertical = Math.min(12, hitCount * 2);
      const rotation = (lastHit.point.x < 0.5 ? -1 : 1) * Math.min(5, hitCount * 1.1);
      const verticalScale = Math.max(0.9, 1 - hitCount * 0.015);
      target.style.setProperty(
        "translate",
        `${horizontal}px ${vertical}px`,
        "important",
      );
      target.style.setProperty("rotate", `${rotation}deg`, "important");
      target.style.setProperty("scale", `1 ${verticalScale}`, "important");
      target.style.setProperty(
        "transform-origin",
        `${lastHit.point.x * 100}% ${lastHit.point.y * 100}%`,
        "important",
      );

      const effect = document.createElement("div");
      effect.setAttribute(EFFECT_ATTRIBUTE, selector);
      effect.setAttribute("aria-hidden", "true");
      effect.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483602;overflow:visible;contain:layout style;";
      positionEffect(effect, target);
      for (const hit of targetHits) {
        effect.appendChild(createImpact(hit, rect, hit.id === latestHitId));
      }
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
    for (const [target, styles] of this.originalStyles) {
      restoreInlineProperty(target, "translate", styles.translate);
      restoreInlineProperty(target, "rotate", styles.rotate);
      restoreInlineProperty(target, "scale", styles.scale);
      restoreInlineProperty(
        target,
        "transform-origin",
        styles["transform-origin"],
      );
    }
    this.originalStyles.clear();
  }
}

export function isHammerEffect(element: Element): boolean {
  return Boolean(element.closest(`[${EFFECT_ATTRIBUTE}]`));
}
