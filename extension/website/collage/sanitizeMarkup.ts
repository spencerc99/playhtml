// ABOUTME: Sanitizes the inline SVG and styles a published collage carries, every time the viewer renders them.
// ABOUTME: Stored markup is never trusted: scripts, handlers, links, external references and unsafe CSS are removed.

import DOMPurify from "dompurify";
import {
  isSafeStyleValue,
  publishableStyles,
  type PublishedStyles,
} from "../../shared/publishedCollage";

/**
 * Elements no published icon needs, any of which could run code, load from
 * elsewhere or take input: scripts and styles, embedded documents, forms,
 * links, raster `<image>`s, `<foreignObject>` (which hosts HTML inside SVG),
 * and SVG animation, which can rewrite an `href` into `javascript:` after the
 * sanitizer has looked.
 */
const FORBIDDEN_TAGS = [
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "link",
  "meta",
  "base",
  "a",
  "image",
  "img",
  "video",
  "audio",
  "source",
  "track",
  "foreignObject",
  "feImage",
  "animate",
  "animateMotion",
  "animateTransform",
  "animateColor",
  "set",
  "discard",
  "handler",
  "listener",
];

/** Attributes that only ever point somewhere: kept only as `#id` references. */
const REFERENCE_ATTRIBUTES = new Set(["href", "xlink:href"]);

/** Attributes that load or run something, whatever their value. */
const FORBIDDEN_ATTRIBUTES = [
  "src",
  "srcset",
  "srcdoc",
  "action",
  "formaction",
  "background",
  "ping",
  "poster",
  "data",
  "codebase",
  "xml:base",
];

/** Old scripting hooks and escapes that could spell one, inside CSS. */
const UNSAFE_CSS =
  /expression\s*\(|javascript\s*:|vbscript\s*:|behavior|-moz-binding|@import|image(?:-set)?\s*\(|element\s*\(|cross-fade\s*\(|paint\s*\(|[\\<>{}]|\/\*/i;

/** Every `url(...)` in a value, so each can be checked to stay inside the icon. */
const URL_FUNCTION = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;

/**
 * Whether a value only refers inside the icon: no `url()` at all, or only
 * `url(#id)` (a gradient, clip path or filter in the same SVG).
 */
function staysInside(value: string): boolean {
  for (const match of value.matchAll(URL_FUNCTION)) {
    if (!match[2].trim().startsWith("#")) return false;
  }
  // A `url(` the pattern could not read is treated as pointing outside.
  const opened = (value.match(/url\s*\(/gi) ?? []).length;
  const read = [...value.matchAll(URL_FUNCTION)].length;
  return opened === read;
}

/** An inline `style` attribute with each unsafe declaration dropped. */
export function sanitizeStyleAttribute(value: string): string {
  return value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      if (!declaration) return false;
      const colon = declaration.indexOf(":");
      if (colon <= 0) return false;
      const property = declaration.slice(0, colon).trim();
      if (!/^-?[a-z][a-z0-9-]*$/i.test(property)) return false;
      return !UNSAFE_CSS.test(declaration) && staysInside(declaration);
    })
    .join(";");
}

let purifier: ReturnType<typeof DOMPurify> | null = null;

/** One DOMPurify instance with this page's own hooks, so no other use sees them. */
function svgPurifier(): ReturnType<typeof DOMPurify> {
  if (purifier) return purifier;
  const instance = DOMPurify(window);
  instance.addHook("uponSanitizeAttribute", (_node, data) => {
    const name = data.attrName.toLowerCase();
    const value = data.attrValue;
    if (name.startsWith("on")) {
      data.keepAttr = false;
      return;
    }
    if (REFERENCE_ATTRIBUTES.has(name)) {
      // `<use href>` and gradient links may only point inside the icon.
      data.keepAttr = /^#[A-Za-z_][\w.:-]*$/.test(value.trim());
      return;
    }
    if (name === "style") {
      const clean = sanitizeStyleAttribute(value);
      if (clean) data.attrValue = clean;
      else data.keepAttr = false;
      return;
    }
    if (UNSAFE_CSS.test(value) || !staysInside(value)) {
      data.keepAttr = false;
    }
  });
  purifier = instance;
  return instance;
}

/**
 * An inline SVG made safe to set into the page: SVG elements only, with no
 * script, handler, link, animation, embedded HTML or reference to anything
 * outside the icon. Answers "" when nothing of an `<svg>` is left.
 */
export function sanitizeSvgMarkup(markup: string): string {
  const clean = svgPurifier().sanitize(markup, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // The collector copies what a `<use>` points at into the icon, so it is
    // kept, with its `href` held to `#id` by the hook above.
    ADD_TAGS: ["use"],
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    SAFE_FOR_TEMPLATES: false,
    WHOLE_DOCUMENT: false,
    RETURN_TRUSTED_TYPE: false,
  });
  return /^\s*<svg[\s>]/i.test(clean) ? clean : "";
}

/**
 * The styles a button or heading is set in, cut to the properties the
 * collector captures and the values that cannot fetch or script.
 */
export function sanitizeStyles(
  styles: Record<string, string> | undefined,
): PublishedStyles {
  return publishableStyles(styles);
}

/** A CSS color to paint behind a button, or undefined when it is not safe. */
export function sanitizeColor(value: string | undefined): string | undefined {
  return value !== undefined && isSafeStyleValue(value) ? value : undefined;
}
