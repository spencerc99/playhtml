// ABOUTME: Crawls outward from personal-site seeds to build a domain link graph.
// ABOUTME: Produces atlas galaxy data and computes weighted internet commute paths.

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  baseDomain,
  extractFavicon,
  extractLinks,
  extractSitemapLocations,
  extractTitle,
  fetchWithTimeout,
  MAX_BODY_BYTES,
  PAGE_DELAY_MS,
  robotsDisallows,
  SECOND_LEVEL_SUFFIXES,
  selectCrawlSeeds,
  SKIP_EXTENSIONS,
} from "./lib";

const SITE_MAX_DEPTH = 3;
const DEFAULT_MAX_DOMAINS = 250;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_CRAWL_DEPTH = 3;
const DEFAULT_OUTPUT = path.join(import.meta.dir, "out");
const INTERCHANGE_OUTBOUND_LINK_THRESHOLD = 200;
const EXTRA_TRUNK_EDGE_RATIO = 0.08;
const SEED_PAGE_MULTIPLIER = 4;

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

interface MergeOptions extends CrawlOptions {
  graph: string;
}

interface CrawlResult {
  alive: boolean;
  pagesCrawled: number;
  title: string | null;
  favicon: string | null;
  links: Record<string, number>;
}

export interface GalaxyNode {
  id: string;
  visits: number;
  participants: number;
  dwellMs: number;
  cluster: number;
  /** seed: crawl origin; interchange: directory; hub: no-transit big-web site */
  kind: "seed" | "interchange" | "hub" | "site";
}

export interface GalaxyEdge {
  source: string;
  target: string;
  jumps: number;
  back: number;
  trunk: boolean;
}

export interface GalaxyCluster {
  id: number;
  size: number;
  label: string;
}

export interface GalaxyGraph {
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

export interface ShortestPath {
  distance: number;
  path: string[];
  legs: PathLeg[];
}

export interface PathLeg {
  from: string;
  to: string;
  kind: "ride" | "walk";
}

interface RouteQueueEntry {
  distance: number;
  key: string;
}

class RouteQueue {
  private entries: RouteQueueEntry[] = [];

  push(entry: RouteQueueEntry): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.entries[parent], entry) <= 0) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): RouteQueueEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!first || !last || this.entries.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.entries.length) break;
      const child =
        right < this.entries.length &&
        this.compare(this.entries[right], this.entries[left]) < 0
          ? right
          : left;
      if (this.compare(last, this.entries[child]) <= 0) break;
      this.entries[index] = this.entries[child];
      index = child;
    }
    this.entries[index] = last;
    return first;
  }

  private compare(left: RouteQueueEntry, right: RouteQueueEntry): number {
    return left.distance - right.distance || left.key.localeCompare(right.key);
  }
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

async function responseText(response: Response | null): Promise<string | null> {
  if (!response || !response.ok) return null;
  try {
    return await response.text();
  } catch {
    return null;
  }
}

async function sitemapPageUrls(origin: string, domain: string): Promise<string[]> {
  const sitemapUrl = `${origin}/sitemap.xml`;
  const sitemap = await responseText(
    await fetchWithTimeout(sitemapUrl, "application/xml")
  );
  if (sitemap === null) return [];

  if (!/<(?:[a-z_][\w.-]*:)?sitemapindex\b/i.test(sitemap)) {
    return extractSitemapLocations(sitemap);
  }

  const childSitemaps: string[] = [];
  for (const location of extractSitemapLocations(sitemap)) {
    try {
      const childUrl = new URL(location, sitemapUrl);
      if (
        (childUrl.protocol === "http:" || childUrl.protocol === "https:") &&
        baseDomain(childUrl.hostname) === domain
      ) {
        childSitemaps.push(childUrl.href);
      }
    } catch {
      // Ignore invalid sitemap entries.
    }
    if (childSitemaps.length === 3) break;
  }

  const pages: string[] = [];
  for (const childUrl of childSitemaps) {
    const child = await responseText(
      await fetchWithTimeout(childUrl, "application/xml")
    );
    if (child !== null) pages.push(...extractSitemapLocations(child));
  }
  return pages;
}

