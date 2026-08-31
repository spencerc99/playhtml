// ABOUTME: Boards hosted commute visitors onto authoritative bounded trains.
// ABOUTME: Maps public train stops into the existing commute scene without exposing private URLs.

import type {
  CommuteTrainAssignment,
  CommuteTrainBoardRequest,
  CommuteTrainStop,
} from "@playhtml/extension-types";
import { COMMUTE_TRAIN_BOARD_URL } from "@movement/config";
import type { HostedSlowModeRide } from "../../features/slowMode/slowModeHostedBridge";
import type { CommuteStop } from "./commuteStops";

const COMMUTE_RIDER_TOKEN_KEY = "wwo-commute-rider-token";
const COMMUTE_TRAIN_REFRESH_MS = 3_000;

export type CommuteTrainNextAction =
  | { kind: "refresh"; delayMs: number }
  | { kind: "reboard"; delayMs: number };

function createCommuteRiderToken(): string {
  return `web_${crypto.randomUUID()}`;
}

function isTrainStop(value: unknown): value is CommuteTrainStop {
  if (!value || typeof value !== "object") return false;
  const stop = value as Record<string, unknown>;
  const commonFieldsAreValid =
    (stop.kind === "communal" || stop.kind === "domain") &&
    typeof stop.id === "string" &&
    typeof stop.domain === "string" &&
    typeof stop.url === "string" &&
    typeof stop.hue === "string";
  if (!commonFieldsAreValid) return false;
  try {
    const url = new URL(stop.url as string);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  } catch {
    return false;
  }
  return stop.kind === "communal"
    ? (stop.title === null || typeof stop.title === "string") &&
        typeof stop.visitedAt === "number"
    : typeof stop.claimantCount === "number";
}

export function parseCommuteTrainAssignment(
  value: unknown,
): CommuteTrainAssignment {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid commute train assignment");
  }
  const assignment = value as Partial<CommuteTrainAssignment>;
  if (
    typeof assignment.trainId !== "string" ||
    typeof assignment.createdAt !== "number" ||
    typeof assignment.departureAt !== "number" ||
    typeof assignment.joinableUntil !== "number" ||
    typeof assignment.routeEndsAt !== "number" ||
    typeof assignment.routeVersion !== "number" ||
    typeof assignment.riderCount !== "number" ||
    typeof assignment.capacity !== "number" ||
    typeof assignment.joinable !== "boolean" ||
    (assignment.phase !== "boarding" &&
      assignment.phase !== "riding" &&
      assignment.phase !== "complete") ||
    !Array.isArray(assignment.stops) ||
    !assignment.stops.every(isTrainStop) ||
    assignment.stops.length === 0 ||
    typeof assignment.serverNow !== "number"
  ) {
    throw new Error("Invalid commute train assignment");
  }
  return assignment as CommuteTrainAssignment;
}

export function getCommuteRiderToken(
  ride: HostedSlowModeRide | null,
): string {
  if (ride) return `slow_${ride.rideId}`;
  const stored = window.sessionStorage.getItem(COMMUTE_RIDER_TOKEN_KEY);
  if (stored) return stored;
  const token = createCommuteRiderToken();
  window.sessionStorage.setItem(COMMUTE_RIDER_TOKEN_KEY, token);
  return token;
}

export function rotateCommuteRiderToken(): string {
  const token = createCommuteRiderToken();
  window.sessionStorage.setItem(COMMUTE_RIDER_TOKEN_KEY, token);
  return token;
}

export function getCommuteTrainNextAction(
  assignment: CommuteTrainAssignment,
): CommuteTrainNextAction {
  if (assignment.joinable) {
    return { kind: "refresh", delayMs: COMMUTE_TRAIN_REFRESH_MS };
  }
  return {
    kind: "reboard",
    delayMs: Math.max(0, assignment.routeEndsAt - assignment.serverNow),
  };
}

export function createCommuteTrainBoardRequest(
  riderToken: string,
  ride: HostedSlowModeRide | null,
): CommuteTrainBoardRequest {
  return {
    riderToken,
    requestedStop:
      ride && ride.stopVisibility !== "private"
        ? { kind: "domain", domain: ride.destinationDomain }
        : { kind: "none" },
  };
}

export async function boardCommuteTrain(
  request: CommuteTrainBoardRequest,
  signal?: AbortSignal,
): Promise<CommuteTrainAssignment> {
  const response = await fetch(COMMUTE_TRAIN_BOARD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Commute train boarding failed: ${response.status}`);
  }
  return parseCommuteTrainAssignment(await response.json());
}

export function getCommuteTrainTimeOffset(
  assignment: CommuteTrainAssignment,
  requestStartedAt: number,
  responseReceivedAt: number,
): number {
  return assignment.serverNow - (requestStartedAt + responseReceivedAt) / 2;
}

export function toCommuteStop(stop: CommuteTrainStop): CommuteStop {
  return {
    id: stop.id,
    url: stop.url,
    domain: stop.domain,
    path: new URL(stop.url).pathname || "/",
    title: stop.kind === "communal" ? stop.title : stop.domain,
    faviconUrl: null,
    recentDomainVisits: stop.kind === "domain" ? stop.claimantCount : 1,
    visitedBy: stop.kind === "domain" ? "rider" : "commute",
    visitedAt: stop.kind === "communal" ? stop.visitedAt : null,
    sampleAge: null,
    hue: stop.hue,
    source: "live",
  };
}
