// ABOUTME: Strap-band geometry and swing physics for hanging commute riders.
// ABOUTME: Realtime only — a swinging strap is proof somebody is here right now.

import type { CommutePoint } from "./commuteMobile";

/** Y of each hand-strap band inside the car. */
export const STRAP_BAND_Y = [116, 234];
/** Straps repeat along the band at this spacing, matching the SCSS tiling. */
export const STRAP_SPACING = 34;
export const STRAP_BAND_START_X = 60;
export const STRAP_BAND_END_X = 1040;
/** How close a standing rider must be to a band to reach a strap. */
export const STRAP_REACH = 26;

/** Wiggling pumps the swing; letting go bleeds it away this fast per second. */
export const SWING_DECAY_PER_SECOND = 1.6;
/** Cap so a determined pumper doesn't spin the avatar. */
export const MAX_SWING = 26;
/** How much one full back-and-forth wiggle adds. */
export const SWING_PUMP_GAIN = 0.55;

export interface StrapGrip {
  bandIndex: number;
  strapIndex: number;
  x: number;
  y: number;
}

/** The strap a rider standing here would be holding, or null if out of reach. */
export function findStrapGrip(position: CommutePoint): StrapGrip | null {
  for (const [bandIndex, bandY] of STRAP_BAND_Y.entries()) {
    if (Math.abs(position.y - bandY) > STRAP_REACH) continue;
    if (position.x < STRAP_BAND_START_X || position.x > STRAP_BAND_END_X) {
      continue;
    }

    const strapIndex = Math.round(
      (position.x - STRAP_BAND_START_X) / STRAP_SPACING,
    );
    return {
      bandIndex,
      strapIndex,
      x: STRAP_BAND_START_X + strapIndex * STRAP_SPACING,
      y: bandY,
    };
  }

  return null;
}

export function isSameGrip(
  a: StrapGrip | null,
  b: StrapGrip | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.bandIndex === b.bandIndex && a.strapIndex === b.strapIndex;
}

/**
 * Wiggling back and forth pumps the swing higher; the pump only counts when the
 * rider reverses direction, so holding still lets the swing die out.
 */
export function pumpSwing(
  swing: number,
  reversedDirection: boolean,
  travel: number,
): number {
  if (!reversedDirection) return swing;
  return Math.min(MAX_SWING, swing + travel * SWING_PUMP_GAIN);
}

export function decaySwing(swing: number, elapsedMs: number): number {
  const decayed = swing - SWING_DECAY_PER_SECOND * (elapsedMs / 1000);
  return decayed <= 0.05 ? 0 : decayed;
}
