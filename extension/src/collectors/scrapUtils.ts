// ABOUTME: Builds stable identities for locally captured internet scraps.
// ABOUTME: Sanitizes inline SVG markup before it reaches extension rendering surfaces.

import { scrapEncounterDay } from "@movement/utils/scrapEncounterDay";
import type { ScrapEventData } from "./types";
import {
  canonicalScrapPageUrl,
  canonicalButtonKey,
  canonicalCursorKey,
  canonicalHeadingKey,
  canonicalImageKey,
  canonicalSvgIconKey,
} from "@movement/utils/scrapIdentity";

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

/**
 * Alpha of a color whose syntax this reader understands: 0 when it paints
 * nothing and 1 when it is solid. `undefined` says the syntax was not
 * recognized, so nothing is known about the color — callers decide what to do
 * with that rather than being handed a guess.
 */
export type ColorAlpha = number | undefined;

/** The CSS color functions, all of which take alpha after a slash. */
const COLOR_FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
]);

/** A number or a percentage in an alpha slot, as CSS Color 4 allows either. */
function parseAlphaComponent(raw: string): ColorAlpha {
  const value = raw.trim();
  if (!value) return undefined;
  const percentage = /^([+-]?(?:\d+\.?\d*|\.\d+))%$/.exec(value);
  const parsed = Number(percentage ? percentage[1] : value);
  if (!Number.isFinite(parsed)) return undefined;
  return clampAlpha(percentage ? parsed / 100 : parsed);
}

function clampAlpha(alpha: number): number {
  return Math.min(1, Math.max(0, alpha));
}

/**
 * Alpha carried by a hex color: `#rgba` and `#rrggbbaa` end in an alpha byte,
 * while the three- and six-digit forms are solid.
 */
function hexAlpha(digits: string): ColorAlpha {
  if (!/^[0-9a-f]+$/i.test(digits)) return undefined;
  if (digits.length === 3 || digits.length === 6) return 1;
  if (digits.length === 4)
    return clampAlpha(parseInt(digits[3]!.repeat(2), 16) / 255);
  if (digits.length === 8)
    return clampAlpha(parseInt(digits.slice(6), 16) / 255);
  return undefined;
}

/**
 * Alpha of a computed color across the CSS Color 4 forms a browser emits.
 * Chromium normalizes most authored colors to `rgb()`/`rgba()`, but wide-gamut
 * and modern-syntax values survive as `color(...)`, `oklch(...)` and friends,
 * all of which carry alpha the same way: after a slash, as a number or a
 * percentage. Legacy `rgba()`/`hsla()` instead take a fourth comma-separated
 * component, and a color with neither is solid.
 */
export function colorAlpha(color: string): ColorAlpha {
  const value = color.trim();
  if (!value) return 0;
  if (/^transparent$/i.test(value)) return 0;

  if (value.startsWith("#")) return hexAlpha(value.slice(1));

  const functional = /^([a-z-]+)\(([^)]*)\)$/i.exec(value);
  if (!functional) {
    // A bare keyword such as `currentcolor` or a named color. Named colors are
    // all solid; anything else here is a syntax this reader does not know.
    return /^[a-z]+$/i.test(value) ? 1 : undefined;
  }

  const [, name, body] = functional;
  // Only the color functions carry alpha this way. Anything else that happens
  // to look like one, such as an unresolved `var()`, says nothing about paint.
  if (!COLOR_FUNCTIONS.has(name!.toLowerCase())) return undefined;
  const slash = body!.indexOf("/");
  if (slash !== -1) return parseAlphaComponent(body!.slice(slash + 1));

  // No slash: only the legacy four-component comma forms carry alpha.
  const commaParts = body!.split(",");
  if (commaParts.length === 4) return parseAlphaComponent(commaParts[3]!);
  return 1;
}

const BORDER_SIDES = ["Top", "Right", "Bottom", "Left"] as const;
const NO_BORDER_STYLE_PATTERN = /^(?:none|hidden)$/i;

/** Whether a width, style and color together draw something a reader could see. */
function borderSideShows(
  width: string | undefined,
  style: string | undefined,
  color: string | undefined,
): boolean {
  const pixels = Number.parseFloat(width ?? "0");
  if (!Number.isFinite(pixels) || pixels <= 0) return false;
  if (NO_BORDER_STYLE_PATTERN.test((style ?? "none").trim())) return false;
  if (color === undefined) return true;
  const alpha = colorAlpha(color);
  // A color this reader cannot parse is treated as paint, so an unfamiliar
  // syntax keeps a bordered control rather than discarding it as bare prose.
  return alpha === undefined || alpha > 0;
}

