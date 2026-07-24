// ABOUTME: Builds stable identities for locally captured internet scraps.
// ABOUTME: Sanitizes inline SVG markup before it reaches extension rendering surfaces.

import type { ScrapEventData } from "./types";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const ALLOWED_SVG_ELEMENTS = new Set([
  "circle",
  "clippath",
  "defs",
  "desc",
  "ellipse",
  "feblend",
  "fecolormatrix",
  "fecomponenttransfer",
  "fecomposite",
  "feconvolvematrix",
  "fediffuselighting",
  "fedisplacementmap",
  "fedistantlight",
  "fedropshadow",
  "feflood",
  "fefunca",
  "fefuncb",
  "fefuncg",
  "fefuncr",
  "fegaussianblur",
  "femerge",
  "femergenode",
  "femorphology",
  "feoffset",
  "fepointlight",
  "fespecularlighting",
  "fespotlight",
  "fetile",
  "feturbulence",
  "filter",
  "g",
  "lineargradient",
  "line",
  "marker",
  "mask",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialgradient",
  "rect",
  "stop",
  "svg",
  "symbol",
  "text",
  "textpath",
  "title",
  "tspan",
  "use",
]);

export function hashScrapString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function serializeScrapStyles(styles: Record<string, string>): string {
  return Object.keys(styles)
    .sort()
    .map((property) => `${property}:${styles[property]}`)
    .join(";");
}

export function getScrapKey(data: ScrapEventData): string {
  switch (data.kind) {
    case "image":
      return data.src;
    case "button":
      return hashScrapString(`${data.text}\n${serializeScrapStyles(data.styles)}`);
    case "svg-icon":
      return hashScrapString(data.markup);
    case "cursor":
      return data.url;
  }
}

function getUseReference(use: SVGUseElement): string | null {
  return (
    use.getAttribute("href") ??
    use.getAttributeNS(XLINK_NAMESPACE, "href") ??
    use.getAttribute("xlink:href")
  );
}

function hasElementWithId(root: SVGSVGElement, id: string): boolean {
  return Array.from(root.querySelectorAll("[id]")).some(
    (element) => element.getAttribute("id") === id,
  );
}

function resolveUseReferences(svg: SVGSVGElement): boolean {
  const resolvedIds = new Set<string>();

  for (let pass = 0; pass < 100; pass++) {
    const unresolvedUse = Array.from(svg.querySelectorAll("use")).find((use) => {
      const href = getUseReference(use as SVGUseElement);
      return href !== null && href.startsWith("#") && !hasElementWithId(svg, href.slice(1));
    });

    if (!unresolvedUse) break;
    const href = getUseReference(unresolvedUse as SVGUseElement);
    if (!href || !href.startsWith("#") || href.length === 1) return false;

    const id = href.slice(1);
    if (resolvedIds.has(id)) return false;
    const referenced = document.getElementById(id);
    if (!referenced || !(referenced instanceof SVGElement)) return false;

    let defs = svg.querySelector(":scope > defs");
    if (!defs) {
      defs = document.createElementNS(SVG_NAMESPACE, "defs");
      svg.prepend(defs);
    }
    defs.appendChild(referenced.cloneNode(true));
    resolvedIds.add(id);
  }

  return Array.from(svg.querySelectorAll("use")).every((use) => {
    const href = getUseReference(use as SVGUseElement);
    return Boolean(
      href &&
      href.startsWith("#") &&
      href.length > 1 &&
      hasElementWithId(svg, href.slice(1)),
    );
  });
}

function referencesExternalResource(element: Element): boolean {
  if (element.localName.toLowerCase() === "image") return true;

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    if (
      (name === "href" || name === "xlink:href" || name === "src") &&
      !value.startsWith("#")
    ) {
      return true;
    }
    if (/url\(\s*(['"]?)(?!#)[^)]+\1\s*\)/i.test(value)) {
      return true;
    }
  }
  return false;
}

function sanitizeSvgTree(svg: SVGSVGElement): boolean {
  if (
    !ALLOWED_SVG_ELEMENTS.has(svg.localName.toLowerCase()) ||
    referencesExternalResource(svg)
  ) {
    return false;
  }

  for (const element of Array.from(svg.querySelectorAll("*"))) {
    const name = element.localName.toLowerCase();
    if (!ALLOWED_SVG_ELEMENTS.has(name) || referencesExternalResource(element)) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (
        name.startsWith("on") ||
        /javascript\s*:/i.test(value) ||
        name === "srcdoc"
      ) {
        element.removeAttributeNode(attribute);
      }
    }
  }

  for (const attribute of Array.from(svg.attributes)) {
    const name = attribute.name.toLowerCase();
    if (
      name.startsWith("on") ||
      /javascript\s*:/i.test(attribute.value) ||
      name === "srcdoc"
    ) {
      svg.removeAttributeNode(attribute);
    }
  }

  return true;
}

function bakeCurrentColor(svg: SVGSVGElement, color: string): void {
  let usesFill = false;
  let usesStroke = false;

  for (const element of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (!/currentcolor/i.test(attribute.value)) continue;
      if (attribute.name.toLowerCase() === "fill") usesFill = true;
      if (attribute.name.toLowerCase() === "stroke") usesStroke = true;
      element.setAttribute(
        attribute.name,
        attribute.value.replace(/currentcolor/gi, color),
      );
    }
  }

  if (usesFill) svg.setAttribute("fill", color);
  if (usesStroke) svg.setAttribute("stroke", color);
}

export interface SerializeSvgOptions {
  width: number;
  height: number;
  color: string;
  maxBytes: number;
}

export function serializeSvg(
  source: SVGSVGElement,
  { width, height, color, maxBytes }: SerializeSvgOptions,
): string | undefined {
  const svg = source.cloneNode(true) as SVGSVGElement;
  if (!resolveUseReferences(svg)) return undefined;

  bakeCurrentColor(svg, color);
  if (!sanitizeSvgTree(svg)) return undefined;

  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  if (!svg.hasAttribute("viewBox")) {
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  const markup = new XMLSerializer().serializeToString(svg);
  if (new TextEncoder().encode(markup).byteLength > maxBytes) return undefined;
  return markup;
}
