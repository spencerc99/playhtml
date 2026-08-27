// ABOUTME: Computes the Internet Commute's platform, travel, and arrival phases.
// ABOUTME: Keeps train timing deterministic and independent from React rendering.

import {
  COMMUTE_TRAIN_ARRIVAL_MS,
  COMMUTE_TRAIN_DEPARTURE_MS,
  COMMUTE_TRAIN_PLATFORM_MS,
  COMMUTE_TRAIN_RETURN_ARRIVAL_MS,
  COMMUTE_TRAIN_RETURN_TRAVEL_MS,
  COMMUTE_TRAIN_TRAVEL_MS,
} from "@playhtml/extension-types";

export const INITIAL_PLATFORM_SECONDS = 10;
export const TRAVEL_SECONDS = 15;
export const ARRIVAL_SECONDS = 4;
export const PLATFORM_SECONDS = 5;
export const DEPARTURE_SECONDS = 2.6;
export const RETURN_TRAVEL_SECONDS = 6;
export const RETURN_ARRIVAL_SECONDS = 4;
export const SLOW_MODE_APPROACH_SECONDS = 5;
export const SLOW_MODE_BOARDING_SECONDS = 4;
export const SLOW_MODE_TRAIN_PULL_IN_SECONDS = 2;

export interface CommuteDurations {
  initialPlatformSeconds: number;
  travelSeconds: number;
  arrivalSeconds: number;
  platformSeconds: number;
  departureSeconds: number;
  returnTravelSeconds: number;
  returnArrivalSeconds: number;
}

export const DEFAULT_COMMUTE_DURATIONS: CommuteDurations = {
  initialPlatformSeconds: INITIAL_PLATFORM_SECONDS,
  travelSeconds: TRAVEL_SECONDS,
  arrivalSeconds: ARRIVAL_SECONDS,
  platformSeconds: PLATFORM_SECONDS,
  departureSeconds: DEPARTURE_SECONDS,
  returnTravelSeconds: RETURN_TRAVEL_SECONDS,
  returnArrivalSeconds: RETURN_ARRIVAL_SECONDS,
};

export const SLOW_MODE_DURATIONS: CommuteDurations = {
  ...DEFAULT_COMMUTE_DURATIONS,
  initialPlatformSeconds:
    SLOW_MODE_APPROACH_SECONDS + SLOW_MODE_BOARDING_SECONDS,
  travelSeconds: 12,
  platformSeconds: 8,
};

export const TRAIN_DURATIONS: CommuteDurations = {
  initialPlatformSeconds: COMMUTE_TRAIN_DEPARTURE_MS / 1_000,
  travelSeconds: COMMUTE_TRAIN_TRAVEL_MS / 1_000,
  arrivalSeconds: COMMUTE_TRAIN_ARRIVAL_MS / 1_000,
  platformSeconds: COMMUTE_TRAIN_PLATFORM_MS / 1_000,
  departureSeconds: DEPARTURE_SECONDS,
  returnTravelSeconds: COMMUTE_TRAIN_RETURN_TRAVEL_MS / 1_000,
  returnArrivalSeconds: COMMUTE_TRAIN_RETURN_ARRIVAL_MS / 1_000,
};

export type SlowModePlatformPhase = "waiting" | "arriving" | "boarding";

export function getSlowModePlatformPhase(
  secondsLeft: number,
): SlowModePlatformPhase {
  if (secondsLeft <= SLOW_MODE_BOARDING_SECONDS) return "boarding";
  if (
    secondsLeft <=
    SLOW_MODE_BOARDING_SECONDS + SLOW_MODE_TRAIN_PULL_IN_SECONDS
  ) {
    return "arriving";
  }
  return "waiting";
}

export type CommutePhase = "stopped" | "riding" | "arriving";

export interface CommuteTiming {
  phase: CommutePhase;
  secondsLeft: number;
  stopIndex: number;
  departureStopIndex: number | null;
  atOrigin: boolean;
  complete: boolean;
}

