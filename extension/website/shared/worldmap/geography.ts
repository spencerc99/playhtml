// ABOUTME: Deterministic world geography: a domain's position, island shape, and
// ABOUTME: settlement class derive purely from hashing the domain, stable forever.

import { WorldSite } from "./types";

/** Radius of the known world in world units */
export const WORLD_RADIUS = 800;
/** How far a single scouting action clears fog, in world units */
export const SCOUT_RADIUS = 85;

/** The origin harbor: the library's home sits at the center of the world */
const ORIGIN_DOMAIN = "playhtml.fun";

/** Domains everyone links to; excluded from community grouping and routes */
export const GENERIC_LINK_HUBS = new Set([
  "youtube.com",
  "google.com",
  "wikipedia.org",
]);

export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32) */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PlacedSite {
  site: WorldSite;
  x: number;
  y: number;
  /** Landmark mark radius in world units */
  markR: number;
  /** Island blob outline in world coordinates */
  island: { x: number; y: number }[];
  /** Log-scaled activity weight (how lived-in), roughly 0..1 */
  weight: number;
  /** Log-scaled extent weight (how much site exists), roughly 0..1 */
  extentWeight: number;
  /** Settlement buildings: little ink structures whose density shows how
   * lived-in a place is. World-relative offsets from the landmark. */
  buildings: { dx: number; dy: number; size: number; roof: boolean }[];
}

/** Qualitative size class for tooltips: how settled a place feels */
export function settlementClass(activity: number): string {
  const w = Math.log10(Math.max(activity, 10));
  if (w >= 6) return "city";
  if (w >= 5) return "town";
  if (w >= 4) return "village";
  if (w >= 3) return "hamlet";
  return "outpost";
}

function islandOutline(
  cx: number,
  cy: number,
  baseR: number,
  rand: () => number
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const n = 12 + Math.floor(rand() * 5);
  const phase = rand() * Math.PI * 2;
  const lobes = 2 + Math.floor(rand() * 3);
  const lobeAmp = 0.18 + rand() * 0.22;
  for (let i = 0; i < n; i++) {
    const theta = (i / n) * Math.PI * 2;
    const wobble =
      1 +
      lobeAmp * Math.sin(theta * lobes + phase) +
      (rand() - 0.5) * 0.28;
    const r = baseR * Math.max(0.45, wobble);
    points.push({ x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r });
  }
  return points;
}

/** Fallback position derived purely from the domain string: stable forever,
 * independent of which other sites exist. */
export function hashPosition(domain: string): { x: number; y: number } {
  if (domain === ORIGIN_DOMAIN) return { x: 0, y: 0 };
  const rand = seededRandom(fnv1a(domain));
  // Uniform placement in a disc; sqrt keeps density even
  const r = Math.sqrt(rand()) * WORLD_RADIUS;
  const theta = rand() * Math.PI * 2;
  return { x: Math.cos(theta) * r, y: Math.sin(theta) * r };
}

export interface SiteWeights {
  /** How lived-in: log-scaled playhtml activity, 0..1 */
  weight: number;
  /** How much site exists: log-scaled page-count extent, 0..1 */
  extentWeight: number;
  markR: number;
  islandR: number;
}

/** One source of truth for how activity and extent become sizes, shared by
 * the renderer and the layout baker (which needs island radii to keep
 * landmasses from stacking). */
export function computeSiteWeights(
  sites: Pick<WorldSite, "domain" | "activity" | "extent">[]
): Map<string, SiteWeights> {
  const maxLog = Math.max(
    ...sites.map((s) => Math.log10(Math.max(s.activity, 10))),
    1
  );
  const maxExtent = Math.max(
    ...sites.map((s) => Math.log10(Math.max(s.extent ?? 1, 1))),
    1
  );
  return new Map(
    sites.map((site) => {
      const weight = Math.log10(Math.max(site.activity, 10)) / maxLog;
      const extentWeight =
        Math.log10(Math.max(site.extent ?? 1, 1)) / maxExtent;
      return [
        site.domain,
        {
          weight,
          extentWeight,
          markR: 2.5 + weight * 8,
          // island footprint follows extent (how much site exists);
          // development (weight) renders separately as building density
          islandR: 10 + extentWeight * 46 + weight * 10,
        },
      ];
    })
  );
}

/** Place every site in the world. Baked coordinates (from the layout tool) win;
 * anything without them falls back to pure hash placement. */
export function placeSites(sites: WorldSite[]): PlacedSite[] {
  const weights = computeSiteWeights(sites);
  return sites.map((site) => {
    const rand = seededRandom(fnv1a(site.domain));
    const { x, y } =
      site.x !== undefined && site.y !== undefined
        ? { x: site.x, y: site.y }
        : hashPosition(site.domain);
    const { weight, extentWeight, markR, islandR } = weights.get(
      site.domain
    )!;
    const buildingCount = weight < 0.28 ? 0 : Math.floor(weight * 11);
    const buildRand = seededRandom(fnv1a(`buildings:${site.domain}`));
    const buildings = Array.from({ length: buildingCount }, () => {
      const theta = buildRand() * Math.PI * 2;
      const dist = markR + 3.5 + buildRand() * (3 + islandR * 0.28);
      return {
        dx: Math.cos(theta) * dist,
        dy: Math.sin(theta) * dist * 0.8,
        size: 1.7 + buildRand() * 1.8,
        roof: buildRand() > 0.45,
      };
    });
    return {
      site,
      x,
      y,
      markR,
      weight,
      extentWeight,
      buildings,
      island: islandOutline(x, y, islandR, rand),
    };
  });
}
