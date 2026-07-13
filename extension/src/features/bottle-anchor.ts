// ABOUTME: Picks DOM-anchored positions for bottles so two visitors see them at the same content offsets.
// ABOUTME: Stores a CSS selector + relative offset; the anchor is page-stable and its viewport position moves with scroll.

import { bottleDebug as debug } from "./bottle-debug";

export interface BottleAnchor {
  selector: string;
  offsetX: number; // 0..1, fraction of anchor element width
  offsetY: number; // -1..3, fraction of anchor element height (>1 means below the element)
}

interface ResolvedPosition {
  x: number; // viewport pixels (center of bottle)
  y: number; // viewport pixels (center of bottle)
  rotate: number; // degrees, deterministic from anchor
}

// Visible footprint of a bottle above the slot. Slightly conservative.
const BOTTLE_W = 44;
const BOTTLE_H = 80;
// Sample box covers most of the bottle's footprint so we catch any
// text/image that would be visually obscured.
const SAMPLE_HALF_W = 22;
const SAMPLE_HALF_H = 38;
const SAFE_TOP_PX = 80;
const SAFE_EDGE_PX = 24;

const MAX_PICK_ATTEMPTS = 80;
// First-match threshold — stop searching once we find a position this clear.
const GOOD_ENOUGH_SCORE = 0.95;
// Minimum we'll accept. We want a clean background spot, not "tolerable text overlap."
const MIN_ACCEPTABLE_SCORE = 0.85;

/**
 * Pick a stable anchor whose resolved position lands in clear empty space.
 * Tries many candidates+offsets, scoring each by how clear its footprint
 * is, and returns the best one above MIN_ACCEPTABLE_SCORE.
 */
export function pickBottleAnchor(): BottleAnchor | null {
  const candidates = collectAnchorCandidates();
  if (!candidates.length) {
    debug("[bottles] no anchor candidates collected from DOM");
    return null;
  }
  debug(
    `[bottles] collected ${candidates.length} anchor candidate(s), trying up to ${MAX_PICK_ATTEMPTS} placements`,
  );

  let best: { anchor: BottleAnchor; score: number; reason: string } | null = null;
  const reasonCounts: Record<string, number> = {};

  // Strategy 1: scan the viewport grid for empty cells, derive an anchor
  // pointing at each. Much higher hit rate on content-heavy pages where
  // random anchor offsets rarely land in margins.
  const gridAnchors = anchorsFromViewportGrid(candidates);
  for (const anchor of gridAnchors) {
    const result = scorePlacement(anchor);
    if (result.score < 0) {
      reasonCounts[result.reason] = (reasonCounts[result.reason] ?? 0) + 1;
      continue;
    }
    if (!best || result.score > best.score) {
      best = { anchor, score: result.score, reason: result.reason };
      if (result.score >= GOOD_ENOUGH_SCORE) {
        debug(
          `[bottles] picked anchor (grid, score=${result.score.toFixed(2)}): ${anchor.selector}`,
        );
        return anchor;
      }
    }
  }

  // Strategy 2: random anchor + random offset, as a fallback.
  for (let i = 0; i < MAX_PICK_ATTEMPTS; i++) {
    const selector = candidates[Math.floor(Math.random() * candidates.length)];
    const offsetY = pickOffsetY();
    const offsetX = pickOffsetX();
    const anchor: BottleAnchor = { selector, offsetX, offsetY };
    const result = scorePlacement(anchor);
    if (result.score < 0) {
      reasonCounts[result.reason] = (reasonCounts[result.reason] ?? 0) + 1;
      continue;
    }
    if (!best || result.score > best.score) {
      best = { anchor, score: result.score, reason: result.reason };
      if (result.score >= GOOD_ENOUGH_SCORE) {
        debug(
          `[bottles] picked anchor (random, score=${result.score.toFixed(2)}): ${selector}`,
        );
        return anchor;
      }
    }
  }

  if (best && best.score >= MIN_ACCEPTABLE_SCORE) {
    debug(
      `[bottles] picked best-available anchor (score=${best.score.toFixed(2)}): ${best.anchor.selector}`,
    );
    return best.anchor;
  }

  debug(
    `[bottles] all ${MAX_PICK_ATTEMPTS} placements below MIN_ACCEPTABLE_SCORE. ` +
      `best=${best ? best.score.toFixed(2) : "n/a"} rejections=`,
    reasonCounts,
  );
  return null;
}

