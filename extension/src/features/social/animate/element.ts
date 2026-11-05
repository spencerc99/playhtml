// ABOUTME: Finds, describes and re-finds page elements for animate: a stable selector plus a fingerprint check.
// ABOUTME: Third-party pages give us no ids, so we rebuild the path from the nearest id'd ancestor.

import type { ElementDescription } from "./prompt";

export interface ElementRef {
  selector: string;
  /** tag + image src or text prefix, checked on re-find so a changed page doesn't animate the wrong thing. */
  fingerprint: string;
}

const UI_ATTR = "data-wwo-animate-ui";

export function isOurUi(el: Element | null): boolean {
  return !!el?.closest(`[${UI_ATTR}]`);
}
export const OUR_UI_ATTR = UI_ATTR;

function imageSrc(el: Element): string | undefined {
  const img = el instanceof HTMLImageElement ? el : el.querySelector("img");
  if (img?.currentSrc || img?.src) return img.currentSrc || img.src;
  const bg = getComputedStyle(el).backgroundImage;
  const m = bg && bg.match(/url\(["']?([^"')]+)/);
  return m?.[1];
}

export function fingerprintOf(el: Element): string {
  const src = imageSrc(el);
  if (src) {
    try {
      return `${el.tagName}|${new URL(src, location.href).pathname}`;
    } catch {
      return `${el.tagName}|${src.slice(0, 120)}`;
    }
  }
  const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
  return `${el.tagName}|${text}`;
}

const looksGenerated = (id: string) => /\d{4,}|[a-f0-9]{8,}|^:r/i.test(id);

export function selectorFor(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    if (
      node.id &&
      !looksGenerated(node.id) &&
      !node.id.startsWith("wwo-anim-")
    ) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const sameTag = Array.from(parent.children).filter(
      (c) => c.tagName === node!.tagName,
    );
    const idx = sameTag.indexOf(node) + 1;
    parts.unshift(
      sameTag.length > 1
        ? `${node.tagName.toLowerCase()}:nth-of-type(${idx})`
        : node.tagName.toLowerCase(),
    );
    node = parent;
  }
  return parts.join(" > ");
}

export function refFor(el: Element): ElementRef {
  return { selector: selectorFor(el), fingerprint: fingerprintOf(el) };
}

export function findByRef(ref: ElementRef): HTMLElement | null {
  let el: Element | null = null;
  try {
    el = document.querySelector(ref.selector);
  } catch {
    el = null;
  }
  if (el instanceof HTMLElement && fingerprintOf(el) === ref.fingerprint)
    return el;
  // The page shifted: look for the same image or text among same-tag elements.
  const tag = ref.fingerprint.split("|")[0];
  for (const cand of Array.from(document.getElementsByTagName(tag))) {
    if (cand instanceof HTMLElement && fingerprintOf(cand) === ref.fingerprint)
      return cand;
  }
  return null;
}

/** Pick a sensible target under the pointer: not huge, not tiny, not our own UI. */
export function bestTarget(start: Element | null): HTMLElement | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let node: Element | null = start;
  while (node && node !== document.body && node !== document.documentElement) {
    if (isOurUi(node)) return null;
    const r = node.getBoundingClientRect();
    const area = r.width * r.height;
    if (r.width >= 16 && r.height >= 12 && area < vw * vh * 0.6) {
      return node as HTMLElement;
    }
    node = node.parentElement;
  }
  return null;
}

export function describeElement(el: HTMLElement): ElementDescription {
  const r = el.getBoundingClientRect();
  const label =
    el.getAttribute("alt") ||
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    el.querySelector("img")?.getAttribute("alt") ||
    undefined;
  const src = imageSrc(el);
  let imageName: string | undefined;
  if (src && !src.startsWith("data:")) {
    try {
      imageName = decodeURIComponent(
        new URL(src, location.href).pathname.split("/").pop() || "",
      );
    } catch {
      imageName = undefined;
    }
  }
  const text =
    (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 240) || undefined;
  return {
    tag: el.tagName,
    role: el.getAttribute("role") || undefined,
    label: label?.slice(0, 120),
    text,
    imageName: imageName?.slice(0, 80),
    width: r.width,
    height: r.height,
    isLink: !!el.closest("a[href]"),
    isButton:
      el.tagName === "BUTTON" ||
      el.getAttribute("role") === "button" ||
      (el instanceof HTMLInputElement &&
        ["button", "submit"].includes(el.type)),
    pageTitle: document.title.slice(0, 100),
    host: location.hostname,
  };
}

/** Crop the element out of a full visible-tab screenshot, scaled to at most `max` px on its long side. */
export async function cropElement(
  el: HTMLElement,
  tabPng: string,
  max = 512,
): Promise<string | undefined> {
  const r = el.getBoundingClientRect();
  const x = Math.max(0, r.left);
  const y = Math.max(0, r.top);
  const w = Math.min(window.innerWidth, r.right) - x;
  const h = Math.min(window.innerHeight, r.bottom) - y;
  if (w < 4 || h < 4) return undefined;
  const img = new Image();
  img.src = tabPng;
  await img.decode();
  const scale = img.naturalWidth / window.innerWidth;
  const k = Math.min(1, max / Math.max(w * scale, h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale * k);
  canvas.height = Math.round(h * scale * k);
  canvas
    .getContext("2d")!
    .drawImage(
      img,
      x * scale,
      y * scale,
      w * scale,
      h * scale,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  return canvas.toDataURL("image/jpeg", 0.85);
}
