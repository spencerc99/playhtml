// ABOUTME: Turns recent WWO navigation events into safe, deduplicated train stops.
// ABOUTME: Curates landing routes while preserving the full pool for scenery.

import type { CollectionEvent } from "@movement/types";

export interface CommuteStop {
  id: string;
  url: string;
  domain: string;
  path: string;
  title: string | null;
  faviconUrl: string | null;
  recentDomainVisits: number;
  visitedBy: string;
  visitedAt: number | null;
  sampleAge: string | null;
  hue: string;
  source: "live" | "sample";
}

export const SAMPLE_STOPS: CommuteStop[] = [
  {
    id: "html-energy",
    url: "https://html.energy/",
    domain: "html.energy",
    path: "/",
    title: null,
    faviconUrl: null,
    recentDomainVisits: 1,
    visitedBy: "amber-moth-2210",
    visitedAt: null,
    sampleAge: "3m",
    hue: "#d4b85c",
    source: "sample",
  },
  {
    id: "special-fish",
    url: "https://special.fish/",
    domain: "special.fish",
    path: "/",
    title: null,
    faviconUrl: null,
    recentDomainVisits: 1,
    visitedBy: "quiet-lantern-3704",
    visitedAt: null,
    sampleAge: "7m",
    hue: "#5b8db8",
    source: "sample",
  },
  {
    id: "html-review",
    url: "https://thehtml.review/",
    domain: "thehtml.review",
    path: "/",
    title: null,
    faviconUrl: null,
    recentDomainVisits: 1,
    visitedBy: "paper-crane-8841",
    visitedAt: null,
    sampleAge: "12m",
    hue: "#8b6b7f",
    source: "sample",
  },
  {
    id: "playhtml",
    url: "https://playhtml.fun/",
    domain: "playhtml.fun",
    path: "/",
    title: null,
    faviconUrl: null,
    recentDomainVisits: 1,
    visitedBy: "low-tide-0952",
    visitedAt: null,
    sampleAge: "2m",
    hue: "#8fa877",
    source: "sample",
  },
  {
    id: "wiby",
    url: "https://wiby.me/",
    domain: "wiby.me",
    path: "/",
    title: null,
    faviconUrl: null,
    recentDomainVisits: 1,
    visitedBy: "dim-star-4417",
    visitedAt: null,
    sampleAge: "9m",
    hue: "#b5aea5",
    source: "sample",
  },
];

const NEVER_LAND_DOMAINS = ["x.com", "twitter.com", "gemini.google.com"];
const TITLE_REQUIRED_DOMAINS = [
  "youtube.com",
  "youtu.be",
  "github.com",
  "wikipedia.org",
  "itch.io",
  "wordpress.com",
  "tiktok.com",
  "instagram.com",
];
const GENERIC_PATHS = [
  "/dashboard",
  "/feed",
  "/home",
  "/newtab",
  "/search",
];
const NEVER_LAND_PATH_SEGMENTS = new Set([
  "auth",
  "authorize",
  "login",
  "oauth",
  "outbound",
  "redirect",
  "redir",
  "signin",
  "sso",
]);
const GENERIC_TITLES = new Set([
  "attentionrequiredcloudflare",
  "checkingyourbrowser",
  "dashboard",
  "home",
  "homepage",
  "justamoment",
  "login",
  "newtab",
  "search",
  "signin",
  "untitled",
]);

function domainMatches(domain: string, candidate: string): boolean {
  return domain === candidate || domain.endsWith(`.${candidate}`);
}

function comparableLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hasUnusableTitle(stop: CommuteStop): boolean {
  const title = stop.title?.trim() ?? "";
  return (
    GENERIC_TITLES.has(comparableLabel(title)) ||
    /^https?:\/\/\S+$/i.test(title)
  );
}

function hasBlockedPath(stop: CommuteStop): boolean {
  if (
    GENERIC_PATHS.some(
      (path) => stop.path === path || stop.path.startsWith(`${path}/`),
    )
  ) {
    return true;
  }

  return stop.path
    .split("/")
    .some((segment) =>
      NEVER_LAND_PATH_SEGMENTS.has(comparableLabel(segment)),
    );
}

export function getMeaningfulStopTitle(stop: CommuteStop): string | null {
  const title = stop.title?.replace(/\s+/g, " ").trim();
  if (!title || title.length < 3 || title.length > 100) return null;
  if (hasUnusableTitle(stop)) return null;

  const comparableTitle = comparableLabel(title);
  const domainParts = stop.domain.split(".");
  const comparableDomains = new Set([
    comparableLabel(stop.domain),
    comparableLabel(domainParts[0]),
    comparableLabel(domainParts.slice(0, -1).join(" ")),
  ]);

  return comparableDomains.has(comparableTitle) ? null : title;
}

export function getStopDisplayName(stop: CommuteStop): string {
  return getMeaningfulStopTitle(stop) ?? stop.domain;
}

