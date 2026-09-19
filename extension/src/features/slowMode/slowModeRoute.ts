// ABOUTME: Builds private Slow Mode routes from communal and bundled commute stops.
// ABOUTME: Preserves the intended destination as the final stop and avoids recent domains.

import {
  SAMPLE_STOPS,
  type CommuteStop,
} from "../../entrypoints/commute/commuteStops";

export interface SlowModeRequest {
  destinationUrl: string;
  rideId: string;
  stopCount: 2 | 3;
}

const TRACKING_PARAMETER_PREFIXES = ["utm_"];
const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
]);

export function stripTrackingParameters(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (
      TRACKING_PARAMETERS.has(key.toLowerCase()) ||
      TRACKING_PARAMETER_PREFIXES.some((prefix) =>
        key.toLowerCase().startsWith(prefix),
      )
    ) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

function destinationStop(destinationUrl: string): CommuteStop {
  const sanitizedUrl = stripTrackingParameters(destinationUrl);
  const url = new URL(sanitizedUrl);
  const domain = url.hostname.replace(/^www\./, "");
  return {
    id: `destination:${sanitizedUrl}`,
    url: sanitizedUrl,
    domain,
    path: url.pathname || "/",
    title: domain,
    faviconUrl: null,
    recentDomainVisits: 1,
    visitedBy: "you",
    visitedAt: Date.now(),
    sampleAge: null,
    hue: "#4a9a8a",
    source: "sample",
  };
}

export function parseSlowModeRequest(search: string): SlowModeRequest | null {
  const params = new URLSearchParams(search);
  if (params.get("slow") !== "1") return null;
  const destinationUrl = params.get("destination");
  const rideId = params.get("ride");
  const stopCount = Number(params.get("stops"));
  if (!destinationUrl || !rideId || (stopCount !== 2 && stopCount !== 3)) {
    return null;
  }
  try {
    const url = new URL(destinationUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return {
    destinationUrl: stripTrackingParameters(destinationUrl),
    rideId,
    stopCount,
  };
}

export function buildSlowModeRoute(
  communalStops: CommuteStop[],
  destinationUrl: string,
  stopCount: number,
  recentRiderDomains: string[],
  random: () => number = Math.random,
): CommuteStop[] {
  const terminus = destinationStop(destinationUrl);
  const excludedDomains = new Set([
    terminus.domain,
    ...recentRiderDomains.slice(0, 10),
  ]);
  const candidates = [...communalStops, ...SAMPLE_STOPS].filter((stop) => {
    if (excludedDomains.has(stop.domain)) return false;
    excludedDomains.add(stop.domain);
    return true;
  });

  if (candidates.length < stopCount) {
    const selectedDomains = new Set(candidates.map((stop) => stop.domain));
    for (const stop of [...communalStops, ...SAMPLE_STOPS]) {
      if (stop.domain === terminus.domain || selectedDomains.has(stop.domain)) {
        continue;
      }
      selectedDomains.add(stop.domain);
      candidates.push(stop);
      if (candidates.length === stopCount) break;
    }
  }

  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [candidates[index], candidates[swapIndex]] = [
      candidates[swapIndex],
      candidates[index],
    ];
  }

  return [...candidates.slice(0, stopCount), terminus];
}
