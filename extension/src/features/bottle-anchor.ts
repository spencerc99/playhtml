// ABOUTME: Picks DOM-anchored positions for bottles so two visitors see them at the same content offsets.
// ABOUTME: Stores a CSS selector + relative offset; the anchor is page-stable and its viewport position moves with scroll.

import { bottleDebug as debug } from "./bottle-debug";

export interface BottleAnchor {
  selector: string;
  offsetX: number; // fraction of anchor width; outside 0..1 means a side margin
  offsetY: number; // -1..3, fraction of anchor element height (>1 means below the element)
}

interface ResolvedPosition {
  x: number; // viewport pixels (center of bottle)
  y: number; // viewport pixels (center of bottle)
  rotate: number; // degrees, deterministic from anchor
}

// Bounding box of the 72x96 mound at its maximum 15-degree rotation.
const BOTTLE_W = 96;
const BOTTLE_H = 112;
// Require breathing room beyond the visible object.
const SAMPLE_HALF_W = BOTTLE_W / 2 + 12;
const SAMPLE_HALF_H = BOTTLE_H / 2 + 12;
const CONTENT_GAP_PX = 24;
const SAFE_TOP_PX = 80;
const SAFE_EDGE_PX = 24;

const MAX_PICK_ATTEMPTS = 160;
const MIN_READABLE_TEXT_LENGTH = 60;

/**
 * Pick a stable anchor whose resolved position lands in a clear side margin
 * beside substantial readable content.
 */
export function pickBottleAnchor(): BottleAnchor | null {
  const candidates = collectAnchorCandidates(true);
  if (!candidates.length) {
    debug("[bottles] no anchor candidates collected from DOM");
    return null;
  }
  debug(`[bottles] collected ${candidates.length} readable anchor candidate(s)`);

  const reasonCounts: Record<string, number> = {};
  const anchors = anchorsBesideReadableContent(candidates);
  for (const anchor of anchors.slice(0, MAX_PICK_ATTEMPTS)) {
    const result = scorePlacement(anchor);
    if (result.score < 0) {
      reasonCounts[result.reason] = (reasonCounts[result.reason] ?? 0) + 1;
      continue;
    }
    debug(`[bottles] picked clear content margin: ${anchor.selector}`);
    return anchor;
  }

  debug(
    `[bottles] no clear content margin among ${Math.min(anchors.length, MAX_PICK_ATTEMPTS)} placements. rejections=`,
    reasonCounts,
  );
  return null;
}

/** Resolve the page position chosen at placement time. Offscreen positions are
 * still valid; null means the anchor element itself no longer exists. */
export function resolveBottlePosition(anchor: BottleAnchor): ResolvedPosition | null {
  return resolveAnchorPosition(anchor).position;
}

/**
 * Build a page-stable anchor for a spot the user pointed at (manual placement).
 * Unlike pickBottleAnchor, this makes no attempt to find "clean" background —
 * the bottle goes exactly where the cursor is. We bind it to the nearest stable
 * content element and encode the point as an offset within that element, so the
 * bottle follows that spot across scroll/resize and other visitors see it there.
 *
 * Falls back to `body` when no reasonable content anchor sits near the point
 * (e.g. a bare page), which still gives a scroll-stable page position.
 */
export function anchorFromPoint(clientX: number, clientY: number): BottleAnchor {
  const candidates = collectAnchorCandidates();
  let best: { selector: string; rect: DOMRect } | null = null;
  let bestDist = Infinity;
  for (const sel of candidates) {
    let el: Element | null;
    try {
      el = document.querySelector(sel);
    } catch {
      continue;
    }
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 8) continue;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = cx - clientX;
    const dy = cy - clientY;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = { selector: sel, rect };
    }
  }

  if (!best) {
    // No content anchor near the point — bind to body. offsets are fractions of
    // the body box, so the position still scrolls with the page.
    const bodyRect = document.body.getBoundingClientRect();
    return {
      selector: "body",
      offsetX: bodyRect.width ? (clientX - bodyRect.left) / bodyRect.width : 0.5,
      offsetY: bodyRect.height ? (clientY - bodyRect.top) / bodyRect.height : 0.5,
    };
  }

  const { selector, rect } = best;
  return {
    selector,
    offsetX: (clientX - rect.left) / rect.width,
    offsetY: (clientY - rect.top) / rect.height,
  };
}