export function getStopDisplayDetail(stop: CommuteStop): string {
  if (getMeaningfulStopTitle(stop)) {
    return `${stop.domain}${stop.path === "/" ? "" : stop.path}`;
  }

  return stop.path === "/" ? "front page" : stop.path;
}

export function curateCommuteStops(
  stops: CommuteStop[],
  limit = 10,
): CommuteStop[] {
  const curated: CommuteStop[] = [];
  const seenDomains = new Set<string>();
  const stopsByRider = new Map<string, number>();
  const rankedStops = [...stops].sort((a, b) => {
    const visitDifference = a.recentDomainVisits - b.recentDomainVisits;
    if (visitDifference !== 0) return visitDifference;
    return (b.visitedAt ?? 0) - (a.visitedAt ?? 0);
  });

  for (const stop of rankedStops) {
    if (hasUnusableTitle(stop)) continue;
    if (hasBlockedPath(stop)) continue;
    if (
      NEVER_LAND_DOMAINS.some((domain) =>
        domainMatches(stop.domain, domain),
      )
    ) {
      continue;
    }
    if (
      TITLE_REQUIRED_DOMAINS.some((domain) =>
        domainMatches(stop.domain, domain),
      ) &&
      !getMeaningfulStopTitle(stop)
    ) {
      continue;
    }
    if (seenDomains.has(stop.domain)) continue;

    const riderStopCount = stopsByRider.get(stop.visitedBy) ?? 0;
    if (riderStopCount >= 2) continue;

    curated.push(stop);
    seenDomains.add(stop.domain);
    stopsByRider.set(stop.visitedBy, riderStopCount + 1);
    if (curated.length === limit) break;
  }

  return curated;
}

export function getFaviconUrl(
  stop: Pick<CommuteStop, "domain" | "faviconUrl" | "source" | "url">,
): string {
  if (stop.faviconUrl) {
    try {
      const faviconUrl = new URL(stop.faviconUrl);
      if (faviconUrl.protocol === "https:" || faviconUrl.protocol === "http:") {
        return faviconUrl.toString();
      }
    } catch {
      // Fall through to the destination origin when metadata is malformed.
    }
  }

  if (stop.source === "sample") {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(stop.domain)}&sz=64`;
  }

  return new URL("/favicon.ico", stop.url).toString();
}

export function formatStopAge(stop: CommuteStop, now = Date.now()): string {
  if (stop.sampleAge) return stop.sampleAge;
  if (stop.visitedAt === null) return "recently";

  const elapsedSeconds = Math.max(0, Math.floor((now - stop.visitedAt) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;

  return `${Math.floor(elapsedMinutes / 60)}h`;
}

function formatRiderLabel(playerId: string): string {
  if (playerId.length <= 24) return playerId;
  return `rider-${playerId.slice(-6)}`;
}

function toCommuteStop(event: CollectionEvent): CommuteStop | null {
  const candidate = event.normalizedUrl ?? event.meta?.url;
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const domain = url.hostname.replace(/^www\./, "");
    if (!domain) return null;

    const path = url.pathname || "/";
    const canonicalUrl = `${url.protocol}//${url.host}${path}`;
    const data = event.data as Record<string, unknown>;
    const title = typeof data.title === "string" ? data.title : null;
    const faviconUrl =
      typeof data.favicon_url === "string" ? data.favicon_url : null;

    return {
      id: canonicalUrl,
      url: canonicalUrl,
      domain,
      path,
      title,
      faviconUrl,
      recentDomainVisits: 1,
      visitedBy: formatRiderLabel(event.meta.pid),
      visitedAt: event.ts,
      sampleAge: null,
      hue: event.meta.cursor_color ?? "#4a9a8a",
      source: "live",
    };
  } catch {
    return null;
  }
}

export function deriveRecentStops(
  events: CollectionEvent[],
  limit = 5,
): CommuteStop[] {
  const stops = new Map<string, CommuteStop>();
  const newestFirst = [...events].sort((a, b) => b.ts - a.ts);
  const parsedStops = newestFirst
    .filter((event) => event.type === "navigation")
    .map(toCommuteStop)
    .filter((stop): stop is CommuteStop => stop !== null);
  const visitsByDomain = new Map<string, number>();

  for (const stop of parsedStops) {
    visitsByDomain.set(stop.domain, (visitsByDomain.get(stop.domain) ?? 0) + 1);
  }

  for (const stop of parsedStops) {
    if (stops.has(stop.url)) continue;

    stops.set(stop.url, {
      ...stop,
      recentDomainVisits: visitsByDomain.get(stop.domain) ?? 1,
    });
    if (stops.size === limit) break;
  }

  return [...stops.values()];
}

export function parseRecentCommuteStops(
  payload: unknown,
  limit = 10,
): CommuteStop[] {
  if (!Array.isArray(payload)) {
    throw new Error("Recent navigation response must be an array");
  }

  return deriveRecentStops(payload as CollectionEvent[], limit);
}
