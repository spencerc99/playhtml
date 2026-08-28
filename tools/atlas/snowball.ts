// ABOUTME: Crawls outward from personal-site seeds to build a domain link graph.
// ABOUTME: Produces atlas galaxy data and computes weighted internet commute paths.

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  baseDomain,
  extractFavicon,
  extractLinks,
  extractTitle,
  fetchWithTimeout,
  MAX_BODY_BYTES,
  PAGE_DELAY_MS,
  robotsDisallows,
  SECOND_LEVEL_SUFFIXES,
  SKIP_EXTENSIONS,
} from "./lib";

const SITE_MAX_DEPTH = 3;
const DEFAULT_MAX_DOMAINS = 250;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_CRAWL_DEPTH = 3;
const DEFAULT_OUTPUT = path.join(import.meta.dir, "out");

const NO_EXPAND = new Set([
  "google.com",
  "youtube.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "reddit.com",
  "wikipedia.org",
  "github.com",
  "amazon.com",
  "apple.com",
  "medium.com",
  "substack.com",
  "tiktok.com",
  "spotify.com",
  "discord.com",
  "discord.gg",
  "mozilla.org",
  "cloudflare.com",
  "archive.org",
  "web.archive.org",
  "youtu.be",
  "goo.gl",
  "bit.ly",
  "t.co",
  "creativecommons.org",
  "wikimedia.org",
  "mediawiki.org",
  "flickr.com",
  "mastodon.social",
  "bsky.app",
  "wordpress.org",
  "gravatar.com",
  "paypal.com",
  "patreon.com",
  "ko-fi.com",
  "buymeacoffee.com",
  "wordpress.com",
  "tumblr.com",
  "threads.net",
  "t.me",
  "nytimes.com",
  "wikidata.org",
  "wiktionary.org",
]);

export interface SnowballDomain {
  depth: number;
  alive: boolean;
  pagesCrawled: number;
  title: string | null;
  favicon: string | null;
  links: Record<string, number>;
}

export interface SnowballGraph {
  seeds: string[];
  params: {
    maxDomains: number;
    maxPages: number;
    depth: number;
  };
  domains: Record<string, SnowballDomain>;
}

interface CrawlOptions {
  seeds: string[];
  maxDomains: number;
  maxPages: number;
  depth: number;
  out: string;
}

interface CrawlResult {
  alive: boolean;
  pagesCrawled: number;
  title: string | null;
  favicon: string | null;
  links: Record<string, number>;
}

interface GalaxyNode {
  id: string;
  visits: number;
  participants: number;
  dwellMs: number;
  cluster: number;
  /** seed: a crawl origin; hub: big-web domain kept visible but never a route */
  kind: "seed" | "hub" | "site";
}

interface GalaxyEdge {
  source: string;
  target: string;
  jumps: number;
}

interface GalaxyCluster {
  id: number;
  size: number;
  label: string;
}

interface GalaxyGraph {
  meta: {
    generatedAt: string;
    seeds: string[];
    totalDomains: number;
    totalEdges: number;
  };
  nodes: GalaxyNode[];
  edges: GalaxyEdge[];
  clusters: GalaxyCluster[];
}

interface ShortestPath {
  distance: number;
  path: string[];
}

function emptyDomain(depth: number): SnowballDomain {
  return {
    depth,
    alive: false,
    pagesCrawled: 0,
    title: null,
    favicon: null,
    links: {},
  };
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received ${value}`);
  }
  return parsed;
}

function nonNegativeInteger(
  value: string | undefined,
  fallback: number
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received ${value}`);
  }
  return parsed;
}

function normalizeDomain(value: string): string {
  const candidate = value.includes("://") ? value : `https://${value}`;
  const url = new URL(candidate);
  if (url.protocol !== "https:") {
    throw new Error(`Only HTTPS seeds are supported: ${value}`);
  }
  if (isIpOrLocalhost(url.hostname)) {
    throw new Error(`IP and localhost seeds are not supported: ${value}`);
  }
  return baseDomain(url.hostname);
}

