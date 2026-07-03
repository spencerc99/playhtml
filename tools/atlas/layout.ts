// ABOUTME: Bakes world coordinates into the atlas snapshot: link communities become
// ABOUTME: island groups, everything else keeps stable hash placement. Grandfathers
// ABOUTME: existing coordinates so the world never reshuffles under explorers.

// Usage: bun tools/atlas/layout.ts [--rebake]
// Reads website/map-domains.json + website/map-enrichment.json, writes x,y
// back into website/map-domains.json. Run after the crawler refreshes links.
// --rebake ignores existing coordinates (only safe before the map ships).

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  computeSiteWeights,
  fnv1a,
  hashPosition,
  seededRandom,
  WORLD_RADIUS,
} from "../../extension/website/shared/worldmap/geography";

const ROOT = path.join(import.meta.dir, "../..");
const SNAPSHOT = path.join(ROOT, "website/map-domains.json");
const ENRICHMENT = path.join(ROOT, "website/map-enrichment.json");

const REBAKE = process.argv.includes("--rebake");

// Everyone links to these; they'd glue every community into one blob
const GENERIC_HUBS = new Set(["youtube.com", "google.com", "wikipedia.org"]);
const ORIGIN_DOMAIN = "playhtml.fun";

/** Distance between neighbors inside a community island group */
const MEMBER_SPACING = 78;
/** Ring where non-origin community centers live */
const COMMUNITY_RING_MIN = 280;
const COMMUNITY_RING_MAX = 620;
const GOLDEN_ANGLE = 2.399963;

interface SnapshotEntry {
  domain: string;
  rooms: number;
  activity: number;
  x?: number;
  y?: number;
}

interface EnrichmentEntry {
  links: string[];
  pagesCrawled: number;
  waybackUrls: number | null;
  sitemapUrls: number | null;
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf-8")) as SnapshotEntry[];
const enrichment = JSON.parse(readFileSync(ENRICHMENT, "utf-8")) as Record<
  string,
  EnrichmentEntry
>;
const atlas = new Set(snapshot.map((s) => s.domain));

// undirected link graph, generic hubs excluded
const adj = new Map<string, Set<string>>();
for (const [domain, e] of Object.entries(enrichment)) {
  if (!atlas.has(domain) || GENERIC_HUBS.has(domain)) continue;
  for (const target of e.links ?? []) {
    if (!atlas.has(target) || GENERIC_HUBS.has(target) || target === domain)
      continue;
    if (!adj.has(domain)) adj.set(domain, new Set());
    if (!adj.has(target)) adj.set(target, new Set());
    adj.get(domain)!.add(target);
    adj.get(target)!.add(domain);
  }
}

// communities = connected components with 2+ members
const seen = new Set<string>();
const communities: string[][] = [];
for (const node of adj.keys()) {
  if (seen.has(node)) continue;
  const component: string[] = [];
  const stack = [node];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    component.push(n);
    for (const next of adj.get(n) ?? []) if (!seen.has(next)) stack.push(next);
  }
  if (component.length >= 2) communities.push(component.sort());
}
communities.sort((a, b) => b.length - a.length);

const activityOf = new Map(snapshot.map((s) => [s.domain, s.activity]));
const coords = new Map<string, { x: number; y: number }>();

for (const community of communities) {
  // anchor: the community's identity is its lexicographically-first member,
  // so the group's home region never moves as membership grows
  const anchor = community.includes(ORIGIN_DOMAIN)
    ? ORIGIN_DOMAIN
    : community[0];
  const rand = seededRandom(fnv1a(`community:${anchor}`));
  let cx = 0;
  let cy = 0;
  if (anchor !== ORIGIN_DOMAIN) {
    const r =
      COMMUNITY_RING_MIN + rand() * (COMMUNITY_RING_MAX - COMMUNITY_RING_MIN);
    const theta = rand() * Math.PI * 2;
    cx = Math.cos(theta) * r;
    cy = Math.sin(theta) * r;
  }
  const phase = rand() * Math.PI * 2;
  // most active members sit at the heart of the group
  const ordered = [...community].sort(
    (a, b) => (activityOf.get(b) ?? 0) - (activityOf.get(a) ?? 0)
  );
  let slot = 0;
  for (const domain of ordered) {
    if (domain === ORIGIN_DOMAIN) {
      coords.set(domain, { x: 0, y: 0 });
      continue;
    }
    const jitterRand = seededRandom(fnv1a(`member:${domain}`));
    const r = MEMBER_SPACING * Math.sqrt(slot + 1);
    const theta = phase + (slot + 1) * GOLDEN_ANGLE;
    coords.set(domain, {
      x: cx + Math.cos(theta) * r + (jitterRand() - 0.5) * 30,
      y: cy + Math.sin(theta) * r + (jitterRand() - 0.5) * 30,
    });
    slot++;
  }
}

