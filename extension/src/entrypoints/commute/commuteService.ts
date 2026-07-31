// ABOUTME: Selects the ephemeral shared service followed by every Internet Commute rider.
// ABOUTME: Uses server-calibrated time and active presence so an empty train resets at Home.

import type { CommuteStop } from "./commuteStops";

export const COMMUTE_SERVICE_CHANNEL = "internet-commute-service";
export const COMMUTE_SERVICE_DISCOVERY_MS = 1_500;

export interface CommuteService {
  id: string;
  startedAt: number;
  stops: CommuteStop[];
}

export interface CommuteServicePresence extends Record<string, unknown> {
  joinedAt: number;
  service: CommuteService;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCommuteStop(value: unknown): value is CommuteStop {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.domain === "string" &&
    typeof value.path === "string" &&
    isNullableString(value.title) &&
    isNullableString(value.faviconUrl) &&
    typeof value.recentDomainVisits === "number" &&
    typeof value.visitedBy === "string" &&
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
    value.stops.every(isCommuteStop)
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

export function selectCommuteService(
  presences: Iterable<unknown>,
): CommuteService | null {
  let selected: CommuteService | null = null;

  for (const presence of presences) {
    const candidate = getCommuteServiceFromPresence(presence);
    if (!candidate) continue;

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

  return {
    id: `${Math.floor(startedAt)}:${creatorId}`,
    startedAt,
    stops: stops.map((stop) => ({ ...stop })),
  };
}

export function estimateServerTimeOffset(
  generatedAt: number,
  requestStartedAt: number,
  responseReceivedAt: number,
): number {
  if (responseReceivedAt < requestStartedAt) {
    throw new Error("Internet Commute response preceded its request");
  }

  return generatedAt - responseReceivedAt;
}
