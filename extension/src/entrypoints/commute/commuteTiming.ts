// ABOUTME: Computes the Internet Commute's platform, travel, and arrival phases.
// ABOUTME: Keeps train timing deterministic and independent from React rendering.

export const INITIAL_PLATFORM_SECONDS = 10;
export const TRAVEL_SECONDS = 15;
export const ARRIVAL_SECONDS = 4;
export const PLATFORM_SECONDS = 5;
export const DEPARTURE_SECONDS = 2.6;
export const RETURN_TRAVEL_SECONDS = 6;
export const RETURN_ARRIVAL_SECONDS = 4;

export type CommutePhase = "stopped" | "riding" | "arriving";

export interface CommuteTiming {
  phase: CommutePhase;
  secondsLeft: number;
  stopIndex: number;
  departureStopIndex: number | null;
  atOrigin: boolean;
  complete: boolean;
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
): CommuteTiming {
  if (stopCount < 1) {
    throw new Error("Internet Commute requires at least one stop");
  }

  if (elapsedSeconds < INITIAL_PLATFORM_SECONDS) {
    return {
      phase: "stopped",
      secondsLeft: INITIAL_PLATFORM_SECONDS - elapsedSeconds,
      stopIndex: 0,
      departureStopIndex: null,
      atOrigin: true,
      complete: false,
    };
  }

  const cycleSeconds = TRAVEL_SECONDS + ARRIVAL_SECONDS + PLATFORM_SECONDS;
  const elapsedAfterOrigin = elapsedSeconds - INITIAL_PLATFORM_SECONDS;
  const completedCycles = Math.floor(elapsedAfterOrigin / cycleSeconds);
  if (completedCycles >= stopCount) {
    const returnPosition = elapsedAfterOrigin - stopCount * cycleSeconds;
    if (returnPosition < RETURN_TRAVEL_SECONDS) {
      return {
        phase: "riding",
        secondsLeft: RETURN_TRAVEL_SECONDS - returnPosition,
        stopIndex: stopCount - 1,
        departureStopIndex:
          returnPosition < DEPARTURE_SECONDS ? stopCount - 1 : null,
        atOrigin: false,
        complete: true,
      };
    }

    if (returnPosition < RETURN_TRAVEL_SECONDS + RETURN_ARRIVAL_SECONDS) {
      return {
        phase: "arriving",
        secondsLeft:
          RETURN_TRAVEL_SECONDS + RETURN_ARRIVAL_SECONDS - returnPosition,
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

  if (cyclePosition < TRAVEL_SECONDS) {
    return {
      phase: "riding",
      secondsLeft: TRAVEL_SECONDS - cyclePosition,
      stopIndex,
      departureStopIndex:
        completedCycles === 0 || cyclePosition >= DEPARTURE_SECONDS
          ? null
          : stopIndex - 1,
      atOrigin: false,
      complete: false,
    };
  }

  if (cyclePosition < TRAVEL_SECONDS + ARRIVAL_SECONDS) {
    return {
      phase: "arriving",
      secondsLeft: TRAVEL_SECONDS + ARRIVAL_SECONDS - cyclePosition,
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
