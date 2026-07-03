// ABOUTME: Deterministic world geography: a domain's position, island shape, and
// ABOUTME: settlement class derive purely from hashing the domain, stable forever.

import { WorldSite } from "./types";

/** Radius of the known world in world units */
export const WORLD_RADIUS = 800;
/** How far a single scouting action clears fog, in world units */
export const SCOUT_RADIUS = 85;

/** The origin harbor: the library's home sits at the center of the world */
const ORIGIN_DOMAIN = "playhtml.fun";

function fnv1a(str: string): number {
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
  /** Log-scaled activity weight, roughly 0..1 */
  weight: number;
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

/** Deterministically place every site in the world. Positions never depend on
 * which other sites exist, so the geography is stable as the world grows. */
export function placeSites(sites: WorldSite[]): PlacedSite[] {
  const maxLog = Math.max(
    ...sites.map((s) => Math.log10(Math.max(s.activity, 10))),
    1
  );
  return sites.map((site) => {
    const rand = seededRandom(fnv1a(site.domain));
    let x: number;
    let y: number;
    if (site.domain === ORIGIN_DOMAIN) {
      x = 0;
      y = 0;
    } else {
      // Uniform placement in a disc; sqrt keeps density even
      const r = Math.sqrt(rand()) * WORLD_RADIUS;
      const theta = rand() * Math.PI * 2;
      x = Math.cos(theta) * r;
      y = Math.sin(theta) * r;
    }
    const weight = Math.log10(Math.max(site.activity, 10)) / maxLog;
    const markR = 2.5 + weight * 8;
    const islandR = 10 + weight * 40;
    return {
      site,
      x,
      y,
      markR,
      weight,
      island: islandOutline(x, y, islandR, rand),
    };
  });
}
