// ABOUTME: Assigns Internet Commute riders to bounded rolling trains.
// ABOUTME: Owns append-only routes while keeping exact destination URLs out of shared state.

import {
  COMMUTE_TRAIN_CAPACITY,
  COMMUTE_TRAIN_DEPARTURE_MS,
  COMMUTE_TRAIN_JOIN_WINDOW_MS,
  getCommuteTrainReturnStartsAt,
  getCommuteTrainRouteEndsAt,
  getCommuteTrainStopPassedAt,
  type CommuteTrainAssignment,
  type CommuteTrainBoardRequest,
  type CommuteTrainCommunalStop,
  type CommuteTrainDomainStop,
  type CommuteTrainPhase,
  type CommuteTrainStop,
  type CommuteTrainStopRequest,
} from '@playhtml/extension-types';

const COMPLETED_TRAIN_RETENTION_MS = 60_000;
export const COMMUTE_TRAIN_RIDER_LEASE_MS = 20_000;
export const MAX_RETAINED_COMMUTE_TRAINS = 64;

export class CommuteTrainCapacityError extends Error {
  constructor() {
    super('Internet Commute is at train capacity');
    this.name = 'CommuteTrainCapacityError';
  }
}

interface CommuteTrainRider {
  requestedStop: CommuteTrainStopRequest;
  activeUntil?: number;
}

interface StoredDomainStop extends CommuteTrainDomainStop {
  claimantTokens: string[];
}

type StoredTrainStop = CommuteTrainCommunalStop | StoredDomainStop;

interface CommuteTrainRecord {
  id: string;
  createdAt: number;
  departureAt: number;
  routeVersion: number;
  riders: Record<string, CommuteTrainRider>;
  stops: StoredTrainStop[];
}

export interface CommuteTrainDispatcherState {
  trains: CommuteTrainRecord[];
}

export const EMPTY_COMMUTE_TRAIN_DISPATCHER_STATE: CommuteTrainDispatcherState = {
  trains: [],
};

function getTrainPhase(train: CommuteTrainRecord, now: number): CommuteTrainPhase {
  if (now < train.departureAt) return 'boarding';
  if (now < getCommuteTrainRouteEndsAt(train.createdAt, train.stops.length)) {
    return 'riding';
  }
  return 'complete';
}

function getJoinableUntil(train: CommuteTrainRecord): number {
  return Math.min(
    train.createdAt + COMMUTE_TRAIN_JOIN_WINDOW_MS,
    getCommuteTrainReturnStartsAt(train.createdAt, train.stops.length),
  );
}

function isTrainJoinable(train: CommuteTrainRecord, now: number): boolean {
  return (
    getActiveRiderCount(train, now) < COMMUTE_TRAIN_CAPACITY &&
    now < getJoinableUntil(train)
  );
}

function getActiveRiderCount(train: CommuteTrainRecord, now: number): number {
  return Object.values(train.riders).filter((rider) =>
    isRiderActive(train, rider, now),
  ).length;
}

function isRiderActive(
  train: CommuteTrainRecord,
  rider: CommuteTrainRider,
  now: number,
): boolean {
  return (
    (rider.activeUntil ??
      getCommuteTrainRouteEndsAt(train.createdAt, train.stops.length)) > now
  );
}

function publicStop(stop: StoredTrainStop): CommuteTrainStop {
  if (stop.kind === 'communal') return stop;
  return {
    kind: 'domain',
    id: stop.id,
    domain: stop.domain,
    url: stop.url,
    hue: stop.hue,
    claimantCount: stop.claimantTokens.length,
  };
}

function assignmentFor(
  train: CommuteTrainRecord,
  now: number,
): CommuteTrainAssignment {
  return {
    trainId: train.id,
    createdAt: train.createdAt,
    departureAt: train.departureAt,
    joinableUntil: getJoinableUntil(train),
    routeEndsAt: getCommuteTrainRouteEndsAt(
      train.createdAt,
      train.stops.length,
    ),
    routeVersion: train.routeVersion,
    riderCount: getActiveRiderCount(train, now),
    capacity: COMMUTE_TRAIN_CAPACITY,
    joinable: isTrainJoinable(train, now),
    phase: getTrainPhase(train, now),
    stops: train.stops.map(publicStop),
    serverNow: now,
  };
}

function findClaimableDomainStop(
  train: CommuteTrainRecord,
  domain: string,
  now: number,
): StoredDomainStop | null {
  for (let index = train.stops.length - 1; index >= 0; index -= 1) {
    const stop = train.stops[index];
    if (
      stop.kind === 'domain' &&
      stop.domain === domain &&
      now < getCommuteTrainStopPassedAt(train.createdAt, index)
    ) {
      return stop;
    }
  }
  return null;
}