let placed = 0;
let kept = 0;
const frozen = new Set<string>([ORIGIN_DOMAIN]);
const positions = new Map<string, { x: number; y: number }>();
for (const entry of snapshot) {
  if (!REBAKE && entry.x !== undefined && entry.y !== undefined) {
    kept++;
    // already-charted coordinates are a promise to explorers; never move them
    frozen.add(entry.domain);
    positions.set(entry.domain, { x: entry.x, y: entry.y });
    continue;
  }
  positions.set(
    entry.domain,
    coords.get(entry.domain) ?? hashPosition(entry.domain)
  );
  placed++;
}

// separation pass: nudge overlapping landmasses apart so islands read as
// distinct places. Slight overlap is allowed (archipelagos may touch), and
// grandfathered coordinates never move -- new arrivals flow around them.
const weights = computeSiteWeights(
  snapshot.map((s) => {
    const e = enrichment[s.domain];
    return {
      domain: s.domain,
      activity: s.activity,
      extent:
        Math.max(
          e?.pagesCrawled ?? 0,
          e?.waybackUrls ?? 0,
          e?.sitemapUrls ?? 0
        ) || undefined,
    };
  })
);
const domains = snapshot.map((s) => s.domain).sort();
for (let iter = 0; iter < 120; iter++) {
  let moved = 0;
  for (let i = 0; i < domains.length; i++) {
    for (let j = i + 1; j < domains.length; j++) {
      const a = domains[i];
      const b = domains[j];
      const pa = positions.get(a)!;
      const pb = positions.get(b)!;
      const desired =
        (weights.get(a)!.islandR + weights.get(b)!.islandR) * 0.82 + 4;
      let dx = pb.x - pa.x;
      let dy = pb.y - pa.y;
      let dist = Math.hypot(dx, dy);
      if (dist >= desired) continue;
      if (dist < 0.01) {
        // exact stack: pick a deterministic direction
        const rand = seededRandom(fnv1a(`untangle:${a}|${b}`));
        const theta = rand() * Math.PI * 2;
        dx = Math.cos(theta);
        dy = Math.sin(theta);
        dist = 1;
      }
      const push = (desired - dist) / dist;
      const aFrozen = frozen.has(a);
      const bFrozen = frozen.has(b);
      if (aFrozen && bFrozen) continue;
      const aShare = aFrozen ? 0 : bFrozen ? 1 : 0.5;
      pa.x -= dx * push * aShare;
      pa.y -= dy * push * aShare;
      pb.x += dx * push * (1 - aShare);
      pb.y += dy * push * (1 - aShare);
      moved++;
    }
  }
  if (moved === 0) break;
}

// keep everything inside the known world
for (const [domain, p] of positions) {
  if (frozen.has(domain)) continue;
  const r = Math.hypot(p.x, p.y);
  const max = WORLD_RADIUS * 1.02;
  if (r > max) {
    p.x *= max / r;
    p.y *= max / r;
  }
}

for (const entry of snapshot) {
  const p = positions.get(entry.domain)!;
  entry.x = Math.round(p.x * 10) / 10;
  entry.y = Math.round(p.y * 10) / 10;
}

writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 0));
console.log(
  `baked ${placed} coordinates (${kept} grandfathered), ` +
    `${communities.length} communities: ${communities
      .map((c) => c.length)
      .join(", ")}`
);