async function quartzPageUrls(origin: string): Promise<string[]> {
  const response = await fetchWithTimeout(
    `${origin}/static/contentIndex.json`,
    "application/json"
  );
  if (!response || !response.ok) return [];
  try {
    const contentIndex: unknown = await response.json();
    if (
      contentIndex === null ||
      typeof contentIndex !== "object" ||
      Array.isArray(contentIndex)
    ) {
      return [];
    }
    return Object.keys(contentIndex).map(
      (slug) => `${origin}/${slug.replace(/^\/+/, "")}`
    );
  } catch {
    return [];
  }
}

function normalizeDiscoveredPage(
  candidate: string,
  domain: string,
  disallows: string[]
): string | null {
  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      baseDomain(url.hostname) !== domain ||
      SKIP_EXTENSIONS.test(url.pathname) ||
      !isRobotsAllowed(url, disallows)
    ) {
      return null;
    }
    return `https://${url.host}${url.pathname}`;
  } catch {
    return null;
  }
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
  const sitemapUrls = await sitemapPageUrls(origin, domain);
  const quartzUrls = await quartzPageUrls(origin);
  const discoveredUrls = [...sitemapUrls, ...quartzUrls]
    .map((url) => normalizeDiscoveredPage(url, domain, disallows))
    .filter((url): url is string => url !== null);
  const seedUrls = selectCrawlSeeds(`${origin}/`, discoveredUrls, maxPages);
  const queue = seedUrls.map((url) => ({ url, depth: 0 }));
  const seen = new Set(seedUrls);

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
    const weight = edge.jumps + edge.back;
    sourceNeighbors.set(edge.target, weight);
    targetNeighbors.set(edge.source, weight);
  }
  return adjacency;
}

function isInterchange(raw: SnowballGraph, domain: string): boolean {
  return (
    Object.keys(raw.domains[domain].links).length >
    INTERCHANGE_OUTBOUND_LINK_THRESHOLD
  );
}

function edgeWeight(
  edge: GalaxyEdge,
  interchangeDomains: Set<string>
): number {
  const jumps = interchangeDomains.has(edge.source)
    ? Math.min(edge.jumps, 1)
    : edge.jumps;
  const back = interchangeDomains.has(edge.target)
    ? Math.min(edge.back, 1)
    : edge.back;
  return jumps + back + 2 * Math.min(jumps, back);
}

