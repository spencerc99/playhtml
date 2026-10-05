// ABOUTME: Casts scraps into collage roles from Clef's answers, then places them free-form or inside a silhouette.
// ABOUTME: Also writes placements out as a collage file the real scraps editor can open.

import { encodeCollageFile } from "@extension/entrypoints/scraps/collageFile";
import {
  COLLAGE_FORMATS,
  DEFAULT_PAPER,
  type CollageFormatName,
} from "@extension/entrypoints/scraps/collageFormats";
import {
  createCollageId,
  createPieceId,
  type CollagePiece,
  type CollageRecord,
} from "@extension/entrypoints/scraps/collageRecord";
import { pack, type PackPiece, type PackRegion } from "./packer";
import { ROLES, type ImageScrap, type Role, type ScrapAnswers } from "./questions";

export interface Judged {
  scrap: ImageScrap;
  answers: ScrapAnswers;
}

/** The part of a source image a piece shows, as shares of its width and height. */
export interface CropShare {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placement {
  /** Unique per placement; a repeated accent places the same scrap several times. */
  key: string;
  scrap: ImageScrap;
  answers: ScrapAnswers;
  /** Top-left of the unrotated box, in frame units, as collage pieces store it. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees about the box center. */
  rotation: number;
  z: number;
  cutout: boolean;
  /** Edge tolerance the cutout uses, carried into the exported collage. */
  tolerance: number;
  /** The part this piece plays, cast from Clef's role odds. */
  role: Role;
  /** Each step from an answer to this placement, in plain words, for the trace view. */
  trace: string[];
  /** Present when the piece shows only part of its image, as a wallpaper tile does. */
  crop?: CropShare;
}

export interface Frame {
  width: number;
  height: number;
}

export function frameOf(format: CollageFormatName): Frame {
  const { width, height } = COLLAGE_FORMATS[format];
  return { width, height };
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/**
 * A random stream owned by one piece for one purpose. Each piece's tilt,
 * region roll, and stacking noise depend only on that piece and the seed, so
 * answers arriving for other pieces never reshuffle it.
 */
function pieceRandom(scrap: ImageScrap, seed: number, purpose: string): () => number {
  return seededRandom(hashId(`${purpose}:${scrap.id}`) ^ seed);
}


/** Settings for turning roles into sizes. Clef decides who plays which role; these decide how big each role is. */
export interface RoleSizing {
  /** How many pieces become heroes, taken in order of hero strength. */
  heroCount: number;
  /** A hero's long side, as a share of the canvas (or the shape) short side. */
  heroSide: number;
  /** An accent's long side, as a share of the same short side. */
  accentSide: number;
  /** How steeply supporting pieces shrink from strongest to weakest; 0 makes them equal. */
  contrast: number;
}

export interface Cast {
  item: Judged;
  role: Role;
  /** Strength within the role, used to order heroes and size supporting pieces. */
  strength: number;
  why: string;
}

export interface Casting {
  cast: Cast[];
}

function roleOdds(answers: ScrapAnswers): string {
  return (Object.keys(ROLES) as Role[])
    .map((role) => [role, answers.role.probabilities[role] ?? 0] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([role, p]) => `${role} ${(p * 100).toFixed(0)}%`)
    .join(", ");
}

function topRole(answers: ScrapAnswers): Role {
  let best: Role = "supporting";
  for (const role of Object.keys(ROLES) as Role[]) {
    if ((answers.role.probabilities[role] ?? 0) > (answers.role.probabilities[best] ?? 0)) best = role;
  }
  return best;
}

/**
 * Who plays which part. Heroes are the strongest hero candidates: by the
 * side-by-side contest when one ran, otherwise by Clef's hero odds. Everyone
 * else takes their top role. Nothing is left out; a weak image just never
 * becomes a hero.
 */
export function castRoles(
  items: Judged[],
  sizing: RoleSizing,
  /** Contest strength per scrap id, from 0 to 1, when the hero contest has run. */
  contest?: Map<string, number>,
): Casting {
  const heroStrength = (item: Judged) => contest?.get(item.scrap.id) ?? item.answers.role.probabilities.hero ?? 0;
  const heroOrder = [...items].sort(
    (a, b) => heroStrength(b) - heroStrength(a) || a.scrap.id.localeCompare(b.scrap.id),
  );
  const heroes = new Set(heroOrder.slice(0, sizing.heroCount).map((item) => item.scrap.id));

  const cast = items.map((item): Cast => {
    const odds = `role: Clef's odds ${roleOdds(item.answers)}`;
    const p = item.answers.role.probabilities;
    if (heroes.has(item.scrap.id)) {
      const rank = heroOrder.indexOf(item) + 1;
      const by = contest?.has(item.scrap.id)
        ? `won ${(heroStrength(item) * 100).toFixed(0)}% of its side-by-side contests`
        : `hero odds ${((p.hero ?? 0) * 100).toFixed(0)}%`;
      return { item, role: "hero", strength: heroStrength(item), why: `${odds} -> hero ${rank} of ${heroes.size} (${by})` };
    }
    const top = topRole(item.answers);
    if (top === "background") return { item, role: "background", strength: p.background ?? 0, why: `${odds} -> background` };
    if (top === "accent") return { item, role: "accent", strength: p.accent ?? 0, why: `${odds} -> accent` };
    return {
      item,
      role: "supporting",
      strength: (p.supporting ?? 0) + (p.hero ?? 0),
      why: `${odds} -> supporting${top === "hero" ? " (a hero pick, but outside the top heroes)" : ""}`,
    };
  });
  return { cast };
}

function boxOfLongSide(item: Judged, long: number) {
  const aspect = item.scrap.naturalWidth / item.scrap.naturalHeight;
  return aspect >= 1 ? { width: long, height: long / aspect } : { width: long * aspect, height: long };
}

function boxOfArea(item: Judged, area: number) {
  const aspect = item.scrap.naturalWidth / item.scrap.naturalHeight;
  const width = Math.sqrt(area * aspect);
  return { width, height: area / width };
}

/** Supporting pieces share an area, the strongest getting the most. */
function supportingBoxes(cast: Cast[], area: number, maxSide: number, contrast: number) {
  const order = [...cast].sort((a, b) => b.strength - a.strength || a.item.scrap.id.localeCompare(b.item.scrap.id));
  const n = order.length;
  const weight = (rank: number) => Math.exp(contrast * (n <= 1 ? 1 : 1 - rank / (n - 1)));
  let sum = 0;
  for (let rank = 0; rank < n; rank += 1) sum += weight(rank);
  const boxes = new Map<string, { width: number; height: number; why: string }>();
  order.forEach((member, rank) => {
    let { width, height } = boxOfArea(member.item, (area * weight(rank)) / sum);
    const fit = Math.min(1, maxSide / Math.max(width, height));
    width *= fit;
    height *= fit;
    boxes.set(member.item.scrap.id, {
      width,
      height,
      why:
        `size: supporting ${rank + 1} of ${n} by strength -> ${((weight(rank) / sum) * 100).toFixed(1)}% of the supporting area -> ` +
        `${Math.round(width)}x${Math.round(height)}px` + (fit < 1 ? ` (shrunk to the ${Math.round(maxSide)}px cap)` : ""),
    });
  });
  return boxes;
}

/** How pieces are cut and turned, shared by every layout. */
export interface PieceRules {
  cutoutThreshold: number;
  /** Cut every piece out, whatever Clef said, for a Wiki Spy look. */
  cutAll: boolean;
  toleranceFor: (scrap: ImageScrap) => number;
  /** Largest rotation either way, in degrees. Chosen by code, not Clef. */
  maxRotation: number;
}

/** Heroes are always cut out so they stand off the page; the rest follow Clef or the cut-all switch. */
function isCut(member: Cast, rules: PieceRules): boolean {
  return member.role === "hero" || rules.cutAll || member.item.answers.cutout.noul >= rules.cutoutThreshold;
}

/** A piece's own random angle within the allowed range, stable across rerenders. */
function angleFor(scrap: ImageScrap, seed: number, maxRotation: number, damping = 1): number {
  return (pieceRandom(scrap, seed, "tilt")() * 2 - 1) * maxRotation * damping;
}

function rotationWhy(degrees: number, rules: PieceRules, packed: boolean): string {
  return packed
    ? `rotation (code, not Clef): tried a few random angles within +/-${rules.maxRotation} degrees, ${degrees.toFixed(1)} fit best`
    : `rotation (code, not Clef): random within +/-${rules.maxRotation} degrees -> ${degrees.toFixed(1)}`;
}

function cutoutWhy(member: Cast, rules: PieceRules): string {
  const { answers } = member.item;
  if (member.role === "hero") return "cutout: heroes are always cut out";
  if (rules.cutAll) return "cutout: every piece is cut out";
  const yes = answers.cutout.noul >= rules.cutoutThreshold;
  return `cutout: Clef says yes ${(answers.cutout.noul * 100).toFixed(0)}% ${yes ? ">=" : "<"} ${(rules.cutoutThreshold * 100).toFixed(0)}% threshold -> ${yes ? "cut out" : "keep the rectangle"}`;
}

/** Stack order: backgrounds at the back, then supporting, heroes, and accents on top. */
const ROLE_LAYER: Record<Cast["role"], number> = { background: 0, supporting: 1, hero: 2, accent: 3 };

function stackOrder(cast: Cast[], seed: number): Map<string, number> {
  const keys = cast.map((member) => ({
    id: member.item.scrap.id,
    key: ROLE_LAYER[member.role] * 10 + pieceRandom(member.item.scrap, seed, "layer")(),
  }));
  keys.sort((a, b) => a.key - b.key);
  return new Map(keys.map(({ id }, z) => [id, z]));
}

/**
 * Each later hero is smaller than the one before, so one subject leads and
 * the others support it instead of competing at the same size.
 */
const HERO_SCALE = [1, 0.75, 0.6, 0.5, 0.45, 0.4, 0.36, 0.33];

function heroLong(rank: number, sizing: RoleSizing, reference: number): number {
  return sizing.heroSide * reference * HERO_SCALE[Math.min(rank, HERO_SCALE.length - 1)];
}

/**
 * Composition templates: where heroes sit, as shares of the area, biggest
 * hero first. Two heroes balance across a diagonal, three make a triangle,
 * four take the rule-of-thirds crossings. Extras go to the middle and edges.
 */
const HERO_TEMPLATES: { name: string; spots: [number, number][] }[] = [
  { name: "on a rule-of-thirds point", spots: [[0.36, 0.4]] },
  { name: "across a diagonal", spots: [[0.3, 0.33], [0.7, 0.68]] },
  { name: "in a triangle", spots: [[0.3, 0.33], [0.72, 0.36], [0.52, 0.72]] },
  { name: "on the four rule-of-thirds points", spots: [[1 / 3, 1 / 3], [2 / 3, 2 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3]] },
];
const EXTRA_HERO_SPOTS: [number, number][] = [[0.5, 0.5], [0.5, 0.15], [0.15, 0.5], [0.85, 0.5]];

/** Where each hero goes, by rank, mirrored by the seed so rerolls vary. */
export function heroSpots(count: number, seed: number): { x: number; y: number; why: string }[] {
  if (count === 0) return [];
  const template = HERO_TEMPLATES[Math.min(count, HERO_TEMPLATES.length) - 1];
  const spots = [...template.spots, ...EXTRA_HERO_SPOTS].slice(0, count);
  const random = seededRandom(seed ^ 0x5eed);
  const flipX = random() < 0.5;
  const flipY = random() < 0.5;
  return spots.map(([x, y], rank) => ({
    x: flipX ? 1 - x : x,
    y: flipY ? 1 - y : y,
    why:
      rank < template.spots.length
        ? `position: hero ${rank + 1} of ${count}, heroes placed ${template.name} so they balance rather than crowd`
        : `position: hero ${rank + 1}, past the template, in the middle or along an edge`,
  }));
}

/** Backgrounds barely turn; accents turn the most. */
const ROTATION_DAMPING: Record<Cast["role"], number> = { background: 0.3, supporting: 1, hero: 0.7, accent: 1 };

function placement(
  member: Cast,
  box: { width: number; height: number },
  center: { x: number; y: number },
  z: number,
  seed: number,
  rules: PieceRules,
  steps: string[],
  /** The angle a packing chose; otherwise the piece's own random angle. */
  packedRotation?: number,
): Placement {
  const { item } = member;
  const degrees = packedRotation ?? angleFor(item.scrap, seed, rules.maxRotation, ROTATION_DAMPING[member.role]);
  return {
    key: item.scrap.id,
    scrap: item.scrap,
    answers: item.answers,
    x: center.x - box.width / 2,
    y: center.y - box.height / 2,
    width: box.width,
    height: box.height,
    rotation: degrees,
    z,
    cutout: isCut(member, rules),
    tolerance: rules.toleranceFor(item.scrap),
    role: member.role,
    trace: [member.why, ...steps, rotationWhy(degrees, rules, packedRotation !== undefined), cutoutWhy(member, rules)],
  };
}

/** A cut-out's own silhouette, for packing by its real outline. */
export type OutlineOf = (scrap: ImageScrap) => { mask: Uint8ClampedArray; width: number; height: number } | null;

export interface PackedLayout {
  placements: Placement[];
  coverage: number;
  /** Pieces that found no room even after shrinking. */
  skipped: Cast[];
}

/**
 * Packs cast members snugly into a region by their outlines: heroes first
 * in the deepest free space, then supporting pieces biggest first, then
 * accents into the crevices left over.
 */
function packCast(
  region: PackRegion,
  cast: Cast[],
  boxes: Map<string, { width: number; height: number }>,
  sizeNotes: Map<string, string>,
  seed: number,
  rules: PieceRules,
  outlineOf: OutlineOf,
  gap: number,
  /** Where each hero should go, by rank, in grid cells. */
  heroNear: (rank: number) => { x: number; y: number; radius: number; why: string } | undefined,
): PackedLayout {
  const order = [
    ...cast.filter((m) => m.role === "hero").sort((a, b) => b.strength - a.strength),
    ...cast
      .filter((m) => m.role === "supporting" || m.role === "background")
      .sort((a, b) => {
        const ba = boxes.get(a.item.scrap.id) as { width: number; height: number };
        const bb = boxes.get(b.item.scrap.id) as { width: number; height: number };
        return bb.width * bb.height - ba.width * ba.height;
      }),
    ...cast.filter((m) => m.role === "accent"),
  ];
  const heroRank = new Map(order.filter((m) => m.role === "hero").map((m, rank) => [m.item.scrap.id, rank]));
  const pieces: PackPiece[] = order.map((member) => {
    const box = boxes.get(member.item.scrap.id) as { width: number; height: number };
    const base = angleFor(member.item.scrap, seed, rules.maxRotation, ROTATION_DAMPING[member.role]);
    const other = angleFor(member.item.scrap, seed + 7919, rules.maxRotation, ROTATION_DAMPING[member.role]);
    return {
      id: member.item.scrap.id,
      width: box.width,
      height: box.height,
      outline: isCut(member, rules) ? outlineOf(member.item.scrap) : null,
      angles: rules.maxRotation === 0 ? [0] : [base, other, base * 0.3],
      deep: member.role === "hero",
      ...(member.role === "hero" ? { near: heroNear(heroRank.get(member.item.scrap.id) as number) } : {}),
    };
  });
  const result = pack(region, pieces, { random: seededRandom(seed), tries: 36, gap });
  const z = stackOrder(cast, seed);
  const placements: Placement[] = [];
  for (const member of order) {
    const spot = result.placed.get(member.item.scrap.id);
    if (!spot) continue;
    const notes = [sizeNotes.get(member.item.scrap.id) ?? ""];
    if (spot.shrink < 1) notes.push(`size: shrunk to ${Math.round(spot.shrink * 100)}% to find room`);
    const target = member.role === "hero" ? heroNear(heroRank.get(member.item.scrap.id) as number) : undefined;
    if (target) notes.push(target.why);
    notes.push(
      `position (code, not Clef): packed by its ${isCut(member, rules) && outlineOf(member.item.scrap) ? "cut-out outline" : "rectangle"} ` +
        `into the ${target ? "free space nearest its composition spot" : "snuggest free spot"} it fit; ${(spot.clash * 100).toFixed(0)}% of it overlaps`,
    );
    placements.push(
      placement(member, { width: spot.width, height: spot.height }, spot, z.get(member.item.scrap.id) as number, seed, rules, notes, spot.rotation),
    );
  }
  return {
    placements,
    coverage: result.coverage,
    skipped: order.filter((m) => !result.placed.has(m.item.scrap.id)),
  };
}

export interface FreeLayoutOptions extends PieceRules {
  seed: number;
  /** Total piece area as a share of the frame; above 1 means pieces overlap. */
  density: number;
  sizing: RoleSizing;
  /** Pushes overlapping supporting pieces apart this many rounds. */
  spreadRounds: number;
  /** "gather" piles pieces around the heroes; "pack" fits them snugly edge to edge. */
  arrangement: "layered" | "gather" | "pack";
  /** Layered: how many images tile the wallpaper behind everything. */
  wallpaperTiles: number;
  /** Layered: the most times one accent repeats in its little row or grid. */
  accentRepeats: number;
  /** Layered: how many supporting pieces sit over the wallpaper, strongest first; the rest stay out. */
  layeredSupporting: number;
  /** Layered: area the heroes and supporting pieces take, as a share of the canvas, so the wallpaper shows. */
  layeredDensity: number;
  outlineOf: OutlineOf;
  visibleShare: (scrap: ImageScrap) => number;
  /** Empty grid cells kept between packed pieces. */
  gap: number;
}

/** Grid columns a packed canvas is measured in. */
const PACK_COLUMNS = 220;


export function freeLayout(casting: Casting, frame: Frame, options: FreeLayoutOptions): PackedLayout {
  const { cast } = casting;
  const { sizing, seed } = options;
  const short = Math.min(frame.width, frame.height);
  if (options.arrangement === "pack") return packFree(cast, frame, options);
  if (options.arrangement === "layered") return layeredFree(cast, frame, options);
  const clamp = (center: { x: number; y: number }, box: { width: number; height: number }) => ({
    x: Math.max(box.width * 0.3, Math.min(frame.width - box.width * 0.3, center.x)),
    y: Math.max(box.height * 0.3, Math.min(frame.height - box.height * 0.3, center.y)),
  });

  const boxes = new Map<string, { width: number; height: number }>();
  const centers = new Map<string, { x: number; y: number }>();
  const steps = new Map<string, string[]>();
  const say = (member: Cast, line: string) => steps.set(member.item.scrap.id, [...(steps.get(member.item.scrap.id) ?? []), line]);

  const heroes = cast.filter((m) => m.role === "hero").sort((a, b) => b.strength - a.strength);
  const spots = heroSpots(heroes.length, seed);
  heroes.forEach((member, i) => {
    const long = heroLong(i, sizing, short);
    const box = boxOfLongSide(member.item, long);
    const own = pieceRandom(member.item.scrap, seed, "place");
    const spot = spots[i];
    const center = clamp({ x: spot.x * frame.width + (own() - 0.5) * 0.04 * frame.width, y: spot.y * frame.height + (own() - 0.5) * 0.04 * frame.height }, box);
    boxes.set(member.item.scrap.id, box);
    centers.set(member.item.scrap.id, center);
    say(member, `size: hero ${i + 1} -> long side ${Math.round(long)}px (each later hero smaller, so one leads)`);
    say(member, spot.why);
  });

  const backgrounds = cast.filter((m) => m.role === "background");
  backgrounds.forEach((member) => {
    const long = Math.min(sizing.heroSide * 1.7, 0.95) * short;
    const box = boxOfLongSide(member.item, long);
    const own = pieceRandom(member.item.scrap, seed, "place");
    const center = clamp({ x: (0.2 + own() * 0.6) * frame.width, y: (0.2 + own() * 0.6) * frame.height }, box);
    boxes.set(member.item.scrap.id, box);
    centers.set(member.item.scrap.id, center);
    say(member, `size: background -> large, long side ${Math.round(long)}px`);
    say(member, "position: background -> a random spot near the middle, at the back of the stack");
  });

  const supporting = cast.filter((m) => m.role === "supporting");
  const reserved = [...heroes, ...backgrounds].reduce((sum, m) => {
    const box = boxes.get(m.item.scrap.id) as { width: number; height: number };
    return sum + box.width * box.height * (m.role === "background" ? 0.5 : 1);
  }, 0);
  const budget = Math.max(frame.width * frame.height * options.density - reserved, (frame.width * frame.height * options.density) / 3);
  const supportBoxes = supportingBoxes(supporting, budget, sizing.heroSide * short * 0.9, sizing.contrast);
  const anchors = heroes.length > 0 ? heroes : backgrounds;
  supporting.forEach((member) => {
    const { why, ...box } = supportBoxes.get(member.item.scrap.id) as { width: number; height: number; why: string };
    const own = pieceRandom(member.item.scrap, seed, "place");
    let center: { x: number; y: number };
    if (anchors.length > 0) {
      const anchor = anchors[Math.floor(own() * anchors.length)];
      const at = centers.get(anchor.item.scrap.id) as { x: number; y: number };
      const anchorBox = boxes.get(anchor.item.scrap.id) as { width: number; height: number };
      const angle = own() * Math.PI * 2;
      const reach = (Math.hypot(anchorBox.width, anchorBox.height) + Math.hypot(box.width, box.height)) * 0.38 * (0.8 + own() * 0.8);
      center = clamp({ x: at.x + Math.cos(angle) * reach, y: at.y + Math.sin(angle) * reach }, box);
      say(member, why);
      say(member, `position: supporting -> gathered around ${anchor.role} "${(anchor.item.scrap.alt || anchor.item.scrap.pageTitle).slice(0, 40)}", random angle`);
    } else {
      center = clamp({ x: own() * frame.width, y: own() * frame.height }, box);
      say(member, why);
      say(member, "position: supporting -> no hero to gather around, so a random spot");
    }
    boxes.set(member.item.scrap.id, box);
    centers.set(member.item.scrap.id, center);
  });

  // Only supporting pieces are pushed apart; heroes stay on their strong points.
  for (let round = 0; round < options.spreadRounds; round += 1) {
    for (let a = 0; a < supporting.length; a += 1) {
      for (let b = 0; b < cast.length; b += 1) {
        const one = supporting[a];
        const other = cast[b];
        if (one === other || other.role === "background") continue;
        const ca = centers.get(one.item.scrap.id) as { x: number; y: number };
        const cb = centers.get(other.item.scrap.id) as { x: number; y: number };
        const ba = boxes.get(one.item.scrap.id) as { width: number; height: number };
        const bb = boxes.get(other.item.scrap.id);
        if (!bb) continue;
        const dx = ca.x - cb.x;
        const dy = ca.y - cb.y;
        const overlapX = (ba.width + bb.width) / 2 - Math.abs(dx);
        const overlapY = (ba.height + bb.height) / 2 - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const push = Math.min(overlapX, overlapY) * 0.12;
        const length = Math.hypot(dx, dy) || 1;
        centers.set(one.item.scrap.id, clamp({ x: ca.x + (dx / length) * push, y: ca.y + (dy / length) * push }, ba));
      }
    }
  }

  const accents = cast.filter((m) => m.role === "accent");
  const placedSoFar = [...heroes, ...supporting];
  accents.forEach((member) => {
    const own = pieceRandom(member.item.scrap, seed, "place");
    const long = sizing.accentSide * short * (0.75 + own() * 0.5);
    const box = boxOfLongSide(member.item, long);
    let center: { x: number; y: number };
    if (placedSoFar.length > 0 && own() < 0.65) {
      const host = placedSoFar[Math.floor(own() * placedSoFar.length)];
      const at = centers.get(host.item.scrap.id) as { x: number; y: number };
      const hostBox = boxes.get(host.item.scrap.id) as { width: number; height: number };
      const cx = own() < 0.5 ? -1 : 1;
      const cy = own() < 0.5 ? -1 : 1;
      center = clamp({ x: at.x + (cx * hostBox.width) / 2, y: at.y + (cy * hostBox.height) / 2 }, box);
      say(member, `size: accent -> small, long side ${Math.round(long)}px`);
      say(member, `position: accent -> pinned over a corner of ${host.role} "${(host.item.scrap.alt || host.item.scrap.pageTitle).slice(0, 40)}"`);
    } else {
      const side = Math.floor(own() * 4);
      const along = own();
      const band = 0.08;
      const edge = [
        { x: along, y: band },
        { x: 1 - band, y: along },
        { x: along, y: 1 - band },
        { x: band, y: along },
      ][side];
      center = clamp({ x: edge.x * frame.width, y: edge.y * frame.height }, box);
      say(member, `size: accent -> small, long side ${Math.round(long)}px`);
      say(member, "position: accent -> tucked along an edge of the canvas");
    }
    boxes.set(member.item.scrap.id, box);
    centers.set(member.item.scrap.id, center);
  });

  const z = stackOrder(cast, seed);
  return {
    placements: cast.map((member) =>
      placement(
        member,
        boxes.get(member.item.scrap.id) as { width: number; height: number },
        centers.get(member.item.scrap.id) as { x: number; y: number },
        z.get(member.item.scrap.id) as number,
        seed,
        options,
        steps.get(member.item.scrap.id) ?? [],
      ),
    ),
    coverage: 0,
    skipped: [],
  };
}

/**
 * Role sizes for packing: heroes and accents at fixed sizes, supporting
 * pieces sharing what is left of the area, each cut-out grown so the part
 * that shows matches its share.
 */
function packSizes(
  cast: Cast[],
  area: number,
  reference: number,
  options: { sizing: RoleSizing; visibleShare: (scrap: ImageScrap) => number } & PieceRules,
) {
  const { sizing } = options;
  const boxes = new Map<string, { width: number; height: number }>();
  const notes = new Map<string, string>();
  const share = (member: Cast) =>
    isCut(member, options) ? Math.min(1, Math.max(0.15, options.visibleShare(member.item.scrap))) : 1;
  let reserved = 0;
  const heroRank = new Map(
    cast.filter((m) => m.role === "hero").sort((a, b) => b.strength - a.strength).map((m, rank) => [m.item.scrap.id, rank]),
  );
  for (const member of cast) {
    if (member.role !== "hero" && member.role !== "accent") continue;
    const long = member.role === "hero"
      ? heroLong(heroRank.get(member.item.scrap.id) as number, sizing, reference)
      : sizing.accentSide * reference;
    const box = boxOfLongSide(member.item, long);
    boxes.set(member.item.scrap.id, box);
    notes.set(member.item.scrap.id, `size: ${member.role} -> long side ${Math.round(long)}px`);
    reserved += box.width * box.height * share(member);
  }
  const rest = cast.filter((m) => m.role === "supporting" || m.role === "background");
  const supportBoxes = supportingBoxes(rest, Math.max(area - reserved, area / 3), reference * 0.45, sizing.contrast);
  for (const member of rest) {
    const { why, ...box } = supportBoxes.get(member.item.scrap.id) as { width: number; height: number; why: string };
    const grow = Math.min(1 / Math.sqrt(share(member)), (reference * 0.45) / Math.max(box.width, box.height));
    boxes.set(member.item.scrap.id, grow > 1 ? { width: box.width * grow, height: box.height * grow } : box);
    notes.set(member.item.scrap.id, grow > 1 ? `${why}; grown ${grow.toFixed(2)}x since its cut-out shows ${Math.round(share(member) * 100)}% of its box` : why);
  }
  return { boxes, notes };
}

function packFree(cast: Cast[], frame: Frame, options: FreeLayoutOptions): PackedLayout {
  const scale = frame.width / PACK_COLUMNS;
  const rows = Math.round(frame.height / scale);
  // Inside a packed page there is nothing to sit behind, so a background plays supporting.
  const members = cast.map((m): Cast => (m.role === "background" ? { ...m, role: "supporting", why: `${m.why}; packed, it plays supporting` } : m));
  const { boxes, notes } = packSizes(members, frame.width * frame.height * options.density, Math.min(frame.width, frame.height), options);
  const region: PackRegion = {
    mask: new Uint8ClampedArray(PACK_COLUMNS * rows).fill(255),
    width: PACK_COLUMNS,
    height: rows,
    scale,
    offsetX: 0,
    offsetY: 0,
  };
  const heroCount = members.filter((m) => m.role === "hero").length;
  const spots = heroSpots(heroCount, options.seed);
  return packCast(region, members, boxes, notes, options.seed, options, options.outlineOf, options.gap, (rank) => {
    const spot = spots[rank];
    return spot && { x: spot.x * PACK_COLUMNS, y: spot.y * rows, radius: 0.06 * Math.min(PACK_COLUMNS, rows), why: spot.why };
  });
}

/** A rectangle of the canvas, in frame pixels. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Splits a rectangle into one cell per weight, cutting across the longer
 * side so each cell's area follows its weight, nudged so tiles vary.
 */
function tileRects(rect: Rect, weights: number[], random: () => number): Rect[] {
  if (weights.length <= 1) return [rect];
  const firstCount = Math.floor(weights.length / 2);
  const total = weights.reduce((a, b) => a + b, 0);
  const firstWeight = weights.slice(0, firstCount).reduce((a, b) => a + b, 0);
  const share = Math.min(0.82, Math.max(0.18, (firstWeight / total) * (0.85 + random() * 0.3)));
  const [first, rest] = [weights.slice(0, firstCount), weights.slice(firstCount)];
  if (rect.width >= rect.height) {
    const w = rect.width * share;
    return [
      ...tileRects({ x: rect.x, y: rect.y, width: w, height: rect.height }, first, random),
      ...tileRects({ x: rect.x + w, y: rect.y, width: rect.width - w, height: rect.height }, rest, random),
    ];
  }
  const h = rect.height * share;
  return [
    ...tileRects({ x: rect.x, y: rect.y, width: rect.width, height: h }, first, random),
    ...tileRects({ x: rect.x, y: rect.y + h, width: rect.width, height: rect.height - h }, rest, random),
  ];
}

/** The crop that fills a cell with an image without stretching it, sliding to a random part of the image. */
function coverCrop(item: Judged, cell: Rect, random: () => number): CropShare {
  const imageAspect = item.scrap.naturalWidth / item.scrap.naturalHeight;
  const cellAspect = cell.width / cell.height;
  if (imageAspect > cellAspect) {
    const width = cellAspect / imageAspect;
    return { x: random() * (1 - width), y: 0, width, height: 1 };
  }
  const height = imageAspect / cellAspect;
  return { x: 0, y: random() * (1 - height), width: 1, height };
}

/** Fewest wallpaper tiles; below this, supporting pieces are drafted in to cover the canvas. */
const MIN_WALLPAPER = 3;

/** Accent repeats lie in a row, a column, or a small grid. */
const REPEAT_PATTERNS = ["row", "column", "grid"] as const;

/**
 * The layered collage, after collages that start from a full-bleed
 * wallpaper of photos, set a few big cut-out heroes on top, pack supporting
 * pieces around them, and scatter small accents, each repeated like a
 * sticker sheet.
 */
function layeredFree(cast: Cast[], frame: Frame, options: FreeLayoutOptions): PackedLayout {
  const { seed, sizing } = options;
  const random = seededRandom(seed ^ 0x1a7e);
  const short = Math.min(frame.width, frame.height);

  // 1. Wallpaper: every background Clef found, strongest getting the most
  // room, laid edge to edge. Supporting pieces top it up only when there are
  // too few backgrounds to cover the canvas.
  const byBackground = (a: Cast, b: Cast) =>
    (b.item.answers.role.probabilities.background ?? 0) - (a.item.answers.role.probabilities.background ?? 0);
  const backgrounds = cast.filter((m) => m.role === "background").sort(byBackground).slice(0, options.wallpaperTiles);
  const topUp = cast
    .filter((m) => m.role === "supporting")
    .sort(byBackground)
    .slice(0, Math.max(0, Math.min(MIN_WALLPAPER, options.wallpaperTiles) - backgrounds.length));
  const wallCandidates = [...backgrounds, ...topUp];
  const wallIds = new Set(wallCandidates.map((m) => m.item.scrap.id));
  const weights = wallCandidates.map((m) => 0.4 + (m.item.answers.role.probabilities.background ?? 0));
  const cells = tileRects({ x: 0, y: 0, width: frame.width, height: frame.height }, weights, random);
  // Tiles are pasted down rather than gridded: each a little oversized and
  // turned, overlapping its neighbors in a random order.
  const pasteOrder = wallCandidates.map((_, i) => ({ i, key: random() })).sort((a, b) => a.key - b.key);
  const zOf = new Map(pasteOrder.map(({ i }, z) => [i, z]));
  const wallpaper: Placement[] = wallCandidates.map((member, i) => {
    const own = pieceRandom(member.item.scrap, seed, "wallpaper");
    const grow = 1.04 + own() * 0.14;
    const cell = cells[i];
    const box = {
      x: cell.x + cell.width / 2 - (cell.width * grow) / 2,
      y: cell.y + cell.height / 2 - (cell.height * grow) / 2,
      width: cell.width * grow,
      height: cell.height * grow,
    };
    const turn = (own() - 0.5) * 2 * Math.min(options.maxRotation, 4);
    return {
      key: member.item.scrap.id,
      scrap: member.item.scrap,
      answers: member.item.answers,
      ...box,
      rotation: turn,
      z: zOf.get(i) as number,
      cutout: false,
      tolerance: options.toleranceFor(member.item.scrap),
      role: "background",
      crop: coverCrop(member.item, box, random),
      trace: [
        member.role === "background" ? member.why : `${member.why}; drafted into the wallpaper because there were too few backgrounds`,
        `size and position (code, not Clef): wallpaper tile ${i + 1} of ${wallCandidates.length}, sized by its background odds, ` +
          `then grown ${Math.round((grow - 1) * 100)}% and turned ${turn.toFixed(1)} degrees so the tiles overlap like pasted paper`,
        "crop: cropped to fill its tile without stretching, never cut out",
      ],
    };
  });

  // 2 and 3. Heroes on the composition template, supporting pieces packed
  // snugly around them, leaving some wallpaper showing.
  // Only the strongest supporting pieces go on top, so the wallpaper and the
  // heroes stay readable, as in collages built from a few strong layers.
  const supporting = cast
    .filter((m) => !wallIds.has(m.item.scrap.id) && (m.role === "supporting" || m.role === "background"))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, options.layeredSupporting)
    .map((m): Cast => (m.role === "background" ? { ...m, role: "supporting", why: `${m.why}; the wallpaper is full, so it plays supporting` } : m));
  const packedCast = [...cast.filter((m) => m.role === "hero"), ...supporting];
  const packed = packFree(packedCast, frame, { ...options, density: options.layeredDensity });
  const packedPlacements = packed.placements
    .sort((a, b) => a.z - b.z)
    .map((placement, i) => ({ ...placement, z: wallpaper.length + i }));

  // 4. Accents: small, each repeated in a row, a column, or a little grid.
  const accents = cast.filter((m) => m.role === "accent");
  let z = wallpaper.length + packedPlacements.length;
  const accentPlacements: Placement[] = [];
  for (const member of accents) {
    const own = pieceRandom(member.item.scrap, seed, "repeat");
    const repeats = 1 + Math.floor(own() * options.accentRepeats);
    const pattern = REPEAT_PATTERNS[Math.floor(own() * REPEAT_PATTERNS.length)];
    const box = boxOfLongSide(member.item, sizing.accentSide * short * (0.75 + own() * 0.5));
    const columns = pattern === "column" ? 1 : pattern === "row" ? repeats : Math.ceil(Math.sqrt(repeats));
    const rows = Math.ceil(repeats / columns);
    const stepX = box.width * 1.12;
    const stepY = box.height * 1.12;
    const startX = box.width / 2 + own() * Math.max(0, frame.width - stepX * columns);
    const startY = box.height / 2 + own() * Math.max(0, frame.height - stepY * rows);
    const angle = angleFor(member.item.scrap, seed, options.maxRotation, 0.6);
    for (let n = 0; n < repeats; n += 1) {
      const col = n % columns;
      const row = Math.floor(n / columns);
      const one = placement(member, box, { x: startX + col * stepX, y: startY + row * stepY }, z, seed, options, [
        `size: accent -> small, long side ${Math.round(Math.max(box.width, box.height))}px`,
        `position (code, not Clef): repeated ${repeats} time${repeats === 1 ? "" : "s"} in a ${pattern} at a random spot, like a sticker sheet`,
      ], angle + (own() - 0.5) * 3);
      accentPlacements.push({ ...one, key: `${member.item.scrap.id}#${n}` });
      z += 1;
    }
  }

  return {
    placements: [...wallpaper, ...packedPlacements, ...accentPlacements],
    coverage: packed.coverage,
    skipped: packed.skipped,
  };
}

export interface ShapeMask {
  mask: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface ShapeLayoutOptions extends PieceRules {
  seed: number;
  /** Total piece area as a share of the silhouette's area. */
  fill: number;
  /** The same for packing, where pieces do not overlap, so about 1 fills it. */
  packFill: number;
  /** "pack" fits pieces snugly by their outlines; "fill" overlaps rectangles inside; "edge" traces the outline. */
  mode: "pack" | "fill" | "edge";
  sizing: RoleSizing;
  outlineOf: OutlineOf;
  /** Empty grid cells kept between packed pieces. */
  gap: number;
  /**
   * Share of a piece's box that is actually visible: below 1 for a cut-out
   * whose backdrop is transparent. Coverage counts only what shows.
   */
  visibleShare: (scrap: ImageScrap) => number;
  /** Candidate spots tried per piece; more is slower and tighter. */
  tries: number;
  /** Keep only the biggest connected part of the silhouette, dropping stray bits like a logo's wordmark. */
  largestPartOnly: boolean;
  /** Fill holes enclosed by the silhouette, so a ring becomes a disc. */
  fillHoles: boolean;
  /**
   * How far a piece must sit from the outline, as a share of its own half
   * size. 1 keeps a piece wholly inside; 0 lets it straddle the edge.
   */
  inset: number;
}

export interface ShapeLayout {
  placements: Placement[];
  /** Where the silhouette sits in the frame, for drawing a ghost of it. */
  silhouetteBox: { x: number; y: number; width: number; height: number };
  /** The silhouette actually filled, after dropping stray parts and filling holes. */
  shape: ShapeMask;
  /** Share of the silhouette covered by at least one piece. */
  coverage: number;
  /** Share of all piece area that falls outside the silhouette. */
  spill: number;
  /** Pieces that found no room in a packing. */
  skipped: Cast[];
}

/** Labels 4-connected regions of set pixels; returns the label per pixel and each label's size. */
function regions(set: (index: number) => boolean, width: number, height: number) {
  const label = new Int32Array(width * height).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < label.length; start += 1) {
    if (label[start] !== -1 || !set(start)) continue;
    const id = sizes.length;
    let size = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const at = stack.pop() as number;
      size += 1;
      const x = at % width;
      const neighbors = [
        x > 0 ? at - 1 : -1,
        x < width - 1 ? at + 1 : -1,
        at - width,
        at + width,
      ];
      for (const next of neighbors) {
        if (next < 0 || next >= label.length || label[next] !== -1 || !set(next)) continue;
        label[next] = id;
        stack.push(next);
      }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

/** The silhouette cleaned up for filling: biggest part only, holes filled. */
function cleanShape(base: ShapeMask, options: ShapeLayoutOptions): ShapeMask {
  const { width, height } = base;
  let mask = base.mask;
  if (options.largestPartOnly) {
    const { label, sizes } = regions((i) => mask[i] > 0, width, height);
    if (sizes.length > 1) {
      const biggest = sizes.indexOf(Math.max(...sizes));
      mask = mask.map((_, i) => (label[i] === biggest ? 255 : 0));
    }
  }
  if (options.fillHoles) {
    // Background regions that never touch the border are holes.
    const { label, sizes } = regions((i) => mask[i] === 0, width, height);
    const touchesBorder = new Array<boolean>(sizes.length).fill(false);
    for (let x = 0; x < width; x += 1) {
      for (const at of [x, (height - 1) * width + x]) if (label[at] >= 0) touchesBorder[label[at]] = true;
    }
    for (let y = 0; y < height; y += 1) {
      for (const at of [y * width, y * width + width - 1]) if (label[at] >= 0) touchesBorder[label[at]] = true;
    }
    mask = mask.map((value, i) => (value > 0 || !touchesBorder[label[i]] ? 255 : 0));
  }
  return { mask, width, height };
}

/** Distance in pixels from each inside pixel to the nearest outside pixel (chamfer approximation). */
function distanceInside(shape: ShapeMask): Float32Array {
  const { mask, width, height } = shape;
  const far = width + height;
  const distance = new Float32Array(width * height);
  for (let i = 0; i < distance.length; i += 1) distance[i] = mask[i] > 0 ? far : 0;
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : distance[y * width + x];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (distance[i] === 0) continue;
      distance[i] = Math.min(distance[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4142, at(x + 1, y - 1) + 1.4142);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (distance[i] === 0) continue;
      distance[i] = Math.min(distance[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4142, at(x - 1, y + 1) + 1.4142);
    }
  }
  return distance;
}

export function shapeLayout(
  base: ShapeMask,
  casting: Casting,
  frame: Frame,
  options: ShapeLayoutOptions,
): ShapeLayout {
  const random = seededRandom(options.seed);
  const { sizing } = options;
  const shape = cleanShape(base, options);
  const { mask, width: mw, height: mh } = shape;
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < mw && y < mh && mask[y * mw + x] > 0;

  let minX = mw, minY = mh, maxX = -1, maxY = -1, area = 0;
  const edge: number[] = [];
  for (let y = 0; y < mh; y += 1) {
    for (let x = 0; x < mw; x += 1) {
      if (!inside(x, y)) continue;
      area += 1;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) {
        edge.push(y * mw + x);
      }
    }
  }
  if (area === 0) throw new Error("The base silhouette is empty");
  const distance = distanceInside(shape);

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const scale = Math.min((frame.width * 0.88) / bw, (frame.height * 0.88) / bh);
  const offsetX = (frame.width - bw * scale) / 2 - minX * scale;
  const offsetY = (frame.height - bh * scale) / 2 - minY * scale;
  const reference = Math.min(bw, bh) * scale;

  if (options.mode === "pack") {
    const members = casting.cast.map((m): Cast => (m.role === "background" ? { ...m, role: "supporting", why: `${m.why}; inside a shape it plays supporting` } : m));
    const { boxes, notes } = packSizes(members, area * scale * scale * options.packFill, reference, options);
    const heroCount = members.filter((m) => m.role === "hero").length;
    const spots = heroSpots(heroCount, options.seed);
    const packed = packCast({ mask, width: mw, height: mh, scale, offsetX, offsetY }, members, boxes, notes, options.seed, options, options.outlineOf, options.gap, (rank) => {
      const spot = spots[rank];
      // The template is stretched over the shape's bounding box, then the hero finds room inside the shape near that spot.
      return spot && { x: minX + spot.x * bw, y: minY + spot.y * bh, radius: 0.08 * Math.min(bw, bh), why: `${spot.why} (template stretched over the shape)` };
    });
    return {
      placements: packed.placements,
      silhouetteBox: { x: offsetX, y: offsetY, width: mw * scale, height: mh * scale },
      shape,
      coverage: packed.coverage,
      spill: 0,
      skipped: packed.skipped,
    };
  }

  // Inside a shape there is no room for a background behind it, so backgrounds play supporting.
  const cast = casting.cast.map((member): Cast =>
    member.role === "background" ? { ...member, role: "supporting", why: `${member.why}; inside a shape it plays supporting` } : member,
  );
  const heroes = cast.filter((m) => m.role === "hero").sort((a, b) => b.strength - a.strength);
  const supporting = cast.filter((m) => m.role === "supporting");
  const accents = cast.filter((m) => m.role === "accent");

  const boxes = new Map<string, { width: number; height: number }>();
  const sizeWhy = new Map<string, string>();
  heroes.forEach((member, rank) => {
    const long = heroLong(rank, sizing, reference);
    boxes.set(member.item.scrap.id, boxOfLongSide(member.item, long));
    sizeWhy.set(member.item.scrap.id, `size: hero ${rank + 1} -> long side ${Math.round(long)}px (each later hero smaller, so one leads)`);
  });
  for (const member of accents) {
    const own = pieceRandom(member.item.scrap, options.seed, "place");
    const long = sizing.accentSide * reference * (0.75 + own() * 0.5);
    boxes.set(member.item.scrap.id, boxOfLongSide(member.item, long));
    sizeWhy.set(member.item.scrap.id, `size: accent -> small, long side ${Math.round(long)}px`);
  }
  const reserved = [...heroes, ...accents].reduce((sum, m) => {
    const box = boxes.get(m.item.scrap.id) as { width: number; height: number };
    return sum + box.width * box.height;
  }, 0);
  const total = area * scale * scale * options.fill;
  const supportBoxes = supportingBoxes(
    supporting,
    Math.max(total - reserved, total / 3),
    reference * (options.mode === "edge" ? 0.25 : 0.45),
    sizing.contrast,
  );
  for (const [id, { why, ...box }] of supportBoxes) {
    boxes.set(id, box);
    sizeWhy.set(id, why);
  }
  // A cut-out shows only part of its box, so a supporting cut-out grows until
  // what shows matches its share; otherwise the shape reads as see-through.
  const shareOf = new Map<string, number>();
  for (const member of cast) {
    const id = member.item.scrap.id;
    const cut = isCut(member, options);
    const share = cut ? Math.min(1, Math.max(0.15, options.visibleShare(member.item.scrap))) : 1;
    shareOf.set(id, share);
    if (member.role === "supporting" && share < 1) {
      const box = boxes.get(id) as { width: number; height: number };
      const grow = Math.min(1 / Math.sqrt(share), (reference * 0.45) / Math.max(box.width, box.height));
      if (grow > 1) {
        boxes.set(id, { width: box.width * grow, height: box.height * grow });
        sizeWhy.set(id, `${sizeWhy.get(id)}; grown ${grow.toFixed(2)}x because its cut-out shows ${Math.round(share * 100)}% of its box`);
      }
    }
  }

  const covered = new Uint8Array(mw * mh);
  let uncovered = area;
  let spillArea = 0;
  let pieceArea = 0;
  const centers = new Map<string, { x: number; y: number }>();
  const steps = new Map<string, string[]>();

  // Heroes first, then supporting biggest first, then accents, which sharpen the outline.
  const order = [
    ...heroes,
    ...[...supporting].sort((a, b) => {
      const ba = boxes.get(a.item.scrap.id) as { width: number; height: number };
      const bb = boxes.get(b.item.scrap.id) as { width: number; height: number };
      return bb.width * bb.height - ba.width * ba.height;
    }),
    ...accents,
  ];

  order.forEach((member, placedIndex) => {
    const id = member.item.scrap.id;
    let box = boxes.get(id) as { width: number; height: number };
    const notes: string[] = [sizeWhy.get(id) as string];

    let pool: number[] = [];
    let rule = "";
    const empty = (at: number) => mask[at] > 0 && !covered[at];
    if (member.role === "accent" || options.mode === "edge") {
      pool = edge.filter((at) => !covered[at]);
      rule = "empty spots on the outline";
      if (pool.length === 0) {
        pool = edge;
        rule = "spots on the outline (all covered already)";
      }
    } else {
      // A hero too big to sit fully inside shrinks until it does, so heroes
      // never blur the outline. Its long side is what must fit: a long hero
      // checked by its short side pokes out at the ends of a thin shape.
      if (member.role === "hero") {
        let deepest = 0;
        for (let at = 0; at < mask.length; at += 1) if (empty(at) && distance[at] > deepest) deepest = distance[at];
        const visible = Math.sqrt(shareOf.get(id) ?? 1);
        const needed = options.inset * Math.max(box.width, box.height) * visible / scale / 2;
        if (needed > deepest && needed > 0) {
          const shrink = Math.max(0.15, deepest / needed);
          box = { width: box.width * shrink, height: box.height * shrink };
          boxes.set(id, box);
          notes.push(`size: shrunk to ${Math.round(shrink * 100)}% so the hero fits inside the shape without crossing the outline`);
        }
      }
      const needed = options.inset * Math.min(box.width, box.height) / scale / 2;
      for (let at = 0; at < mask.length; at += 1) if (empty(at) && distance[at] >= needed) pool.push(at);
      rule = `empty spots at least ${needed.toFixed(0)}px in from the outline`;
      if (pool.length === 0) {
        for (let at = 0; at < mask.length; at += 1) if (empty(at)) pool.push(at);
        rule = "empty spots anywhere in the shape (none deep enough left)";
      }
      if (pool.length === 0) {
        for (let at = 0; at < mask.length; at += 1) if (mask[at] > 0) pool.push(at);
        rule = "spots anywhere in the shape (all covered already)";
      }
    }

    // Scored and counted by the part that shows: a cut-out's transparent
    // margin neither covers the shape nor visibly spills past it.
    const visible = Math.sqrt(shareOf.get(id) ?? 1);
    const halfW = (box.width * visible) / scale / 2;
    const halfH = (box.height * visible) / scale / 2;
    const stride = Math.max(1, Math.floor(Math.min(halfW, halfH) / 6));
    let best = { score: -Infinity, cx: 0, cy: 0 };
    for (let attempt = 0; attempt < options.tries; attempt += 1) {
      const spot = pool[Math.floor(random() * pool.length)];
      const cx = spot % mw;
      const cy = Math.floor(spot / mw);
      let gain = 0;
      let waste = 0;
      for (let y = Math.round(cy - halfH); y <= cy + halfH; y += stride) {
        for (let x = Math.round(cx - halfW); x <= cx + halfW; x += stride) {
          if (!inside(x, y)) waste += 1;
          else if (!covered[y * mw + x]) gain += 1;
        }
      }
      // Spill past the outline blurs the silhouette, so it costs more than a gap
      // gains. Accents start from the outline but still pay for crossing it, so
      // they settle just inside and sharpen the edge rather than fuzz it.
      const score = gain - waste * (options.mode === "edge" ? 0.4 : 2.5);
      if (score > best.score) best = { score, cx, cy };
    }
    const before = uncovered;
    for (let y = Math.round(best.cy - halfH); y <= best.cy + halfH; y += 1) {
      for (let x = Math.round(best.cx - halfW); x <= best.cx + halfW; x += 1) {
        pieceArea += 1;
        if (!inside(x, y)) spillArea += 1;
        else if (!covered[y * mw + x]) {
          covered[y * mw + x] = 1;
          uncovered -= 1;
        }
      }
    }
    centers.set(id, { x: best.cx * scale + offsetX, y: best.cy * scale + offsetY });
    notes.push(
      `position (code, not Clef): tried ${options.tries} random ${rule}, kept the one covering the most empty shape ` +
        `with the least spill; newly covered ${(((before - uncovered) / area) * 100).toFixed(1)}% of the shape; ` +
        `placed ${placedIndex + 1} of ${order.length} (heroes, then supporting, then accents)`,
    );
    steps.set(id, notes);
  });

  const z = stackOrder(cast, options.seed);
  return {
    placements: cast.map((member) =>
      placement(
        member,
        boxes.get(member.item.scrap.id) as { width: number; height: number },
        centers.get(member.item.scrap.id) as { x: number; y: number },
        z.get(member.item.scrap.id) as number,
        options.seed,
        options,
        steps.get(member.item.scrap.id) ?? [],
      ),
    ),
    silhouetteBox: { x: offsetX, y: offsetY, width: mw * scale, height: mh * scale },
    shape,
    coverage: 1 - uncovered / area,
    spill: pieceArea === 0 ? 0 : spillArea / pieceArea,
    skipped: [],
  };
}

function toPiece(placement: Placement): CollagePiece {
  return {
    id: createPieceId(),
    scrapId: placement.scrap.id,
    scrap: placement.scrap,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    rotation: placement.rotation,
    z: placement.z,
    crop: placement.crop ?? { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
    ...(placement.cutout
      ? { cutout: { method: "edge-color" as const, tolerance: placement.tolerance } }
      : {}),
  };
}

/** Downloads placements as a collage file; open it from the scraps page's collage list. */
export async function downloadCollage(
  title: string,
  format: CollageFormatName,
  placements: Placement[],
): Promise<void> {
  const now = Date.now();
  const record: CollageRecord = {
    id: createCollageId(),
    title,
    createdAt: now,
    updatedAt: now,
    frame: frameOf(format),
    format,
    paper: DEFAULT_PAPER,
    pieces: [...placements].sort((a, b) => a.z - b.z).map(toPiece).map((piece, z) => ({ ...piece, z })),
    preview: { drawn: false, reason: "made in the quest lab" },
  };
  const text = await encodeCollageFile(record, now);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  link.download = `${title}.collage.json`;
  link.click();
}
