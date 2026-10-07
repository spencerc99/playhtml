// ABOUTME: Builds the SVG document a non-image scrap is drawn from when baking.
// ABOUTME: Escapes text for XML and refuses markup an XML parser cannot read.

/** Escapes a value for use as XML text or inside a double-quoted attribute. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Turns a scrap's captured computed styles into a CSS declaration list. The
 * result still has to be XML-escaped before it becomes an attribute value.
 */
export function styleDeclarations(styles: Record<string, string>): string {
  return Object.entries(styles)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([property, value]) => {
      const name = property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      // A declaration cannot carry its own terminator or a CSS comment without
      // swallowing the declarations after it.
      const safe = value.replace(/[;{}]/g, " ").replace(/\/\*/g, " ").trim();
      return `${name}:${safe}`;
    })
    .join(";");
}

/**
 * Parses markup as XML and returns it re-serialized, or throws naming the
 * problem. Scrap markup is captured through `XMLSerializer`, but a record
 * saved by an older build or edited by hand may not be well formed, and an
 * `<img>` fed malformed SVG fails with no usable error of its own.
 */
export function requireXmlFragment(markup: string, label: string): string {
  const document = new DOMParser().parseFromString(
    `<fragment xmlns="http://www.w3.org/1999/xhtml">${markup}</fragment>`,
    "application/xml",
  );
  const failure = document.querySelector("parsererror");
  if (failure) {
    throw new Error(`${label} is not well-formed XML`);
  }
  return markup;
}

export interface ForeignObjectOptions {
  /** Already-XML-safe body markup placed inside the foreignObject. */
  body: string;
  /** The box the body is laid out in. */
  width: number;
  height: number;
  /**
   * How much larger the document is drawn than the box its body is laid out
   * in, so lettering set at its own type size scales with the piece.
   */
  scale?: number;
}

/**
 * An SVG document wrapping HTML in a foreignObject, as a `data:` URL.
 *
 * Chromium taints a canvas when a foreignObject SVG is loaded from a `blob:`
 * URL, which would make the baked PNG unreadable. A `data:` URL is treated as
 * same-origin and keeps the canvas clean.
 *
 * A web font named by the scrap's styles will not load inside an SVG image;
 * the piece bakes in a fallback face, which is expected.
 */
export function foreignObjectDataUrl({
  body,
  width,
  height,
  scale = 1,
}: ForeignObjectOptions): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">`,
    `<foreignObject x="0" y="0" width="${width}" height="${height}">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;">`,
    body,
    `</div></foreignObject></svg>`,
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** A standalone SVG document as a `data:` URL, for an svg-icon scrap. */
export function svgDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

export interface ButtonScrapShape {
  text: string;
  styles: Record<string, string>;
  innerSvg?: string;
  /** The color the scrap was read against, painted behind it as a patch. */
  backdropColor?: string;
}

/**
 * Wraps baked body markup in the snug patch of the color the scrap was read
 * against, so a see-through scrap bakes with the contrast its page supplied
 * exactly as `ScrapBackdrop` paints it on screen. A scrap without a recorded
 * backdrop bakes unwrapped.
 */
function withBackdrop(body: string, backdropColor?: string): string {
  if (!backdropColor) return body;
  const patch = [
    `background:${backdropColor.replace(/[;{}]/g, " ").trim()}`,
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "box-sizing:border-box",
    "width:100%",
    "height:100%",
  ].join(";");
  return `<span style="${escapeXml(patch)}">${body}</span>`;
}

/** The HTML a button scrap bakes as, with every value escaped for XML. */
export function buttonBodyMarkup(scrap: ButtonScrapShape): string {
  const declarations = [
    styleDeclarations(scrap.styles),
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "white-space:nowrap",
    // The span fills the piece's box so its own border and shadow are drawn
    // inside the baked area rather than spilling outside and being clipped.
    "box-sizing:border-box",
    "width:100%",
    "height:100%",
    "overflow:hidden",
  ]
    .filter((part) => part.length > 0)
    .join(";");
  const icon = scrap.innerSvg
    ? requireXmlFragment(scrap.innerSvg, "The button's icon")
    : "";
  return withBackdrop(
    `<span style="${escapeXml(declarations)}">${icon}${escapeXml(scrap.text)}</span>`,
    scrap.backdropColor,
  );
}

export interface HeadingScrapShape {
  text: string;
  styles: Record<string, string>;
}

/**
 * The HTML a heading scrap bakes as. It carries the page's own typography —
 * family, weight, color, spacing — from the captured styles, at the display
 * font size the studio showed it at, so the baked words match the piece.
 */
export function headingBodyMarkup(
  scrap: HeadingScrapShape,
  fontSize: number,
  lineHeight: number,
): string {
  const declarations = [
    styleDeclarations(scrap.styles),
    // These follow the captured styles so they win over the captured font
    // size and line height, which belong to the size the heading was read at.
    `font-size:${fontSize}px`,
    `line-height:${lineHeight}`,
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "text-align:center",
    "box-sizing:border-box",
    "width:100%",
    "height:100%",
    "overflow:hidden",
  ]
    .filter((part) => part.length > 0)
    .join(";");
  return `<span style="${escapeXml(declarations)}">${escapeXml(scrap.text)}</span>`;
}
