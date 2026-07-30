// ABOUTME: Computes the Internet Commute's platform, travel, and arrival phases.
// ABOUTME: Keeps train timing deterministic and independent from React rendering.

export const INITIAL_PLATFORM_SECONDS = 12;
export const TRAVEL_SECONDS = 20;
export const ARRIVAL_SECONDS = 4;
export const PLATFORM_SECONDS = 12;

export type CommutePhase = "stopped" | "riding" | "arriving";

export interface CommuteTiming {
  phase: CommutePhase;
  secondsLeft: number;
  stopIndex: number;
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
      atOrigin: true,
    };
  }

  const cycleSeconds = TRAVEL_SECONDS + ARRIVAL_SECONDS + PLATFORM_SECONDS;
  const elapsedAfterOrigin = elapsedSeconds - INITIAL_PLATFORM_SECONDS;
  const cyclePosition = elapsedAfterOrigin % cycleSeconds;
  const stopIndex =
    Math.floor(elapsedAfterOrigin / cycleSeconds) % stopCount;

  if (cyclePosition < TRAVEL_SECONDS) {
    return {
      phase: "riding",
      secondsLeft: TRAVEL_SECONDS - cyclePosition,
      stopIndex,
      atOrigin: false,
    };
  }

  if (cyclePosition < TRAVEL_SECONDS + ARRIVAL_SECONDS) {
    return {
      phase: "arriving",
      secondsLeft: TRAVEL_SECONDS + ARRIVAL_SECONDS - cyclePosition,
      stopIndex,
      atOrigin: false,
    };
  }

  return {
    phase: "stopped",
    secondsLeft: cycleSeconds - cyclePosition,
    stopIndex,
    atOrigin: false,
  };
}