function markTrunkEdges(
  domains: string[],
  edges: GalaxyEdge[],
  interchangeDomains: Set<string>
): void {
  const parent = new Map(domains.map((domain) => [domain, domain]));
  const find = (domain: string): string => {
    let root = domain;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let current = domain;
    while (current !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const rankedEdges = [...edges].sort(
    (a, b) =>
      edgeWeight(b, interchangeDomains) -
        edgeWeight(a, interchangeDomains) ||
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target)
  );
  const remaining: GalaxyEdge[] = [];
  for (const edge of rankedEdges) {
    const sourceRoot = find(edge.source);
    const targetRoot = find(edge.target);
    if (sourceRoot === targetRoot) {
      remaining.push(edge);
      continue;
    }
    parent.set(targetRoot, sourceRoot);
    edge.trunk = true;
  }
  const extraCount = Math.min(
    Math.ceil(EXTRA_TRUNK_EDGE_RATIO * domains.length),
    remaining.length
  );
  for (const edge of remaining.slice(0, extraCount)) edge.trunk = true;
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
  const edgesByPair = new Map<string, GalaxyEdge>();
  // node prominence = how many distinct sites link to it, so one site with a
  // blogroll on every page cannot inflate a neighbor by itself
  const inboundDomains = new Map<string, Set<string>>();
  for (const source of domains) {
    for (const [target, jumps] of Object.entries(raw.domains[source].links)) {
      if (!domainSet.has(target) || source === target || jumps <= 0) continue;
      const pairSource = source < target ? source : target;
      const pairTarget = source < target ? target : source;
      const key = `${pairSource}\0${pairTarget}`;
      const edge = edgesByPair.get(key) ?? {
        source: pairSource,
        target: pairTarget,
        jumps: 0,
        back: 0,
        trunk: false,
      };
      if (source === pairSource) edge.jumps += jumps;
      else edge.back += jumps;
      edgesByPair.set(key, edge);
      const set = inboundDomains.get(target) ?? new Set<string>();
      set.add(source);
      inboundDomains.set(target, set);
    }
  }
  const inboundVisits = new Map(
    domains.map((domain) => [domain, inboundDomains.get(domain)?.size ?? 0])
  );
  const edges = [...edgesByPair.values()];
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
  const interchangeDomains = new Set(
    domains.filter((domain) => !seeds.has(domain) && isInterchange(raw, domain))
  );
  const nodes = domains.map((domain) => ({
    id: domain,
    visits: Math.max(1, inboundVisits.get(domain) ?? 0),
    participants: 0,
    dwellMs: 0,
    cluster: clusterByDomain.get(domain)!,
    kind: seeds.has(domain)
      ? ("seed" as const)
      : interchangeDomains.has(domain)
        ? ("interchange" as const)
        : NO_EXPAND.has(domain)
          ? ("hub" as const)
          : ("site" as const),
  }));
  markTrunkEdges(domains, edges, interchangeDomains);
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

export function transitShortestPath(
  galaxy: GalaxyGraph,
  from: string,
  to: string
): ShortestPath {
  const domains = new Set(galaxy.nodes.map((node) => node.id));
  if (!domains.has(from) || !domains.has(to)) {
    return { distance: Infinity, path: [], legs: [] };
  }
  const kindByDomain = new Map(
    galaxy.nodes.map((node) => [node.id, node.kind])
  );
  const adjacency = new Map(
    galaxy.nodes.map((node) => [
      node.id,
      [] as { neighbor: string; pages: number; trunk: boolean }[],
    ])
  );
  for (const edge of galaxy.edges) {
    if (edge.jumps > 0) {
      adjacency.get(edge.source)!.push({
        neighbor: edge.target,
        pages: edge.jumps,
        trunk: edge.trunk,
      });
    }
    if (edge.back > 0) {
      adjacency.get(edge.target)!.push({
        neighbor: edge.source,
        pages: edge.back,
        trunk: edge.trunk,
      });
    }
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((a, b) => a.neighbor.localeCompare(b.neighbor));
  }
  type RoutePhase = "access" | "ride" | "egress";
  const phases: RoutePhase[] = ["access", "ride", "egress"];
  const stateKey = (domain: string, phase: RoutePhase) => `${phase}\0${domain}`;
  const startKey = stateKey(from, "access");
  const distances = new Map<string, number>([[startKey, 0]]);
  const previous = new Map<string, string>();
  const previousLeg = new Map<string, PathLeg>();
  const settled = new Set<string>();
  const queue = new RouteQueue();
  queue.push({ distance: 0, key: startKey });

  while (true) {
    const entry = queue.pop();
    if (!entry) break;
    const { distance: currentDistance, key: currentKey } = entry;
    if (
      settled.has(currentKey) ||
      currentDistance !== distances.get(currentKey)
    ) {
      continue;
    }
    settled.add(currentKey);
    const separator = currentKey.indexOf("\0");
    const phase = currentKey.slice(0, separator) as RoutePhase;
    const current = currentKey.slice(separator + 1);

    // big-web hubs cannot be transit: everyone links instagram, so routing
    // through it would make every pair of sites two hops apart
    if (kindByDomain.get(current) === "hub" && current !== from) continue;

    for (const { neighbor, pages, trunk } of adjacency.get(current)!) {
      if (kindByDomain.get(neighbor) === "hub" && neighbor !== to) continue;
      let nextPhase: RoutePhase;
      if (trunk) {
        if (phase === "egress") continue;
        nextPhase = "ride";
      } else {
        nextPhase = phase === "ride" ? "egress" : phase;
      }
      const neighborKey = stateKey(neighbor, nextPhase);
      if (settled.has(neighborKey)) continue;
      const directionalPages =
        kindByDomain.get(current) === "interchange" ? Math.min(pages, 1) : pages;
      const candidate =
        currentDistance +
        (trunk ? 1 : 1.6) +
        1 / Math.log2(2 + directionalPages);
      const known = distances.get(neighborKey) ?? Infinity;
      if (candidate < known) {
        distances.set(neighborKey, candidate);
        previous.set(neighborKey, currentKey);
        previousLeg.set(neighborKey, {
          from: current,
          to: neighbor,
          kind: trunk ? "ride" : "walk",
        });
        queue.push({ distance: candidate, key: neighborKey });
      }
    }
  }

  const destination = phases
    .map((phase) => stateKey(to, phase))
    .sort(
      (left, right) =>
        (distances.get(left) ?? Infinity) -
          (distances.get(right) ?? Infinity) ||
        left.localeCompare(right)
    )[0];
  const distance = distances.get(destination) ?? Infinity;
  if (distance === Infinity) return { distance, path: [], legs: [] };
  const legs: PathLeg[] = [];
  let currentKey = destination;
  while (currentKey !== startKey) {
    legs.unshift(previousLeg.get(currentKey)!);
    currentKey = previous.get(currentKey)!;
  }
  const route = [from, ...legs.map((leg) => leg.to)];
  return { distance, path: route, legs };
}

function shortestPath(
  graph: SnowballGraph,
  from: string,
  to: string
): ShortestPath {
  if (!graph.domains[from] || !graph.domains[to]) {
    return { distance: Infinity, path: [], legs: [] };
  }
  return transitShortestPath(makeGalaxyGraph(graph), from, to);
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

function parseMergeOptions(args: string[]): MergeOptions {
  const options = parseCrawlOptions(args);
  const graph = flagValue(args, "--graph");
  if (!graph) throw new Error("--graph is required in merge mode");
  return { ...options, graph: path.resolve(graph) };
}

async function runCrawl(
  options: CrawlOptions,
  existingRaw?: SnowballGraph
): Promise<void> {
  const raw: SnowballGraph = {
    seeds: [...new Set([...(existingRaw?.seeds ?? []), ...options.seeds])].sort(),
    params: {
      maxDomains: options.maxDomains,
      maxPages: options.maxPages,
      depth: options.depth,
    },
    domains: existingRaw?.domains ?? {},
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
    const existing = raw.domains[seed];
    raw.domains[seed] = existing
      ? { ...existing, depth: 0 }
      : emptyDomain(0);
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
      const existing = raw.domains[domain];
      // seeds are the map's origins and deserve thorough charting
      const pageBudget =
        ringDepth === 0 ? options.maxPages * SEED_PAGE_MULTIPLIER : options.maxPages;
      const result =
        existing.pagesCrawled > 0
          ? existing
          : await crawlDomain(domain, pageBudget);
      if (existing.pagesCrawled === 0) {
        raw.domains[domain] = { depth: ringDepth, ...result };
        crawled++;
      }

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
  if (result.path.length === 0) {
    console.log("unreachable");
    console.log("distance: Infinity");
    console.log("hops: 0");
    return;
  }
  const route = result.legs.reduce(
    (text, leg) => `${text} =${leg.kind}=> ${leg.to}`,
    result.path[0]
  );
  console.log(route);
  console.log(`distance: ${result.distance}`);
  console.log(`hops: ${result.legs.length}`);
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
  else if (args.includes("--merge")) {
    const options = parseMergeOptions(args);
    const raw = JSON.parse(
      readFileSync(options.graph, "utf-8")
    ) as SnowballGraph;
    await runCrawl(options, raw);
  }
  else await runCrawl(parseCrawlOptions(args));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