/** How many sides of the element draw a border a reader could see. */
function visibleBorderSides(styles: Record<string, string>): number {
  const shorthand = styles.border?.trim();
  if (shorthand) {
    // The shorthand reads "<width> <style> [<color>]", and only appears when
    // every side agrees, so one read settles the whole box.
    const [width, style, ...rest] = shorthand.split(/\s+(?![^(]*\))/);
    const color = rest.length > 0 ? rest.join(" ") : undefined;
    return borderSideShows(width, style, color) ? BORDER_SIDES.length : 0;
  }

  return BORDER_SIDES.filter((side) =>
    borderSideShows(
      styles[`border${side}Width`],
      styles[`border${side}Style`],
      styles[`border${side}Color`],
    ),
  ).length;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Reads the `rgb()` / `rgba()` form browsers report computed colors in. Any
 * other syntax returns undefined, which callers treat as "cannot tell".
 */
export function parseRgb(color: string): Rgba | undefined {
  const match = /^rgba?\(([^)]*)\)$/i.exec(color.trim());
  if (!match) return undefined;
  const parts = match[1]!
    .split(/[\s,/]+/)
    .filter((part) => part.length > 0)
    .map((part) =>
      part.endsWith("%")
        ? Number.parseFloat(part) / 100
        : Number.parseFloat(part),
    );
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  const [r, g, b, a = 1] = parts as [number, number, number, number?];
  return { r, g, b, a: clampAlpha(a) };
}

/**
 * How far apart two colors look once the first is laid over the second, on
 * the 0-255 scale of the largest channel difference. Undefined when either
 * color is a syntax this reader does not know.
 */
function paintedDistance(paint: string, backdrop: string): number | undefined {
  const top = parseRgb(paint);
  const bottom = parseRgb(backdrop);
  if (!top || !bottom) return undefined;
  const blend = (front: number, back: number) =>
    front * top.a + back * (1 - top.a);
  return Math.max(
    Math.abs(blend(top.r, bottom.r) - bottom.r),
    Math.abs(blend(top.g, bottom.g) - bottom.g),
    Math.abs(blend(top.b, bottom.b) - bottom.b),
  );
}

/**
 * The smallest channel difference a fill needs from the color behind it to
 * read as a shape. A faint 6% tint on white clears it; a fill that matches
 * its page does not.
 */
const MIN_FACE_CONTRAST = 10;

/** Splits a comma-separated CSS list, ignoring commas inside functions. */
function splitCssList(value: string): string[] {
  return value.split(/,(?![^(]*\))/).map((part) => part.trim());
}

/**
 * Whether any layer of a computed `box-shadow` draws something. Utility CSS
 * often stacks invisible layers (`0 0 #0000`), which name a shadow without
 * painting one.
 */
export function hasVisibleShadow(boxShadow: string | undefined): boolean {
  const value = (boxShadow ?? "none").trim();
  if (!value || /^none$/i.test(value)) return false;
  return splitCssList(value).some((layer) => {
    const color =
      /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|#[0-9a-f]{3,8}\b|\b[a-z]+\b(?<!inset)/i.exec(
        layer,
      )?.[0];
    if (color !== undefined) {
      const alpha = colorAlpha(color);
      if (alpha === 0) return false;
    }
    const lengths = (
      layer.replace(color ?? "", "").match(/-?[\d.]+(?:px)?/g) ?? []
    )
      .map((length) => Number.parseFloat(length))
      .filter((length) => Number.isFinite(length));
    // Offsets, blur and spread all zero: the shadow sits exactly under the
    // box and shows nothing.
    return lengths.some((length) => length !== 0);
  });
}

/**
 * Whether a control's own paint gives it the face of a button: a fill that
 * stands out from the color behind it, a gradient, a border around most of
 * it, or a shadow that shows. Text a site merely tagged as a button, a tab
 * underlined on one side, or an icon floating on the page has none of these,
 * so once torn out of its page it reads as words or a bare glyph, not a
 * button.
 *
 * Anything this reader cannot parse counts as paint: better to keep a control
 * whose fill cannot be read than to throw away a real button.
 */
export function hasButtonFace(
  styles: Record<string, string>,
  backdropColor?: string,
): boolean {
  if (styles.backgroundImage !== undefined) return true;
  const fill = styles.backgroundColor ?? "transparent";
  const fillAlpha = colorAlpha(fill);
  if (fillAlpha === undefined) return true;
  if (fillAlpha > 0) {
    if (!backdropColor) return true;
    const distance = paintedDistance(fill, backdropColor);
    if (distance === undefined || distance >= MIN_FACE_CONTRAST) return true;
  }
  if (hasVisibleShadow(styles.boxShadow)) return true;
  // Three sides at least: one rule under a word is a tab or a link.
  return visibleBorderSides(styles) >= 3;
}

/**
 * Font families that draw icons from letters or private code points. Their
 * glyphs need the page's own font file, which a scrap cannot carry.
 */
