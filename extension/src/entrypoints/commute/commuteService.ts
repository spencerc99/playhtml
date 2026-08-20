// ABOUTME: Selects the ephemeral shared service followed by every Internet Commute rider.
// ABOUTME: Uses server-calibrated time and active presence so an empty train resets at Home.

import type { CommuteStop } from "./commuteStops";
import { getCommuteRouteDurationSeconds } from "./commuteTiming";

export const COMMUTE_SERVICE_CHANNEL = "internet-commute-service";
export const COMMUTE_SERVICE_DISCOVERY_MS = 1_500;
export const COMMUTE_SERVICE_STOP_LIMIT = 10;

export interface CommuteServiceStop {
  url: string;
  title: string | null;
  visitedAt: number | null;
  sampleAge: string | null;
  hue: string;
  source: "live" | "sample";
}

export interface CommuteService {
  id: string;
  startedAt: number;
  stops: CommuteServiceStop[];
}

export interface CommuteServicePresence extends Record<string, unknown> {
  service: CommuteService | null;
}

export function estimateServerTimeOffset(
  serverTimestamp: number,
  requestStartedAt: number,
  responseReceivedAt: number,
): number {
  if (
    !Number.isFinite(serverTimestamp) ||
    !Number.isFinite(requestStartedAt) ||
    !Number.isFinite(responseReceivedAt) ||
    responseReceivedAt < requestStartedAt
  ) {
    throw new Error("Internet Commute requires a valid server timing sample");
  }

  const requestMidpoint =
    requestStartedAt + (responseReceivedAt - requestStartedAt) / 2;
  return serverTimestamp - requestMidpoint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isCommuteServiceStop(value: unknown): value is CommuteServiceStop {
  if (!isRecord(value)) return false;

  return (
    isWebUrl(value.url) &&
    isNullableString(value.title) &&
    (value.visitedAt === null || typeof value.visitedAt === "number") &&
    isNullableString(value.sampleAge) &&
    typeof value.hue === "string" &&
    (value.source === "live" || value.source === "sample")
  );
}

export function isCommuteService(value: unknown): value is CommuteService {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.startedAt === "number" &&
    Number.isFinite(value.startedAt) &&
    value.startedAt > 0 &&
    Array.isArray(value.stops) &&
    value.stops.length > 0 &&
    value.stops.length <= COMMUTE_SERVICE_STOP_LIMIT &&
    value.stops.every(isCommuteServiceStop)
  );
}

export function getCommuteServiceFromPresence(
  presence: unknown,
): CommuteService | null {
  if (!isRecord(presence)) return null;

  const channelValue = presence[COMMUTE_SERVICE_CHANNEL];
  if (!isRecord(channelValue) || !isCommuteService(channelValue.service)) {
    return null;
  }

  return channelValue.service;
}

export function getCommuteServicesFromPresences(
  presences: Iterable<unknown>,
): CommuteService[] {
  const services: CommuteService[] = [];

  for (const presence of presences) {
    const service = getCommuteServiceFromPresence(presence);
    if (service) services.push(service);
  }

  return services;
}

export function selectCommuteService(
  services: Iterable<CommuteService>,
  now: number,
): CommuteService | null {
  let selected: CommuteService | null = null;

  for (const candidate of services) {
    if (getCommuteServiceEndTime(candidate) <= now) continue;
    if (
      selected === null ||
      candidate.startedAt < selected.startedAt ||
      (candidate.startedAt === selected.startedAt &&
        candidate.id.localeCompare(selected.id) < 0)
    ) {
      selected = candidate;
    }
  }

  return selected;
}

export function getCommuteServiceEndTime(service: CommuteService): number {
  return (
    service.startedAt +
    getCommuteRouteDurationSeconds(service.stops.length) * 1_000
  );
}

export function getCommuteServiceDomains(service: CommuteService): string[] {
  return service.stops.map((stop) =>
    new URL(stop.url).hostname.replace(/^www\./, ""),
  );
}

export function getUnvisitedCommuteStops(
  stops: CommuteStop[],
  visitedDomains: Iterable<string>,
): CommuteStop[] {
  const visited = new Set(visitedDomains);
  return stops
    .filter((stop) => !visited.has(stop.domain))
    .slice(0, COMMUTE_SERVICE_STOP_LIMIT);
}

export function createCommuteService(
  startedAt: number,
  creatorId: string,
  stops: CommuteStop[],
): CommuteService {
  if (!Number.isFinite(startedAt) || startedAt <= 0) {
    throw new Error("Internet Commute requires a valid service start time");
  }
  if (creatorId.length === 0) {
    throw new Error("Internet Commute requires a service creator");
  }
  if (stops.length === 0) {
    throw new Error("Internet Commute requires at least one service stop");
  }
  if (stops.length > COMMUTE_SERVICE_STOP_LIMIT) {
    throw new Error(
      `Internet Commute supports at most ${COMMUTE_SERVICE_STOP_LIMIT} stops per service`,
    );
  }

  return {
    id: `${Math.floor(startedAt)}:${creatorId}`,
    startedAt,
    stops: stops.map(
      ({ url, title, visitedAt, sampleAge, hue, source }) => ({
        url,
        title,
        visitedAt,
        sampleAge,
        hue,
        source,
      }),
    ),
  };
}

export function getCommuteStops(service: CommuteService): CommuteStop[] {
  return service.stops.map((stop) => {
    const url = new URL(stop.url);

    return {
      id: stop.url,
      url: stop.url,
      domain: url.hostname.replace(/^www\./, ""),
      path: url.pathname || "/",
      title: stop.title,
      faviconUrl: null,
      recentDomainVisits: 1,
      visitedBy: "another rider",
      visitedAt: stop.visitedAt,
      sampleAge: stop.sampleAge,
      hue: stop.hue,
      source: stop.source,
    };
  });
}
