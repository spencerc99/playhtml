// ABOUTME: Defines the public boarding contract for synchronized Internet Commute trains.
// ABOUTME: Keeps exact Slow Mode destination URLs outside Worker and PlayHTML state.

export const COMMUTE_TRAIN_CAPACITY = 4;
export const COMMUTE_TRAIN_DEPARTURE_MS = 5_000;
export const COMMUTE_TRAIN_JOIN_WINDOW_MS = 60_000;
export const COMMUTE_TRAIN_TRAVEL_MS = 12_000;
export const COMMUTE_TRAIN_ARRIVAL_MS = 4_000;
export const COMMUTE_TRAIN_PLATFORM_MS = 8_000;
export const COMMUTE_TRAIN_RETURN_TRAVEL_MS = 6_000;
export const COMMUTE_TRAIN_RETURN_ARRIVAL_MS = 4_000;

export type CommuteTrainStopRequest =
  | { kind: "none" }
  | { kind: "domain"; domain: string };

export interface CommuteTrainBoardRequest {
  riderToken: string;
  requestedStop: CommuteTrainStopRequest;
}

interface CommuteTrainStopBase {
  id: string;
  domain: string;
  url: string;
  hue: string;
}

export interface CommuteTrainCommunalStop extends CommuteTrainStopBase {
  kind: "communal";
  title: string | null;
  visitedAt: number;
}

export interface CommuteTrainDomainStop extends CommuteTrainStopBase {
  kind: "domain";
  claimantCount: number;
}

export type CommuteTrainStop =
  | CommuteTrainCommunalStop
  | CommuteTrainDomainStop;

export type CommuteTrainPhase = "boarding" | "riding" | "complete";

export interface CommuteTrainAssignment {
  trainId: string;
  createdAt: number;
  departureAt: number;
  joinableUntil: number;
  routeEndsAt: number;
  routeVersion: number;
  riderCount: number;
  capacity: number;
  joinable: boolean;
  phase: CommuteTrainPhase;
  stops: CommuteTrainStop[];
  serverNow: number;
}

export function getCommuteTrainStopCycleMs(): number {
  return (
    COMMUTE_TRAIN_TRAVEL_MS +
    COMMUTE_TRAIN_ARRIVAL_MS +
    COMMUTE_TRAIN_PLATFORM_MS
  );
}

export function getCommuteTrainReturnStartsAt(
  createdAt: number,
  stopCount: number,
): number {
  return (
    createdAt +
    COMMUTE_TRAIN_DEPARTURE_MS +
    stopCount * getCommuteTrainStopCycleMs()
  );
}

export function getCommuteTrainRouteEndsAt(
  createdAt: number,
  stopCount: number,
): number {
  return (
    getCommuteTrainReturnStartsAt(createdAt, stopCount) +
    COMMUTE_TRAIN_RETURN_TRAVEL_MS +
    COMMUTE_TRAIN_RETURN_ARRIVAL_MS
  );
}

export function getCommuteTrainStopPassedAt(
  createdAt: number,
  stopIndex: number,
): number {
  return (
    createdAt +
    COMMUTE_TRAIN_DEPARTURE_MS +
    (stopIndex + 1) * getCommuteTrainStopCycleMs()
  );
}