const ICON_FONT_PATTERN =
  /material[ -](?:icons|symbols)|font ?awesome|glyphicons|icomoon|bootstrap-icons|remixicon|ionicons|phosphor|feather|lucide|tabler|octicons|\bicons?\b|symbols/i;

export function isIconFontFamily(fontFamily: string | undefined): boolean {
  return ICON_FONT_PATTERN.test(fontFamily ?? "");
}

/** Characters in Unicode's private use area, where icon fonts keep glyphs. */
export function hasPrivateUseCharacter(text: string): boolean {
  return /[\uE000-\uF8FF]|[\u{F0000}-\u{FFFFD}]|[\u{100000}-\u{10FFFD}]/u.test(
    text,
  );
}

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
      return hashScrapString(
        `${data.text}\n${serializeScrapStyles(data.styles)}`,
      );
    case "svg-icon":
      return hashScrapString(data.markup);
    case "heading":
      return hashScrapString(
        `${data.level}\n${data.text}\n${serializeScrapStyles(data.styles)}`,
      );
    case "cursor":
      return data.url;
  }
}

/**
 * Canonical identity for near-duplicate detection, matching the collage's
 * render-time dedup (see ScrapCollage.tsx's canonicalScrapKey). Two scraps
 * with the same canonical key are treated as the same underlying thing even
 * if their per-capture `getScrapKey` differs (different computed style
 * values, different rendered size, different CDN query params).
 */
export function getCanonicalScrapKey(
  domain: string,
  data: ScrapEventData,
): string;
export function getCanonicalScrapKey(
  domain: string,
  data: unknown,
): string | undefined;
export function getCanonicalScrapKey(
  domain: string,
  data: unknown,
): string | undefined {
  if (typeof data !== "object" || data === null || !("kind" in data)) {
    return undefined;
  }

  switch (data.kind) {
    case "image":
      return "src" in data && typeof data.src === "string"
        ? canonicalImageKey(data.src)
        : undefined;
    case "button":
      if (!("text" in data) || typeof data.text !== "string") {
        return undefined;
      }
      if (
        !("styles" in data) ||
        typeof data.styles !== "object" ||
        data.styles === null
      ) {
        return undefined;
      }
      return canonicalButtonKey(
        domain,
        data.text,
        "backgroundColor" in data.styles &&
          typeof data.styles.backgroundColor === "string"
          ? data.styles.backgroundColor
          : undefined,
      );
    case "svg-icon":
      return "markup" in data && typeof data.markup === "string"
        ? canonicalSvgIconKey(domain, data.markup)
        : undefined;
    case "heading":
      return "text" in data && typeof data.text === "string"
        ? canonicalHeadingKey(domain, data.text)
        : undefined;
    case "cursor":
      return "url" in data && typeof data.url === "string"
        ? canonicalCursorKey(data.url)
        : undefined;
    default:
      return undefined;
  }
}

/** Identifies an image encounter on a source page and capture-local day. */
export function getScrapEncounterKey(
  domain: string,
  data: unknown,
  pageUrl: string,
  timestamp: number,
  timeZone: string,
): string | undefined {
  const key = getCanonicalScrapKey(domain, data);
  if (
    key === undefined ||
    typeof data !== "object" ||
    data === null ||
    !("kind" in data) ||
    data.kind !== "image"
  )
    return key;
  return JSON.stringify([
    key,
    canonicalScrapPageUrl(pageUrl),
    scrapEncounterDay(timestamp, timeZone),
  ]);
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
    const unresolvedUse = Array.from(svg.querySelectorAll("use")).find(
      (use) => {
        const href = getUseReference(use as SVGUseElement);
        return (
          href !== null &&
          href.startsWith("#") &&
          !hasElementWithId(svg, href.slice(1))
        );
      },
    );

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
    if (
      !ALLOWED_SVG_ELEMENTS.has(name) ||
      referencesExternalResource(element)
    ) {
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
  /**
   * Lengths written as the root's width and height in place of the measured
   * pixels, such as em sizes that let an icon scale with the text beside it.
   * The measured pixels still set a missing viewBox.
   */
  displayWidth?: string;
  displayHeight?: string;
}

export function serializeSvg(
  source: SVGSVGElement,
  {
    width,
    height,
    color,
    maxBytes,
    displayWidth,
    displayHeight,
  }: SerializeSvgOptions,
): string | undefined {
  const svg = source.cloneNode(true) as SVGSVGElement;
  if (!resolveUseReferences(svg)) return undefined;

  bakeCurrentColor(svg, color);
  if (!sanitizeSvgTree(svg)) return undefined;

  if (!svg.hasAttribute("viewBox")) {
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  svg.setAttribute("width", displayWidth ?? String(width));
  svg.setAttribute("height", displayHeight ?? String(height));

  const markup = new XMLSerializer().serializeToString(svg);
  if (new TextEncoder().encode(markup).byteLength > maxBytes) return undefined;
  return markup;
}