function isIpOrLocalhost(host: string): boolean {
  const bareHost = host.replace(/^\[|\]$/g, "");
  return (
    bareHost === "localhost" ||
    bareHost.endsWith(".localhost") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bareHost) ||
    bareHost.includes(":")
  );
}

function isCrawlableDomain(domain: string): boolean {
  if (NO_EXPAND.has(domain) || isIpOrLocalhost(domain)) return false;
  if (/^(?:mail|email|smtp|imap|pop)\./i.test(domain)) return false;
  if (domain.length > 253 || !domain.includes(".")) return false;
  return domain.split(".").every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  );
}

function isRobotsAllowed(url: URL, disallows: string[]): boolean {
  return !disallows.some((rule) => url.pathname.startsWith(rule));
}

async function crawlDomain(
  domain: string,
  maxPages: number
): Promise<CrawlResult> {
  const result: CrawlResult = {
    alive: false,
    pagesCrawled: 0,
    title: null,
    favicon: null,
    links: {},
  };
  const origin = `https://${domain}`;
  const disallows = await robotsDisallows(origin);
  const queue: { url: string; depth: number }[] = [
    { url: `${origin}/`, depth: 0 },
  ];
  const seen = new Set([`${origin}/`]);

  while (queue.length > 0 && result.pagesCrawled < maxPages) {
    const { url, depth } = queue.shift()!;
    const res = await fetchWithTimeout(url, "text/html");
    if (!res || !res.ok) continue;
    if (!(res.headers.get("content-type") || "").includes("text/html")) {
      continue;
    }

    let html: string;
    try {
      html = (await res.text()).slice(0, MAX_BODY_BYTES);
    } catch {
      continue;
    }

    result.pagesCrawled++;
    result.alive = true;
    if (result.title === null) {
      result.title = extractTitle(html);
      result.favicon = extractFavicon(html, url);
    }

    const pageTargets = new Set<string>();
    for (const link of extractLinks(html, url)) {
      let parsed: URL;
      try {
        parsed = new URL(link);
      } catch {
        continue;
      }
      if (isIpOrLocalhost(parsed.hostname)) continue;
      const linkBase = baseDomain(parsed.hostname);
      if (linkBase === domain) {
        if (
          depth < SITE_MAX_DEPTH &&
          !SKIP_EXTENSIONS.test(parsed.pathname) &&
          isRobotsAllowed(parsed, disallows)
        ) {
          const normalized = `https://${parsed.host}${parsed.pathname}`;
          if (!seen.has(normalized) && seen.size < maxPages * 4) {
            seen.add(normalized);
            queue.push({ url: normalized, depth: depth + 1 });
          }
        }
      } else if (isCrawlableDomain(linkBase) || NO_EXPAND.has(linkBase)) {
        pageTargets.add(linkBase);
      }
    }

    for (const target of pageTargets) {
      result.links[target] = (result.links[target] ?? 0) + 1;
    }
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
  }

  result.links = Object.fromEntries(
    Object.entries(result.links).sort(([a], [b]) => a.localeCompare(b))
  );
  return result;
}

function undirectedAdjacency(
  domains: string[],
  edges: GalaxyEdge[]
): Map<string, Map<string, number>> {
  const adjacency = new Map(
    domains.map((domain) => [domain, new Map<string, number>()])
  );
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const sourceNeighbors = adjacency.get(edge.source)!;
    const targetNeighbors = adjacency.get(edge.target)!;
    sourceNeighbors.set(
      edge.target,
      (sourceNeighbors.get(edge.target) ?? 0) + edge.jumps
    );
    targetNeighbors.set(
      edge.source,
      (targetNeighbors.get(edge.source) ?? 0) + edge.jumps
    );
  }
  return adjacency;
}

function connectedComponentLabels(
  domains: string[],
  adjacency: Map<string, Map<string, number>>
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const domain of domains) {
    if (labels.has(domain)) continue;
    const component: string[] = [];
    const queue = [domain];
    labels.set(domain, domain);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency.get(current)!.keys()) {
        if (!labels.has(neighbor)) {
          labels.set(neighbor, domain);
          queue.push(neighbor);
        }
      }
    }
    const label = component.sort()[0];
    for (const member of component) labels.set(member, label);
  }
  return labels;
}

