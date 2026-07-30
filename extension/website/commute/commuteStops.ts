// ABOUTME: Turns recent WWO navigation events into safe, deduplicated train stops.
// ABOUTME: Provides sample destinations when the live event stream is quiet.

import type { CollectionEvent } from "../shared/types";

export interface CommuteStop {
  id: string;
  url: string;
  domain: string;
  path: string;
  source: "live" | "sample";
}

export const SAMPLE_STOPS: CommuteStop[] = [
  {
    id: "shrine-computer",
    url: "https://shrine.computer/",
    domain: "shrine.computer",
    path: "/",
    source: "sample",
  },
  {
    id: "radio-garden",
    url: "https://radio.garden/",
    domain: "radio.garden",
    path: "/",
    source: "sample",
  },
  {
    id: "neal-deep-sea",
    url: "https://neal.fun/deep-sea/",
    domain: "neal.fun",
    path: "/deep-sea/",
    source: "sample",
  },
  {
    id: "everynoise",
    url: "https://everynoise.com/",
    domain: "everynoise.com",
    path: "/",
    source: "sample",
  },
  {
    id: "window-swap",
    url: "https://www.window-swap.com/",
    domain: "window-swap.com",
    path: "/",
    source: "sample",
  },
];

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
