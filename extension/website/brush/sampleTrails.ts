// ABOUTME: Picks a deterministic, legible handful of real trails for the comparison sheet.
// ABOUTME: Each trail is trimmed and placed in its own region so marks never pile into one blob.

import { Trail } from "../shared/types";

export interface SampleTrail {
  /** Points already trimmed, normalised and placed inside the tile. */
  points: Array<{ x: number; y: number; ts: number }>;
  clicks: Array<{ x: number; y: number }>;
  color: string;
}

/** How each candidate trail moves, used to pick a varied sample. */
type Character = "sweeping" | "curvy" | "jittery" | "hovering";

interface Candidate {
  trail: Trail;
  character: Character;
  hasClicks: boolean;
}

/**
 * One slot per character, so the sheet always shows the same spread of marks:
 * a long sweep, a curvy wander, a short jitter, a slow hover, and two extras.
 * The order is the reading order of the regions below.
 */
const SLOT_CHARACTERS: Character[] = [
  "sweeping",
  "curvy",
  "jittery",
  "hovering",
  "sweeping",
  "curvy",
];

/**
 * Regions each trail is placed into, as fractions of the tile. A loose 3x2
 * arrangement with generous gaps: the point of the sheet is judging one tool's
 * texture, which needs marks that do not cross each other.
 */
const REGIONS = [
  { x: 0.02, y: 0.04, w: 0.30, h: 0.42 },
  { x: 0.35, y: 0.02, w: 0.30, h: 0.44 },
  { x: 0.69, y: 0.05, w: 0.29, h: 0.40 },
  { x: 0.02, y: 0.53, w: 0.30, h: 0.43 },
  { x: 0.35, y: 0.52, w: 0.30, h: 0.45 },
  { x: 0.69, y: 0.54, w: 0.29, h: 0.42 },
];

/** Longest run of points kept from any one trail. */
const MAX_POINTS_PER_TRAIL = 220;
/** Control points kept after decimation, to bound per-tile draw cost. */
const MAX_CONTROL_POINTS = 110;
/** Total click marks across the whole sheet. */
const MAX_TOTAL_CLICKS = 6;

/** Site palette, used instead of raw participant colors. */
const PALETTE = [
  "#4a9a8a",
  "#c4724e",
  "#5b8db8",
  "#d4b85c",
  "#3d3833",
  "#4a9a8a",
];

const SWEEPING_PX_PER_POINT = 14;
const CURVY_PX_PER_POINT = 7;
const HOVERING_PX_PER_POINT = 3.5;

function classify(trail: Trail): Character {
  let distance = 0;
  for (let i = 1; i < trail.points.length; i++) {
    distance += Math.hypot(
      trail.points[i].x - trail.points[i - 1].x,
      trail.points[i].y - trail.points[i - 1].y,
    );
  }
  const perPoint = distance / Math.max(1, trail.points.length - 1);
  if (perPoint >= SWEEPING_PX_PER_POINT) return "sweeping";
  if (perPoint >= CURVY_PX_PER_POINT) return "curvy";
  if (perPoint <= HOVERING_PX_PER_POINT) return "hovering";
  return "jittery";
}

/**
 * Take the densest window of at most `MAX_POINTS_PER_TRAIL` points. Long
 * archive trails wander across a whole session; the busiest stretch is the part
 * worth showing, and trimming keeps each mark readable at tile scale.
 */
function trim(points: Trail["points"]): Trail["points"] {
  if (points.length <= MAX_POINTS_PER_TRAIL) return points;
  let bestStart = 0;
  let bestSpan = Infinity;
  for (let start = 0; start + MAX_POINTS_PER_TRAIL <= points.length; start += 25) {
    const end = start + MAX_POINTS_PER_TRAIL - 1;
    // Shorter elapsed time over the same point count = denser movement.
    const span = points[end].ts - points[start].ts;
    if (span < bestSpan) {
      bestSpan = span;
      bestStart = start;
    }
  }
  return points.slice(bestStart, bestStart + MAX_POINTS_PER_TRAIL);
}

/**
 * A crowded sample: many real trails kept at their REAL page coordinates and
 * fitted through one shared transform, so they overlap exactly as they did on
 * the page. This is the opposite of `pickSampleTrails` — there the point is
 * isolating one mark, here it is seeing what a full canvas looks like.
 */