export function getSlowModeProgress(
  timing: Pick<CommuteTiming, "atOrigin" | "phase" | "stopIndex">,
  stopCount: number,
): { completedIndex: number; stopsLeft: number } {
  const completedIndex = timing.atOrigin
    ? -1
    : timing.phase === "stopped"
      ? timing.stopIndex
      : timing.stopIndex - 1;
  return {
    completedIndex,
    stopsLeft: Math.max(0, stopCount - 2 - completedIndex),
  };
}

export function getCommuteRouteDurationSeconds(stopCount: number): number {
  if (stopCount < 1) {
    throw new Error("Internet Commute requires at least one stop");
  }

  return (
    INITIAL_PLATFORM_SECONDS +
    stopCount * (TRAVEL_SECONDS + ARRIVAL_SECONDS + PLATFORM_SECONDS) +
    RETURN_TRAVEL_SECONDS +
    RETURN_ARRIVAL_SECONDS
  );
}

export function getCommuteTiming(
  elapsedSeconds: number,
  stopCount: number,
  durations: CommuteDurations = DEFAULT_COMMUTE_DURATIONS,
): CommuteTiming {
  if (stopCount < 1) {
    throw new Error("Internet Commute requires at least one stop");
  }

  if (elapsedSeconds < durations.initialPlatformSeconds) {
    return {
      phase: "stopped",
      secondsLeft: durations.initialPlatformSeconds - elapsedSeconds,
      stopIndex: 0,
      departureStopIndex: null,
      atOrigin: true,
      complete: false,
    };
  }

  const cycleSeconds =
    durations.travelSeconds +
    durations.arrivalSeconds +
    durations.platformSeconds;
  const elapsedAfterOrigin = elapsedSeconds - durations.initialPlatformSeconds;
  const completedCycles = Math.floor(elapsedAfterOrigin / cycleSeconds);
  if (completedCycles >= stopCount) {
    const returnPosition = elapsedAfterOrigin - stopCount * cycleSeconds;
    if (returnPosition < durations.returnTravelSeconds) {
      return {
        phase: "riding",
        secondsLeft: durations.returnTravelSeconds - returnPosition,
        stopIndex: stopCount - 1,
        departureStopIndex:
          returnPosition < durations.departureSeconds ? stopCount - 1 : null,
        atOrigin: false,
        complete: true,
      };
    }

    if (
      returnPosition <
      durations.returnTravelSeconds + durations.returnArrivalSeconds
    ) {
      return {
        phase: "arriving",
        secondsLeft:
          durations.returnTravelSeconds +
          durations.returnArrivalSeconds -
          returnPosition,
        stopIndex: stopCount - 1,
        departureStopIndex: null,
        atOrigin: true,
        complete: true,
      };
    }

    return {
      phase: "stopped",
      secondsLeft: 0,
      stopIndex: stopCount - 1,
      departureStopIndex: null,
      atOrigin: true,
      complete: true,
    };
  }

  const cyclePosition = elapsedAfterOrigin % cycleSeconds;
  const stopIndex = completedCycles;

  if (cyclePosition < durations.travelSeconds) {
    return {
      phase: "riding",
      secondsLeft: durations.travelSeconds - cyclePosition,
      stopIndex,
      departureStopIndex:
        completedCycles === 0 || cyclePosition >= durations.departureSeconds
          ? null
          : stopIndex - 1,
      atOrigin: false,
      complete: false,
    };
  }

  if (
    cyclePosition < durations.travelSeconds + durations.arrivalSeconds
  ) {
    return {
      phase: "arriving",
      secondsLeft:
        durations.travelSeconds + durations.arrivalSeconds - cyclePosition,
      stopIndex,
      departureStopIndex: null,
      atOrigin: false,
      complete: false,
    };
  }

  return {
    phase: "stopped",
    secondsLeft: cycleSeconds - cyclePosition,
    stopIndex,
    departureStopIndex: null,
    atOrigin: false,
    complete: false,
  };
}