interface ScoreResult {
  score: number; // -1 = hard reject, 0..1 = how clear
  position: ResolvedPosition | null;
  reason: string;
}

function scorePlacement(anchor: BottleAnchor): ScoreResult {
  const resolved = resolveAnchorPosition(anchor);
  if (!resolved.position) {
    return { score: -1, position: null, reason: resolved.reason };
  }

  const { x, y } = resolved.position;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Hard reject: the bottle must be FULLY inside the current viewport
  // (with safe margins), not just partially overlapping it. Anchors below
  // the fold or above the scroll-top are not acceptable at placement time.
  if (
    x - SAMPLE_HALF_W < SAFE_EDGE_PX ||
    x + SAMPLE_HALF_W > vw - SAFE_EDGE_PX ||
    y - SAMPLE_HALF_H < SAFE_TOP_PX ||
    y + SAMPLE_HALF_H > vh - SAFE_EDGE_PX
  ) {
    return { score: -1, position: null, reason: "out-of-viewport" };
  }
  const edgeScore = 1;

  // Score the area underneath the bottle. -1 if any sample lands on
  // anything that isn't empty background (text/image/button/etc).
  const areaScore = scoreArea(x, y);
  if (areaScore < 0) {
    return { score: -1, position: null, reason: "not-background" };
  }

  return {
    score: edgeScore * 0.4 + areaScore * 0.6,
    position: resolved.position,
    reason: "",
  };
}

function resolveAnchorPosition(anchor: BottleAnchor): {
  position: ResolvedPosition | null;
  reason: string;
} {
  let el: Element | null = null;
  try {
    el = document.querySelector(anchor.selector);
  } catch {
    return { position: null, reason: "selector-error" };
  }
  if (!el) return { position: null, reason: "no-element" };
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { position: null, reason: "zero-size" };

  const x = rect.left + rect.width * anchor.offsetX;
  const y = rect.top + rect.height * anchor.offsetY;

  const rotate =
    -15 + (hashStr(anchor.selector + anchor.offsetX.toFixed(2) + anchor.offsetY.toFixed(2)) % 30);

  return {
    position: { x, y, rotate },
    reason: "",
  };
}

/**
 * Score the cleanliness of the area underneath the bottle. -1 if it
 * overlaps anything that isn't empty background (text, image, button,
 * etc). Otherwise 1 — the bottle gets full marks for landing in a
 * background region.
 *
 * The "background" is: html/body, or a layout container (div/section/etc)
 * with no direct text node and no descendant images/buttons/links at the
 * sample point. Anything else is hard-rejected.
 */
function scoreArea(centerX: number, centerY: number): number {
  const columns = 5;
  const rows = 7;
  for (let row = 0; row < rows; row++) {
    const y = centerY - SAMPLE_HALF_H + (row / (rows - 1)) * SAMPLE_HALF_H * 2;
    for (let column = 0; column < columns; column++) {
      const x = centerX - SAMPLE_HALF_W + (column / (columns - 1)) * SAMPLE_HALF_W * 2;
      if (!isBackgroundAt(x, y)) return -1;
    }
  }
  return 1;
}

/**
 * Is the topmost real element at (sx,sy) just empty background (html, body,
 * or a layout container with no text/media/interactive children right here)?
 */
function isBackgroundAt(sx: number, sy: number): boolean {
  const stack = document.elementsFromPoint(sx, sy);
  const filtered = stack.filter(
    (e) => !(e instanceof HTMLElement) || e.id !== "we-were-online-bottles",
  );
  const top = filtered[0];
  if (!top) return true; // off-document = empty
  const tag = top.tagName.toLowerCase();
  if (tag === "html" || tag === "body") return true;

  if (top.closest(INTERACTIVE_OR_MEDIA_SELECTOR)) {
    return false;
  }

  // p, li, h1-h6, span, etc — content elements. If they have direct text
  // at this spot, reject. (We use childNodes text content as the signal.)
  if (hasDirectText(top)) return false;

  return true;
}