export function pickDenseTrails(
  trails: Trail[],
  width: number,
  height: number,
  count = 80,
  padding = 24,
): SampleTrail[] {
  const chosen = trails
    .filter((t) => t.points.length >= 12)
    .slice(0, count);
  if (chosen.length === 0) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const trail of chosen) {
    for (const p of trail.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min(
    (width - padding * 2) / spanX,
    (height - padding * 2) / spanY,
  );
  const offsetX = padding + (width - padding * 2 - spanX * scale) / 2;
  const offsetY = padding + (height - padding * 2 - spanY * scale) / 2;
  const fitX = (x: number) => (x - minX) * scale + offsetX;
  const fitY = (y: number) => (y - minY) * scale + offsetY;

  return chosen.map((trail, index) => {
    const points = trim(trail.points);
    const step = Math.max(1, Math.ceil(points.length / MAX_CONTROL_POINTS));
    const kept = points.filter(
      (_, i) => i % step === 0 || i === points.length - 1,
    );
    return {
      points: kept.map((p) => ({ x: fitX(p.x), y: fitY(p.y), ts: p.ts })),
      // Every real click, so the crowding of the click marks is visible too.
      clicks: trail.clicks.map((c) => ({ x: fitX(c.x), y: fitY(c.y) })),
      color: PALETTE[index % PALETTE.length],
    };
  });
}

/**
 * Build the sheet's sample: one trail per region, each trimmed, normalised to
 * its own bounding box and placed in its region, recolored from the site
 * palette. Selection is deterministic — candidates keep source order and the
 * first match for each slot wins.
 */
export function pickSampleTrails(
  trails: Trail[],
  width: number,
  height: number,
): SampleTrail[] {
  const candidates: Candidate[] = trails
    .filter((t) => t.points.length >= 20)
    .map((trail) => ({
      trail,
      character: classify(trail),
      hasClicks: trail.clicks.length > 0,
    }));
  if (candidates.length === 0) return [];

  const used = new Set<Trail>();
  const chosen: Trail[] = [];
  for (const character of SLOT_CHARACTERS) {
    // Prefer a trail of this character that also carries clicks.
    const match =
      candidates.find(
        (c) => !used.has(c.trail) && c.character === character && c.hasClicks,
      ) ??
      candidates.find((c) => !used.has(c.trail) && c.character === character) ??
      candidates.find((c) => !used.has(c.trail));
    if (!match) break;
    used.add(match.trail);
    chosen.push(match.trail);
  }

  let clickBudget = MAX_TOTAL_CLICKS;

  return chosen.map((trail, index) => {
    const region = REGIONS[index % REGIONS.length];
    const points = trim(trail.points);

    // Normalise this trail against ITS OWN bounds, so every trail fills its
    // region regardless of where it happened to live on the page.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);

    const boxX = region.x * width;
    const boxY = region.y * height;
    const boxW = region.w * width;
    const boxH = region.h * height;
    // One uniform scale keeps the trail's real proportions; it is then centred
    // in its region rather than stretched to fill it.
    const scale = Math.min(boxW / spanX, boxH / spanY);
    const offsetX = boxX + (boxW - spanX * scale) / 2;
    const offsetY = boxY + (boxH - spanY * scale) / 2;
    const fitX = (x: number) => (x - minX) * scale + offsetX;
    const fitY = (y: number) => (y - minY) * scale + offsetY;

    // Decimate to bound draw cost, always keeping the first and last point.
    const step = Math.max(1, Math.ceil(points.length / MAX_CONTROL_POINTS));
    const kept = points.filter(
      (_, i) => i % step === 0 || i === points.length - 1,
    );

    // Spread the click budget: at most one mark per trail, so a reader can
    // judge the click style on its own rather than in a cluster.
    const clicks: Array<{ x: number; y: number }> = [];
    if (clickBudget > 0) {
      const first = trail.clicks.find(
        (c) =>
          c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY,
      );
      // Fall back to a point along the trail so every region shows a click.
      const anchor = first ?? points[Math.floor(points.length / 2)];
      clicks.push({ x: fitX(anchor.x), y: fitY(anchor.y) });
      clickBudget--;
    }

    return {
      points: kept.map((p) => ({ x: fitX(p.x), y: fitY(p.y), ts: p.ts })),
      clicks,
      color: PALETTE[index % PALETTE.length],
    };
  });
}
