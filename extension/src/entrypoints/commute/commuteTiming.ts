// ABOUTME: Computes the Internet Commute's platform, travel, and arrival phases.
// ABOUTME: Keeps train timing deterministic and independent from React rendering.

export const INITIAL_PLATFORM_SECONDS = 10;
export const TRAVEL_SECONDS = 15;
export const ARRIVAL_SECONDS = 4;
export const PLATFORM_SECONDS = 5;
export const DEPARTURE_SECONDS = 2.6;

export type CommutePhase = "stopped" | "riding" | "arriving";

export interface CommuteTiming {
  phase: CommutePhase;
  secondsLeft: number;
  stopIndex: number;
  departureStopIndex: number | null;
  atOrigin: boolean;
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
    };
  }

  const cycleSeconds = TRAVEL_SECONDS + ARRIVAL_SECONDS + PLATFORM_SECONDS;
  const elapsedAfterOrigin = elapsedSeconds - INITIAL_PLATFORM_SECONDS;
  const cyclePosition = elapsedAfterOrigin % cycleSeconds;
  const completedCycles = Math.floor(elapsedAfterOrigin / cycleSeconds);
  const stopIndex = completedCycles % stopCount;

  if (cyclePosition < TRAVEL_SECONDS) {
    return {
      phase: "riding",
      secondsLeft: TRAVEL_SECONDS - cyclePosition,
      stopIndex,
      departureStopIndex:
        completedCycles === 0 || cyclePosition >= DEPARTURE_SECONDS
          ? null
          : (stopIndex - 1 + stopCount) % stopCount,
      atOrigin: false,
    };
  }

  if (cyclePosition < TRAVEL_SECONDS + ARRIVAL_SECONDS) {
    return {
      phase: "arriving",
      secondsLeft: TRAVEL_SECONDS + ARRIVAL_SECONDS - cyclePosition,
      stopIndex,
      departureStopIndex: null,
      atOrigin: false,
    };
  }

  return {
    phase: "stopped",
    secondsLeft: cycleSeconds - cyclePosition,
    stopIndex,
    departureStopIndex: null,
    atOrigin: false,
  };
}