function propagateLabels(
  domains: string[],
  adjacency: Map<string, Map<string, number>>
): Map<string, string> {
  const labels = new Map(domains.map((domain) => [domain, domain]));
  for (let iteration = 0; iteration < 15; iteration++) {
    let changed = false;
    for (const domain of domains) {
      const neighbors = adjacency.get(domain)!;
      if (neighbors.size === 0) continue;
      const scores = new Map<string, number>();
      for (const [neighbor, weight] of neighbors) {
        const label = labels.get(neighbor)!;
        scores.set(label, (scores.get(label) ?? 0) + weight);
      }
      const bestLabel = [...scores.entries()].sort(
        ([labelA, scoreA], [labelB, scoreB]) =>
          scoreB - scoreA || labelA.localeCompare(labelB)
      )[0][0];
      if (bestLabel !== labels.get(domain)) changed = true;
      labels.set(domain, bestLabel);
    }
    if (!changed && iteration >= 9) break;
  }

  const connectedDomains = domains.filter(
    (domain) => adjacency.get(domain)!.size > 0
  );
  const connectedLabels = new Set(
    connectedDomains.map((domain) => labels.get(domain)!)
  );
  if (
    connectedDomains.length > 1 &&
    connectedLabels.size === connectedDomains.length
  ) {
    return connectedComponentLabels(domains, adjacency);
  }
  return labels;
}

function makeGalaxyGraph(raw: SnowballGraph): GalaxyGraph {
  // bare second-level registry suffixes (co.uk etc.) are corrupted
  // aggregates from crawls that predate the ccTLD fix; drop them
  const domains = Object.keys(raw.domains)
    .filter((d) => !SECOND_LEVEL_SUFFIXES.has(d))
    .sort();
  const domainSet = new Set(domains);
  const edges: GalaxyEdge[] = [];
  // node prominence = how many distinct sites link to it, so one site with a
  // blogroll on every page cannot inflate a neighbor by itself
  const inboundDomains = new Map<string, Set<string>>();
  for (const source of domains) {
    for (const [target, jumps] of Object.entries(raw.domains[source].links)) {
      if (!domainSet.has(target)) continue;
      edges.push({ source, target, jumps });
      const set = inboundDomains.get(target) ?? new Set<string>();
      set.add(source);
      inboundDomains.set(target, set);
    }
  }
  const inboundVisits = new Map(
    domains.map((domain) => [domain, inboundDomains.get(domain)?.size ?? 0])
  );
  edges.sort(
    (a, b) =>
      a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
  );

  const adjacency = undirectedAdjacency(domains, edges);
  const labels = propagateLabels(domains, adjacency);
  const grouped = new Map<string, string[]>();
  for (const domain of domains) {
    const label = labels.get(domain)!;
    const members = grouped.get(label) ?? [];
    members.push(domain);
    grouped.set(label, members);
  }
  const groups = [...grouped.values()]
    .map((members) => members.sort())
    .sort((a, b) => a[0].localeCompare(b[0]));
  const clusterByDomain = new Map<string, number>();
  const clusters = groups.map((members, id) => {
    for (const member of members) clusterByDomain.set(member, id);
    const label = [...members].sort(
      (a, b) =>
        (inboundVisits.get(b) ?? 0) - (inboundVisits.get(a) ?? 0) ||
        a.localeCompare(b)
    )[0];
    return { id, size: members.length, label };
  });

  const seeds = new Set(raw.seeds);
  const nodes = domains.map((domain) => ({
    id: domain,
    visits: Math.max(1, inboundVisits.get(domain) ?? 0),
    participants: 0,
    dwellMs: 0,
    cluster: clusterByDomain.get(domain)!,
    kind: seeds.has(domain)
      ? ("seed" as const)
      : NO_EXPAND.has(domain)
        ? ("hub" as const)
        : ("site" as const),
  }));
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      seeds: raw.seeds,
      totalDomains: nodes.length,
      totalEdges: edges.length,
    },
    nodes,
    edges,
    clusters,
  };
}