function pickOffsetY(): number {
  const r = Math.random();
  if (r < 0.35) return 1.1 + Math.random() * 0.4; // just below
  if (r < 0.55) return 1.6 + Math.random() * 0.8; // further below
  if (r < 0.75) return -0.5 + Math.random() * 0.4; // above
  // beside the anchor (matched with wide offsetX)
  return 0.2 + Math.random() * 0.6;
}

function pickOffsetX(): number {
  const r = Math.random();
  if (r < 0.55) return 0.3 + Math.random() * 0.4; // inside the anchor
  if (r < 0.8) return -1.0 + Math.random() * 1.0; // left margin
  return 1.0 + Math.random() * 1.0; // right margin
}

/** Resolve the page position chosen at placement time. Offscreen positions are
 * still valid; null means the anchor element itself no longer exists. */
export function resolveBottlePosition(anchor: BottleAnchor): ResolvedPosition | null {
  return resolveAnchorPosition(anchor).position;
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
    x - BOTTLE_W / 2 < SAFE_EDGE_PX ||
    x + BOTTLE_W / 2 > vw - SAFE_EDGE_PX ||
    y - BOTTLE_H / 2 < SAFE_TOP_PX ||
    y + BOTTLE_H / 2 > vh - SAFE_EDGE_PX
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
  if (rect.width === 0 || rect.height === 0)
    return { position: null, reason: "zero-size" };

  const x = rect.left + rect.width * anchor.offsetX;
  const y = rect.top + rect.height * anchor.offsetY;

  const rotate =
    -15 +
    (hashStr(anchor.selector + anchor.offsetX.toFixed(2) + anchor.offsetY.toFixed(2)) % 30);

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
  // 12-point sample — denser than 9 to catch narrow text lines
  const samples: Array<[number, number]> = [
    [centerX - SAMPLE_HALF_W, centerY - SAMPLE_HALF_H],
    [centerX, centerY - SAMPLE_HALF_H],
    [centerX + SAMPLE_HALF_W, centerY - SAMPLE_HALF_H],
    [centerX - SAMPLE_HALF_W, centerY - SAMPLE_HALF_H / 2],
    [centerX + SAMPLE_HALF_W, centerY - SAMPLE_HALF_H / 2],
    [centerX - SAMPLE_HALF_W, centerY],
    [centerX, centerY],
    [centerX + SAMPLE_HALF_W, centerY],
    [centerX - SAMPLE_HALF_W, centerY + SAMPLE_HALF_H / 2],
    [centerX + SAMPLE_HALF_W, centerY + SAMPLE_HALF_H / 2],
    [centerX - SAMPLE_HALF_W, centerY + SAMPLE_HALF_H],
    [centerX, centerY + SAMPLE_HALF_H],
    [centerX + SAMPLE_HALF_W, centerY + SAMPLE_HALF_H],
  ];

  for (const [sx, sy] of samples) {
    if (!isBackgroundAt(sx, sy)) return -1;
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

  // Things we definitely shouldn't overlap, ever:
  if (
    tag === "input" ||
    tag === "textarea" ||
    tag === "button" ||
    tag === "select" ||
    tag === "a" ||
    tag === "img" ||
    tag === "video" ||
    tag === "canvas" ||
    tag === "svg" ||
    tag === "iframe" ||
    tag === "picture"
  ) {
    return false;
  }

  // p, li, h1-h6, span, etc — content elements. If they have direct text
  // at this spot, reject. (We use childNodes text content as the signal.)
  if (hasDirectText(top)) return false;

  // Element is a container. Check whether the element has rendered visible
  // content (text or media) — even if `top` is a div with no direct text,
  // if its bounding box has any text content we treat its interior as
  // not-background. This catches cases where the element has spans/links
  // inside but elementFromPoint returned the parent div.
  if (looksLikeContentContainer(top)) return false;

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
 * Heuristic for "this div is actually content, not background." True if
 * any descendant within a small radius of the sample point has visible
 * text or media. Keeps the test cheap by only looking 1-2 levels deep.
 */
function looksLikeContentContainer(el: Element): boolean {
  // Walk through child elements — if any is a content tag with non-empty
  // text, treat the container as content.
  for (const child of Array.from(el.children).slice(0, 6)) {
    const tag = child.tagName.toLowerCase();
    if (
      tag === "p" ||
      tag === "h1" ||
      tag === "h2" ||
      tag === "h3" ||
      tag === "h4" ||
      tag === "h5" ||
      tag === "h6" ||
      tag === "li" ||
      tag === "blockquote" ||
      tag === "a" ||
      tag === "img" ||
      tag === "span"
    ) {
      if ((child.textContent || "").trim().length > 0) return true;
    }
  }
  return false;
}

/**
 * Probe a grid of points across the visible viewport. For each cell that
 * is empty background, find the nearest content-anchor candidate and
 * compute the offsetX/offsetY needed to point at that cell. Returns the
 * resulting anchors in random order.
 *
 * This is the inverse of "pick anchor → guess offset": we look at where
 * empty space ACTUALLY is, then derive an anchor that encodes that
 * position relative to stable content.
 */
function anchorsFromViewportGrid(candidates: string[]): BottleAnchor[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 10x6 grid covering the viewport (skipping the very edges + top nav)
  const cols = 10;
  const rows = 6;
  const xStep = (vw - SAFE_EDGE_PX * 2) / (cols - 1);
  const yStep = (vh - SAFE_TOP_PX - SAFE_EDGE_PX) / (rows - 1);

  const clearCells: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = SAFE_EDGE_PX + c * xStep;
      const y = SAFE_TOP_PX + r * yStep;
      // Quick check: a 5-point cross sample. Cheaper than the full scoreArea.
      if (
        isBackgroundAt(x, y) &&
        isBackgroundAt(x - 12, y) &&
        isBackgroundAt(x + 12, y) &&
        isBackgroundAt(x, y - 16) &&
        isBackgroundAt(x, y + 16)
      ) {
        clearCells.push([x, y]);
      }
    }
  }

  // Build a list of anchor elements with their current rects
  const anchorRects: Array<{ selector: string; rect: DOMRect }> = [];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 8) continue;
    anchorRects.push({ selector: sel, rect });
  }
  if (anchorRects.length === 0) return [];

  // Shuffle cells so we don't always prefer top-left
  for (let i = clearCells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clearCells[i], clearCells[j]] = [clearCells[j], clearCells[i]];
  }

  const out: BottleAnchor[] = [];
  for (const [cellX, cellY] of clearCells) {
    // Find the anchor whose rect center is closest to this cell
    let bestAnchor: { selector: string; rect: DOMRect } | null = null;
    let bestDist = Infinity;
    for (const a of anchorRects) {
      const ax = a.rect.left + a.rect.width / 2;
      const ay = a.rect.top + a.rect.height / 2;
      const dx = ax - cellX;
      const dy = ay - cellY;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestAnchor = a;
      }
    }
    if (!bestAnchor) continue;
    const { selector, rect } = bestAnchor;
    const offsetX = (cellX - rect.left) / rect.width;
    const offsetY = (cellY - rect.top) / rect.height;
    out.push({ selector, offsetX, offsetY });
  }
  return out;
}

function collectAnchorCandidates(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

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

  const blocks = document.querySelectorAll<HTMLElement>(
    "p, li, h1, h2, h3, h4, blockquote, dt, dd, figcaption",
  );
  for (const el of blocks) {
    if (!isReasonableAnchor(el)) continue;
    const sel = buildStructuralSelector(el);
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

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
