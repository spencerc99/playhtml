// ABOUTME: Parses the commute API response into train stops and passing scenery.
// ABOUTME: Formats stop titles, favicons, and ages for the commute scene.

import type { CommuteResponse } from "@playhtml/extension-types";

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

const PASSING_SCENERY_COUNT = 4;

export function getPassingSceneryStops(
  stops: CommuteStop[],
  currentDomain: string,
  stopIndex: number,
): CommuteStop[] {
  const candidates = stops.filter((stop) => stop.domain !== currentDomain);
  if (candidates.length <= PASSING_SCENERY_COUNT) return candidates;

  const start = (stopIndex * PASSING_SCENERY_COUNT) % candidates.length;
  return [...candidates, ...candidates].slice(
    start,
    start + PASSING_SCENERY_COUNT,
  );
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
  return stop.domain;
}

export function getFaviconUrl(
  stop: Pick<CommuteStop, "domain" | "faviconUrl">,
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

  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(stop.domain)}&sz=64`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSceneryItem(
  value: unknown,
): value is CommuteResponse["scenery"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.domain === "string" &&
    typeof value.visitedAt === "number" &&
    typeof value.hue === "string"
  );
}

function isDestination(
  value: unknown,
): value is CommuteResponse["destinations"][number] {
  if (!isSceneryItem(value) || !isRecord(value)) return false;

  return (
    typeof value.url === "string" &&
    (typeof value.title === "string" || value.title === null)
  );
}

function sceneryItemToStop(
  item: CommuteResponse["scenery"][number],
): CommuteStop {
  return {
    id: item.id,
    url: `https://${item.domain}/`,
    domain: item.domain,
    path: "/",
    title: null,
    faviconUrl: null,
    recentDomainVisits: 1,
    visitedBy: "another rider",
    visitedAt: item.visitedAt,
    sampleAge: null,
    hue: item.hue,
    source: "live",
  };
}

function destinationToStop(
  destination: CommuteResponse["destinations"][number],
): CommuteStop {
  const url = new URL(destination.url);
  const domain = url.hostname.replace(/^www\./, "");
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    domain !== destination.domain
  ) {
    throw new Error("Commute response is malformed");
  }

  return {
    id: destination.id,
    url: destination.url,
    domain: destination.domain,
    path: url.pathname || "/",
    title: destination.title,
    faviconUrl: null,
    recentDomainVisits: 1,
    visitedBy: "another rider",
    visitedAt: destination.visitedAt,
    sampleAge: null,
    hue: destination.hue,
    source: "live",
  };
}

export function parseCommuteResponse(payload: unknown): {
  activePeople: number;
  generatedAt: number;
  sceneryStops: CommuteStop[];
  stops: CommuteStop[];
} {
  if (
    !isRecord(payload) ||
    typeof payload.generatedAt !== "number" ||
    typeof payload.activePeople !== "number" ||
    !Array.isArray(payload.scenery) ||
    !payload.scenery.every(isSceneryItem) ||
    !Array.isArray(payload.destinations) ||
    !payload.destinations.every(isDestination)
  ) {
    throw new Error("Commute response is malformed");
  }

  return {
    activePeople: payload.activePeople,
    generatedAt: payload.generatedAt,
    sceneryStops: payload.scenery.map(sceneryItemToStop),
    stops: payload.destinations.map(destinationToStop),
  };
}
