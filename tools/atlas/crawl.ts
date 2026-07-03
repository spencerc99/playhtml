// ABOUTME: Enrichment crawler for the playhtml atlas: founding year via RDAP, plus a
// ABOUTME: small polite same-domain crawl per site to find links to other atlas sites.

// Usage: bun tools/atlas/crawl.ts [--max-pages 25]
// Reads website/map-domains.json, writes website/map-enrichment.json.
// Meant to run on a schedule (or by hand) whenever the snapshot is regenerated;
// output is committed so the map never depends on live crawling.

import { readFileSync, writeFileSync } from "fs";
import path from "path";

const ROOT = path.join(import.meta.dir, "../..");
const SNAPSHOT = path.join(ROOT, "website/map-domains.json");
const OUTPUT = path.join(ROOT, "website/map-enrichment.json");

const maxPagesFlag = process.argv.indexOf("--max-pages");
const MAX_PAGES = maxPagesFlag >= 0 ? Number(process.argv[maxPagesFlag + 1]) : 25;
const MAX_DEPTH = 3;
const DOMAIN_CONCURRENCY = 12;
const PAGE_DELAY_MS = 150;
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 500_000;
const USER_AGENT = "playhtml-atlas-crawler/0.1 (+https://playhtml.fun/map)";

// Hosting platforms where the subdomain is the site (mirrors the snapshot cleaning)
const SITE_SUFFIXES = [
  "pages.dev", "netlify.app", "vercel.app", "github.io", "glitch.me",
  "neocities.org", "onrender.com", "fly.dev", "web.app", "firebaseapp.com",
  "herokuapp.com", "codepen.dev", "codepen.io", "wixsite.com", "deno.dev",
  "workers.dev", "webflow.io", "surge.sh", "repl.co",
];

interface SnapshotEntry {
  domain: string;
  rooms: number;
  activity: number;
}

interface Enrichment {
  founded: number | null;
  /** Year of first Wayback Machine capture; age backfill when RDAP has nothing */
  waybackFirst: number | null;
  /** Unique URLs the Wayback Machine has archived for this domain (capped) */
  waybackUrls: number | null;
  /** URL count from sitemap.xml, if the site publishes one (capped) */
  sitemapUrls: number | null;
  title: string | null;
  favicon: string | null;
  links: string[];
  pagesCrawled: number;
  alive: boolean;
}

const WAYBACK_URL_CAP = 2000;

async function waybackInfo(
  domain: string
): Promise<{ first: number | null; urls: number | null }> {
  const url =
    `https://web.archive.org/cdx/search/cdx?url=${domain}&matchType=domain` +
    `&collapse=urlkey&fl=timestamp&filter=statuscode:200&limit=${WAYBACK_URL_CAP}&output=json`;
  const res = await waybackSlot(() => fetchWithTimeout(url, "application/json"));
  if (!res || !res.ok) return { first: null, urls: null };
  try {
    const rows = (await res.json()) as string[][];
    if (!Array.isArray(rows) || rows.length < 2) return { first: null, urls: 0 };
    let earliest = Infinity;
    for (let i = 1; i < rows.length; i++) {
      const year = Number(rows[i][0]?.slice(0, 4));
      if (year && year < earliest) earliest = year;
    }
    return {
      first: Number.isFinite(earliest) ? earliest : null,
      urls: rows.length - 1,
    };
  } catch {
    return { first: null, urls: null };
  }
}

async function sitemapUrlCount(origin: string): Promise<number | null> {
  const res = await fetchWithTimeout(`${origin}/sitemap.xml`, "application/xml");
  if (!res || !res.ok) return null;
  if (!/xml|text/.test(res.headers.get("content-type") || "")) return null;
  try {
    const text = (await res.text()).slice(0, 2_000_000);
    const count = (text.match(/<loc>/g) || []).length;
    return count > 0 ? count : null;
  } catch {
    return null;
  }
}

function baseDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  for (const suf of SITE_SUFFIXES) {
    if (h.endsWith("." + suf)) {
      const stem = h.slice(0, -(suf.length + 1));
      let site = stem.split(".").pop()!;
      // vercel deploy previews: project-<hash>-team -> project-team
      const preview = site.match(/^(.+)-[a-z0-9]{9}-([a-z0-9-]+)$/);
      if (suf === "vercel.app" && preview) {
        site = `${preview[1]}-${preview[2]}`;
      }
      return `${site}.${suf}`;
    }
  }
  const labels = h.split(".");
  return labels.slice(-2).join(".");
}

async function fetchWithTimeout(
  url: string,
  accept: string
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: accept },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Shared-host APIs (rdap.org, web.archive.org) rate-limit aggressive clients;
// serialize each behind its own slow lane instead of hitting them per-worker.
function makeLane(spacingMs: number) {
  let chain: Promise<unknown> = Promise.resolve();
  return function slot<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const value = await task();
      await new Promise((r) => setTimeout(r, spacingMs));
      return value;
    });
    chain = run.catch(() => undefined);
    return run;
  };
}
const rdapSlot = makeLane(300);
const waybackSlot = makeLane(900);

function isPlatformSubdomain(domain: string): boolean {
  return SITE_SUFFIXES.some((suf) => domain.endsWith("." + suf));
}

async function rdapFounded(domain: string): Promise<number | null> {
  // platform subdomains have no registration of their own
  if (isPlatformSubdomain(domain)) return null;
  let res = await rdapSlot(() =>
    fetchWithTimeout(`https://rdap.org/domain/${domain}`, "application/json")
  );
  if (res && res.status === 429) {
    await new Promise((r) => setTimeout(r, 3000));
    res = await rdapSlot(() =>
      fetchWithTimeout(`https://rdap.org/domain/${domain}`, "application/json")
    );
  }
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as {
      events?: { eventAction: string; eventDate: string }[];
    };
    const reg = data.events?.find((e) => e.eventAction === "registration");
    if (!reg) return null;
    const year = new Date(reg.eventDate).getUTCFullYear();
    return Number.isFinite(year) ? year : null;
  } catch {
    return null;
  }
}

async function robotsDisallows(origin: string): Promise<string[]> {
  const res = await fetchWithTimeout(`${origin}/robots.txt`, "text/plain");
  if (!res || !res.ok) return [];
  try {
    const text = await res.text();
    const rules: string[] = [];
    let applies = false;
    for (const rawLine of text.split("\n")) {
      const line = rawLine.split("#")[0].trim();
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (/^user-agent$/i.test(key)) applies = value === "*";
      else if (applies && /^disallow$/i.test(key) && value) rules.push(value);
    }
    return rules;
  } catch {
    return [];
  }
}

function extractLinks(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const re = /<a\s[^>]*href\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const url = new URL(m[1], pageUrl);
      if (url.protocol === "http:" || url.protocol === "https:")
        out.push(url.href);
    } catch {
      // unparseable href
    }
  }
  return out;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim().slice(0, 200) || null : null;
}

function extractFavicon(html: string, pageUrl: string): string | null {
  const m = html.match(
    /<link\s[^>]*rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/i
  );
  if (m) {
    const href = m[0].match(/href\s*=\s*["']([^"']+)["']/i);
    if (href) {
      try {
        return new URL(href[1], pageUrl).href;
      } catch {
        // fall through to default
      }
    }
  }
  try {
    return new URL("/favicon.ico", pageUrl).href;
  } catch {
    return null;
  }
}

const SKIP_EXTENSIONS =
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|json|xml|pdf|zip|mp[34]|webm|woff2?|ttf)$/i;

