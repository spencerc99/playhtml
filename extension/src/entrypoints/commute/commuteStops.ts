// ABOUTME: Turns recent WWO navigation events into safe, deduplicated train stops.
// ABOUTME: Provides visit metadata and sample destinations when the stream is quiet.

import type { CollectionEvent } from "@movement/types";

export interface CommuteStop {
  id: string;
  url: string;
  domain: string;
  path: string;
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
    visitedBy: "dim-star-4417",
    visitedAt: null,
    sampleAge: "9m",
    hue: "#b5aea5",
    source: "sample",
  },
];

export function getFaviconUrl(
  stop: Pick<CommuteStop, "domain" | "source" | "url">,
): string {
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

    return {
      id: canonicalUrl,
      url: canonicalUrl,
      domain,
      path,
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

  for (const event of newestFirst) {
    if (event.type !== "navigation") continue;
    const stop = toCommuteStop(event);
    if (!stop || stops.has(stop.url)) continue;

    stops.set(stop.url, stop);
    if (stops.size === limit) break;
  }

  return [...stops.values()];
}