function shortestPath(
  graph: SnowballGraph,
  from: string,
  to: string
): ShortestPath {
  if (!graph.domains[from] || !graph.domains[to]) {
    return { distance: Infinity, path: [] };
  }
  const distances = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, string>();
  const unvisited = new Set(Object.keys(graph.domains));

  while (unvisited.size > 0) {
    let current: string | null = null;
    let currentDistance = Infinity;
    for (const domain of [...unvisited].sort()) {
      const distance = distances.get(domain) ?? Infinity;
      if (distance < currentDistance) {
        current = domain;
        currentDistance = distance;
      }
    }
    if (current === null || currentDistance === Infinity) break;
    unvisited.delete(current);
    if (current === to) break;

    // big-web hubs cannot be transit: everyone links instagram, so routing
    // through it would make every pair of sites two hops apart
    if (NO_EXPAND.has(current) && current !== from) continue;

    for (const [neighbor, linkingPages] of Object.entries(
      graph.domains[current].links
    ).sort(([a], [b]) => a.localeCompare(b))) {
      if (!unvisited.has(neighbor) || linkingPages <= 0) continue;
      if (NO_EXPAND.has(neighbor) && neighbor !== to) continue;
      // hops dominate (a hop costs like a transfer), link strength only
      // discounts within a hop -- so a direct road always beats a detour
      const candidate =
        currentDistance + 1 + 1 / Math.log2(2 + linkingPages);
      const known = distances.get(neighbor) ?? Infinity;
      if (candidate < known) {
        distances.set(neighbor, candidate);
        previous.set(neighbor, current);
      }
    }
  }

  const distance = distances.get(to) ?? Infinity;
  if (distance === Infinity) return { distance, path: [] };
  const route = [to];
  while (route[0] !== from) route.unshift(previous.get(route[0])!);
  return { distance, path: route };
}

export function commuteDistance(
  graph: SnowballGraph,
  from: string,
  to: string
): number {
  return shortestPath(graph, from, to).distance;
}

function parseCrawlOptions(args: string[]): CrawlOptions {
  const seedsValue = flagValue(args, "--seeds");
  if (!seedsValue) throw new Error("--seeds is required");
  const seeds = [...new Set(
    seedsValue.split(",").map((seed) => normalizeDomain(seed.trim()))
  )];
  const maxDomains = positiveInteger(
    flagValue(args, "--max-domains"),
    DEFAULT_MAX_DOMAINS
  );
  if (seeds.length > maxDomains) {
    throw new Error("--max-domains must be at least the number of seeds");
  }
  return {
    seeds,
    maxDomains,
    maxPages: positiveInteger(
      flagValue(args, "--max-pages"),
      DEFAULT_MAX_PAGES
    ),
    depth: nonNegativeInteger(
      flagValue(args, "--depth"),
      DEFAULT_CRAWL_DEPTH
    ),
    out: path.resolve(flagValue(args, "--out") ?? DEFAULT_OUTPUT),
  };
}

