// ABOUTME: Reads what a site publishes for bots (robots.txt and sitemaps) as evidence about one page.
// ABOUTME: Used when the page itself refuses a logged-out fetch, so Clef still learns how the site treats it.

import { normalizeInternetPlace } from "../../../shared/internetPlaceCatalog";
import { fetchPublicPage } from "./pageMeta";

/** How a site's own bot-facing files describe one of its pages. */
export interface PublishedSignals {
  /** Whether robots.txt asks bots to stay out of this page's path. */
  disallowed: boolean;
  /** How many sitemaps robots.txt lists. */
  sitemaps: number;
  /** Whether a checked sitemap lists this exact page. Absent when none was checked. */
  sitemapListed?: boolean;
}

export type RobotsRule = { allow: boolean; pattern: string };

export interface RobotsFile {
  rules: RobotsRule[];
  sitemaps: string[];
}

/** The product token our fetcher names in its user agent. */
const ROBOTS_AGENT = "wewere-online";
const MAX_ROBOTS_BYTES = 256 * 1_024;
const MAX_SITEMAP_BYTES = 4 * 1_024 * 1_024;
const MAX_SITEMAP_FETCHES = 4;
const MAX_SITEMAPS_CONSIDERED = 50;

/**
 * Parses robots.txt into the rules for our fetcher: the group naming our
 * agent when there is one, otherwise the `*` group. Sitemap lines are global.
 */
export function parseRobots(text: string): RobotsFile {
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "sitemap") {
      if (value && sitemaps.length < MAX_SITEMAPS_CONSIDERED)
        sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    if ((field === "allow" || field === "disallow") && current) {
      lastWasAgent = false;
      // An empty Disallow allows everything, so it adds no rule.
      if (value)
        current.rules.push({ allow: field === "allow", pattern: value });
    }
  }
  const ours = groups.filter((group) =>
    group.agents.some(
      (agent) => agent !== "*" && ROBOTS_AGENT.startsWith(agent),
    ),
  );
  const chosen =
    ours.length > 0
      ? ours
      : groups.filter((group) => group.agents.includes("*"));
  return { rules: chosen.flatMap((group) => group.rules), sitemaps };
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const expression = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}${anchored ? "$" : ""}`).test(path);
}

/**
 * Applies robots rules the way major crawlers do: the longest matching
 * pattern wins, and Allow wins a tie.
 */
export function isPathDisallowed(
  rules: RobotsRule[],
  pathWithQuery: string,
): boolean {
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!patternMatches(rule.pattern, pathWithQuery)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return Boolean(best && !best.allow);
}

/** Every `<loc>` in a sitemap or sitemap index, and which kind it is. */
export function parseSitemap(xml: string): {
  index: boolean;
  locations: string[];
} {
  const index = /<sitemapindex[\s>]/i.test(xml);
  const locations = [
    ...xml.matchAll(
      /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi,
    ),
  ].map((match) => match[1].replace(/&amp;/g, "&"));
  return { index, locations };
}

function samePage(first: string, second: string): boolean {
  try {
    return (
      normalizeInternetPlace(first, "page") ===
      normalizeInternetPlace(second, "page")
    );
  } catch {
    return false;
  }
}

async function readCapped(
  response: Response,
  maxBytes: number,
  gzip: boolean,
): Promise<string | null> {
  if (!response.body) return null;
  const stream = gzip
    ? response.body.pipeThrough(new DecompressionStream("gzip"))
    : response.body;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

async function fetchText(
  raw: string,
  maxBytes: number,
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const fetched = await fetchPublicPage(url);
  if ("inspection" in fetched || !fetched.response.ok) return null;
  const gzip =
    fetched.finalUrl.pathname.endsWith(".gz") &&
    !(fetched.response.headers.get("content-type") ?? "").includes("xml");
  try {
    return await readCapped(fetched.response, maxBytes, gzip);
  } catch {
    return null;
  }
}

/**
 * Looks for the page in the site's sitemaps, news sitemaps first because they
 * list the newest pages. Gives up after a few files: a big site can have
 * thousands, so a miss means "not found in what we read", not "unlisted".
 */
async function findInSitemaps(
  pageUrl: string,
  sitemaps: string[],
): Promise<boolean | undefined> {
  const queue = [...sitemaps].sort(
    (first, second) =>
      Number(/news/i.test(second)) - Number(/news/i.test(first)),
  );
  let fetches = 0;
  let checked = false;
  while (queue.length > 0 && fetches < MAX_SITEMAP_FETCHES) {
    const next = queue.shift()!;
    fetches += 1;
    const xml = await fetchText(next, MAX_SITEMAP_BYTES);
    if (!xml) continue;
    const { index, locations } = parseSitemap(xml);
    if (index) {
      const children = locations.sort(
        (first, second) =>
          Number(/news/i.test(second)) - Number(/news/i.test(first)),
      );
      queue.unshift(...children.slice(0, MAX_SITEMAP_FETCHES));
      continue;
    }
    checked = true;
    if (locations.some((location) => samePage(location, pageUrl))) return true;
  }
  return checked ? false : undefined;
}

/** Reads robots.txt and sitemaps for a page. Null when the site serves no robots.txt. */
export async function readPublishedSignals(
  pageUrl: string,
): Promise<PublishedSignals | null> {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  const robotsText = await fetchText(
    `${url.origin}/robots.txt`,
    MAX_ROBOTS_BYTES,
  );
  if (robotsText === null) return null;
  const robots = parseRobots(robotsText);
  const disallowed = isPathDisallowed(
    robots.rules,
    `${url.pathname}${url.search}`,
  );
  const sitemapListed = disallowed
    ? undefined
    : await findInSitemaps(pageUrl, robots.sitemaps);
  return {
    disallowed,
    sitemaps: robots.sitemaps.length,
    ...(sitemapListed !== undefined ? { sitemapListed } : {}),
  };
}