function hasDirectText(el: Element): boolean {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim().length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Build placements in the left and right margins of readable blocks. The
 * bottle is only eligible when the full rotated footprint and its breathing
 * room fit between the content and viewport edge.
 */
function anchorsBesideReadableContent(candidates: string[]): BottleAnchor[] {
  const anchors: BottleAnchor[] = [];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    const leftX = rect.left - SAMPLE_HALF_W - CONTENT_GAP_PX;
    const rightX = rect.right + SAMPLE_HALF_W + CONTENT_GAP_PX;
    if (leftX - SAMPLE_HALF_W >= SAFE_EDGE_PX) {
      anchors.push({
        selector: sel,
        offsetX: (leftX - rect.left) / rect.width,
        offsetY: 0.5,
      });
    }
    if (rightX + SAMPLE_HALF_W <= window.innerWidth - SAFE_EDGE_PX) {
      anchors.push({
        selector: sel,
        offsetX: (rightX - rect.left) / rect.width,
        offsetY: 0.5,
      });
    }
  }

  for (let i = anchors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [anchors[i], anchors[j]] = [anchors[j], anchors[i]];
  }
  return anchors;
}

function collectAnchorCandidates(readableOnly = false): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  if (!readableOnly) {
    const idEls = document.querySelectorAll<HTMLElement>("[id]");
    for (const el of idEls) {
      if (!isReasonableAnchor(el)) continue;
      if (el.id && /^[a-z][\w-]+$/i.test(el.id)) {
        const sel = `#${CSS.escape(el.id)}`;
        if (!seen.has(sel)) {
          seen.add(sel);
          out.push(sel);
        }
      }
    }
  }

  const blocks = document.querySelectorAll<HTMLElement>(
    readableOnly
      ? "p, li, blockquote, dd, figcaption"
      : "p, li, h1, h2, h3, h4, blockquote, dt, dd, figcaption",
  );
  for (const el of blocks) {
    if (!isReasonableAnchor(el)) continue;
    if (readableOnly && normalizedTextLength(el) < MIN_READABLE_TEXT_LENGTH) continue;
    const sel =
      el.id && /^[a-z][\w-]+$/i.test(el.id) ? `#${CSS.escape(el.id)}` : buildStructuralSelector(el);
    if (!sel || seen.has(sel)) continue;
    seen.add(sel);
    out.push(sel);
    if (out.length >= 200) break;
  }

  return out;
}

function buildStructuralSelector(el: Element): string | null {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    if (cur.id && /^[a-z][\w-]+$/i.test(cur.id)) {
      parts.unshift(`#${CSS.escape(cur.id)}`);
      return parts.join(" > ");
    }
    const parent: Element | null = cur.parentElement;
    if (!parent) return null;
    const tag = cur.tagName.toLowerCase();
    let n = 0;
    let myIndex = -1;
    for (const sib of Array.from(parent.children)) {
      if (sib.tagName.toLowerCase() === tag) {
        n++;
        if (sib === cur) myIndex = n;
      }
    }
    if (myIndex === -1) return null;
    parts.unshift(`${tag}:nth-of-type(${myIndex})`);
    cur = parent;
  }
  parts.unshift("body");
  return parts.join(" > ");
}

// Hosts the extension injects into the page. Anchoring a bottle to one of
// these (or their subtree) would let a bottle attach to our own overlay, so we
// exclude them. Matched by id prefix since each feature mints its own host id.
const EXTENSION_HOST_SELECTOR =
  '[id^="we-were-online"], [id^="wewere-"], [id^="playhtml-historical-overlay"]';

function isReasonableAnchor(el: HTMLElement): boolean {
  if (el.closest(EXTENSION_HOST_SELECTOR)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 80 || rect.height < 16) return false;
  const closestChrome = el.closest("nav, aside, footer, header");
  if (closestChrome) return false;
  return true;
}

function normalizedTextLength(el: Element): number {
  return (el.textContent || "").replace(/\s+/g, " ").trim().length;
}

const INTERACTIVE_OR_MEDIA_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "img",
  "video",
  "canvas",
  "svg",
  "iframe",
  "picture",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='textbox']",
  "[role='combobox']",
  "[role='option']",
  "[role='gridcell']",
].join(",");

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