async function runCrawl(options: CrawlOptions): Promise<void> {
  const raw: SnowballGraph = {
    seeds: options.seeds,
    params: {
      maxDomains: options.maxDomains,
      maxPages: options.maxPages,
      depth: options.depth,
    },
    domains: {},
  };
  // Ring-balanced expansion: each ring outward gets a slice of the domain
  // budget, and within a ring we crawl the most-referenced candidates first.
  // Plain BFS would spend the whole budget one or two rings from the seeds;
  // this trades some breadth for actually reaching distant neighborhoods.
  const scheduled = new Set<string>();
  const candidates = new Map<
    string,
    { referrers: Set<string>; totalPages: number }
  >();
  let ring: string[] = [];
  for (const seed of options.seeds) {
    raw.domains[seed] = emptyDomain(0);
    if (isCrawlableDomain(seed)) {
      scheduled.add(seed);
      ring.push(seed);
    }
  }

  let crawled = 0;
  let ringDepth = 0;
  while (ring.length > 0 && ringDepth <= options.depth) {
    for (const domain of ring) {
      console.log(
        `crawled ${crawled}/${scheduled.size}, ring ${ringDepth} ` +
          `(${ring.length} wide), current ${domain}`
      );
      const result = await crawlDomain(domain, options.maxPages);
      raw.domains[domain] = { depth: ringDepth, ...result };
      crawled++;

      for (const [target, pages] of Object.entries(result.links)) {
        if (!raw.domains[target]) {
          raw.domains[target] = emptyDomain(ringDepth + 1);
        }
        if (scheduled.has(target) || !isCrawlableDomain(target)) continue;
        const c = candidates.get(target) ?? {
          referrers: new Set<string>(),
          totalPages: 0,
        };
        c.referrers.add(domain);
        c.totalPages += pages;
        candidates.set(target, c);
      }
    }

    const remainingRings = options.depth - ringDepth;
    const remainingBudget = options.maxDomains - scheduled.size;
    if (remainingRings <= 0 || remainingBudget <= 0) break;
    const ringBudget = Math.min(
      remainingBudget,
      Math.max(4, Math.ceil(remainingBudget / remainingRings))
    );
    const picked = [...candidates.entries()]
      .sort(
        ([aDomain, a], [bDomain, b]) =>
          b.referrers.size - a.referrers.size ||
          b.totalPages - a.totalPages ||
          aDomain.localeCompare(bDomain)
      )
      .slice(0, ringBudget)
      .map(([domain]) => domain);
    for (const domain of picked) {
      scheduled.add(domain);
      candidates.delete(domain);
    }
    ring = picked;
    ringDepth++;
  }

  raw.domains = Object.fromEntries(
    Object.entries(raw.domains).sort(([a], [b]) => a.localeCompare(b))
  );
  const galaxy = makeGalaxyGraph(raw);
  mkdirSync(options.out, { recursive: true });
  writeFileSync(
    path.join(options.out, "snowball-raw.json"),
    JSON.stringify(raw, null, 2) + "\n"
  );
  writeFileSync(
    path.join(options.out, "galaxy-graph.json"),
    JSON.stringify(galaxy, null, 2) + "\n"
  );
  console.log(
    `done: crawled ${crawled} domains, wrote ${galaxy.meta.totalDomains} ` +
      `nodes and ${galaxy.meta.totalEdges} edges to ${options.out}`
  );
}

function runDistance(args: string[]): void {
  const distanceIndex = args.indexOf("--distance");
  const fromValue = args[distanceIndex + 1];
  const toValue = args[distanceIndex + 2];
  if (
    !fromValue ||
    !toValue ||
    fromValue.startsWith("--") ||
    toValue.startsWith("--")
  ) {
    throw new Error("--distance requires from and to domains");
  }
  const graphPath = flagValue(args, "--graph");
  if (!graphPath) throw new Error("--graph is required in distance mode");
  const graph = JSON.parse(readFileSync(graphPath, "utf-8")) as SnowballGraph;
  const from = normalizeDomain(fromValue);
  const to = normalizeDomain(toValue);
  const result = shortestPath(graph, from, to);
  console.log(
    Number.isFinite(result.distance) ? result.distance.toString() : "Infinity"
  );
  console.log(result.path.length > 0 ? result.path.join(" -> ") : "unreachable");
}

function runRebuild(args: string[]): void {
  const rawPath = flagValue(args, "--rebuild");
  if (!rawPath) throw new Error("--rebuild requires a snowball-raw.json path");
  const raw = JSON.parse(readFileSync(rawPath, "utf-8")) as SnowballGraph;
  const galaxy = makeGalaxyGraph(raw);
  const outPath = path.join(path.dirname(rawPath), "galaxy-graph.json");
  writeFileSync(outPath, JSON.stringify(galaxy, null, 2) + "\n");
  console.log(
    `rebuilt ${galaxy.meta.totalDomains} nodes and ` +
      `${galaxy.meta.totalEdges} edges to ${outPath}`
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--distance")) runDistance(args);
  else if (args.includes("--rebuild")) runRebuild(args);
  else await runCrawl(parseCrawlOptions(args));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