async function crawlDomain(
  entry: SnapshotEntry,
  atlasDomains: Set<string>
): Promise<Enrichment> {
  const result: Enrichment = {
    founded: null,
    waybackFirst: null,
    waybackUrls: null,
    sitemapUrls: null,
    title: null,
    favicon: null,
    links: [],
    pagesCrawled: 0,
    alive: false,
  };

  const foundedPromise = rdapFounded(entry.domain);
  const waybackPromise = waybackInfo(entry.domain);

  const origin = `https://${entry.domain}`;
  const sitemapPromise = sitemapUrlCount(origin);
  const disallows = await robotsDisallows(origin);
  const isAllowed = (url: URL) =>
    !disallows.some((rule) => url.pathname.startsWith(rule));

  const queue: { url: string; depth: number }[] = [
    { url: `${origin}/`, depth: 0 },
  ];
  const seen = new Set<string>([`${origin}/`]);
  const outboundBases = new Set<string>();

  while (queue.length > 0 && result.pagesCrawled < MAX_PAGES) {
    const { url, depth } = queue.shift()!;
    const res = await fetchWithTimeout(url, "text/html");
    if (!res || !res.ok) continue;
    if (!(res.headers.get("content-type") || "").includes("text/html"))
      continue;
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

    for (const link of extractLinks(html, url)) {
      let parsed: URL;
      try {
        parsed = new URL(link);
      } catch {
        continue;
      }
      const linkBase = baseDomain(parsed.hostname);
      if (linkBase === entry.domain) {
        // internal: maybe follow
        if (
          depth < MAX_DEPTH &&
          !SKIP_EXTENSIONS.test(parsed.pathname) &&
          isAllowed(parsed)
        ) {
          const normalized = `${parsed.origin}${parsed.pathname}`;
          if (!seen.has(normalized) && seen.size < MAX_PAGES * 4) {
            seen.add(normalized);
            queue.push({ url: normalized, depth: depth + 1 });
          }
        }
      } else if (atlasDomains.has(linkBase)) {
        outboundBases.add(linkBase);
      }
    }
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  result.links = [...outboundBases].sort();
  result.founded = await foundedPromise;
  const wayback = await waybackPromise;
  result.waybackFirst = wayback.first;
  result.waybackUrls = wayback.urls;
  result.sitemapUrls = await sitemapPromise;
  return result;
}

async function main() {
  let snapshot = JSON.parse(
    readFileSync(SNAPSHOT, "utf-8")
  ) as SnapshotEntry[];
  const atlasDomains = new Set(snapshot.map((s) => s.domain));
  const onlyFlag = process.argv.indexOf("--only");
  const writeOutput = onlyFlag < 0;
  if (!writeOutput) {
    const wanted = new Set(process.argv[onlyFlag + 1].split(","));
    snapshot = snapshot.filter((s) => wanted.has(s.domain));
  }
  const results: Record<string, Enrichment> = {};

  let done = 0;
  const queue = [...snapshot];
  const workers = Array.from({ length: DOMAIN_CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const entry = queue.shift()!;
      results[entry.domain] = await crawlDomain(entry, atlasDomains);
      done++;
      if (done % 25 === 0) console.log(`${done}/${snapshot.length} domains`);
    }
  });
  await Promise.all(workers);

  if (writeOutput) writeFileSync(OUTPUT, JSON.stringify(results, null, 1));
  else console.log(JSON.stringify(results, null, 1));

  const alive = Object.values(results).filter((r) => r.alive).length;
  const withLinks = Object.values(results).filter(
    (r) => r.links.length > 0
  ).length;
  const edges = Object.values(results).reduce(
    (n, r) => n + r.links.length,
    0
  );
  const founded = Object.values(results).filter(
    (r) => r.founded !== null
  ).length;
  const wayback = Object.values(results).filter(
    (r) => r.waybackFirst !== null
  ).length;
  console.log(
    `done: ${alive}/${snapshot.length} alive, ${withLinks} sites with atlas links, ` +
      `${edges} edges, ${founded} rdap years, ${wayback} wayback years`
  );
}

main();