export class CommuteTrainDispatcher {
  constructor(
    private readonly state: CommuteTrainDispatcherState,
    private readonly createId: () => string,
  ) {}

  snapshot(): CommuteTrainDispatcherState {
    return this.state;
  }

  cleanup(now: number): void {
    const retainedTrains = this.state.trains.filter(
      (train) =>
        getCommuteTrainRouteEndsAt(train.createdAt, train.stops.length) +
          COMPLETED_TRAIN_RETENTION_MS >
        now,
    );
    this.state.trains = retainedTrains.slice(-MAX_RETAINED_COMMUTE_TRAINS);
  }

  getRecentCommunalDomains(now: number): Set<string> {
    this.cleanup(now);
    const domains = new Set<string>();
    for (const train of this.state.trains) {
      for (const stop of train.stops) {
        if (stop.kind === 'communal') domains.add(stop.domain);
      }
    }
    return domains;
  }

  needsCommunalStops(riderToken: string, now: number): boolean {
    this.cleanup(now);
    const currentTrain = this.findCurrentRiderTrain(riderToken, now);
    if (
      currentTrain &&
      (isRiderActive(currentTrain, currentTrain.riders[riderToken], now) ||
        isTrainJoinable(currentTrain, now))
    ) {
      return false;
    }
    if (this.state.trains.some((train) => isTrainJoinable(train, now))) {
      return false;
    }
    if (this.state.trains.length >= MAX_RETAINED_COMMUTE_TRAINS) {
      throw new CommuteTrainCapacityError();
    }
    return true;
  }

  board(
    request: CommuteTrainBoardRequest,
    communalStops: CommuteTrainCommunalStop[],
    now: number,
  ): CommuteTrainAssignment {
    this.cleanup(now);

    const existingTrain = this.findCurrentRiderTrain(request.riderToken, now);
    if (
      existingTrain &&
      (isRiderActive(
        existingTrain,
        existingTrain.riders[request.riderToken],
        now,
      ) ||
        isTrainJoinable(existingTrain, now))
    ) {
      existingTrain.riders[request.riderToken].activeUntil =
        now + COMMUTE_TRAIN_RIDER_LEASE_MS;
      return assignmentFor(existingTrain, now);
    }
    if (existingTrain) delete existingTrain.riders[request.riderToken];

    let train = [...this.state.trains]
      .sort((left, right) => left.createdAt - right.createdAt)
      .find((candidate) => isTrainJoinable(candidate, now));

    if (!train) {
      if (this.state.trains.length >= MAX_RETAINED_COMMUTE_TRAINS) {
        throw new CommuteTrainCapacityError();
      }
      if (communalStops.length === 0) {
        throw new Error('Internet Commute requires at least one communal stop');
      }
      train = {
        id: this.createId(),
        createdAt: now,
        departureAt: now + COMMUTE_TRAIN_DEPARTURE_MS,
        routeVersion: 0,
        riders: {},
        stops: communalStops.map((stop) => ({ ...stop })),
      };
      this.state.trains.push(train);
    }

    train.riders[request.riderToken] = {
      requestedStop: request.requestedStop,
      activeUntil: now + COMMUTE_TRAIN_RIDER_LEASE_MS,
    };
    this.addRequestedStop(train, request.riderToken, request.requestedStop, now);
    train.routeVersion += 1;

    return assignmentFor(train, now);
  }

  nextCleanupAt(): number | null {
    let cleanupAt: number | null = null;
    for (const train of this.state.trains) {
      const candidate =
        getCommuteTrainRouteEndsAt(train.createdAt, train.stops.length) +
        COMPLETED_TRAIN_RETENTION_MS;
      if (cleanupAt === null || candidate < cleanupAt) cleanupAt = candidate;
    }
    return cleanupAt;
  }

  private findCurrentRiderTrain(
    riderToken: string,
    now: number,
  ): CommuteTrainRecord | null {
    return (
      this.state.trains.find(
        (train) =>
          riderToken in train.riders && getTrainPhase(train, now) !== 'complete',
      ) ?? null
    );
  }

  private addRequestedStop(
    train: CommuteTrainRecord,
    riderToken: string,
    request: CommuteTrainStopRequest,
    now: number,
  ): void {
    if (request.kind === 'none') return;

    const existingStop = findClaimableDomainStop(train, request.domain, now);
    if (existingStop) {
      existingStop.claimantTokens.push(riderToken);
      return;
    }

    train.stops.push({
      kind: 'domain',
      id: this.createId(),
      domain: request.domain,
      url: `https://${request.domain}/`,
      hue: '#4a9a8a',
      claimantCount: 1,
      claimantTokens: [riderToken],
    });
  }
}
