// ABOUTME: Musical scale definitions and direction-to-pitch mapping
// ABOUTME: Maps cursor movement direction to notes in a shared pentatonic scale

/** D minor pentatonic across two octaves (Hz values) */
const D_MINOR_PENTATONIC = [
  // Octave 3
  146.83, // D3
  174.61, // F3
  196.0,  // G3
  220.0,  // A3
  261.63, // C4
  // Octave 4
  293.66, // D4
  349.23, // F4
  392.0,  // G4
  440.0,  // A4
  523.25, // C5
];

/**
 * Map a direction angle (radians) to a scale degree.
 * 0 = right, PI/2 = down, PI = left, -PI/2 = up.
 * Quantizes to 8 compass directions, each mapped to a scale degree.
 */
export function directionToPitch(angleRadians: number): number {
  // Normalize to 0-2PI
  const normalized = ((angleRadians % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  // 8 compass directions, each covering a 45-degree arc
  // Index 0 = right (centered on 0 radians)
  const directionIndex = Math.round((normalized / (2 * Math.PI)) * 8) % 8;

  // Map 8 directions to scale degrees across two octaves:
  // Right=D3, UpRight=F3, Up=G3, UpLeft=A3,
  // Left=C4, DownLeft=D4, Down=F4, DownRight=G4
  const DIRECTION_TO_SCALE_INDEX = [0, 1, 2, 3, 4, 5, 6, 7];

  return D_MINOR_PENTATONIC[DIRECTION_TO_SCALE_INDEX[directionIndex]];
}

/**
 * Compute the direction angle from a previous position to a current position.
 * Returns angle in radians where 0 = right, PI/2 = down.
 */
export function computeDirection(
  prevX: number,
  prevY: number,
  x: number,
  y: number,
): number {
  return Math.atan2(y - prevY, x - prevX);
}

/**
 * Compute velocity (pixels per frame) from two positions.
 */
export function computeVelocity(
  prevX: number,
  prevY: number,
  x: number,
  y: number,
): number {
  const dx = x - prevX;
  const dy = y - prevY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Map a velocity value to a gain (0-1).
 * Very slow movement = quiet, fast movement = louder.
 * Clamps between a minimum and maximum.
 */
export function velocityToGain(velocity: number): number {
  const MIN_VELOCITY = 0.05; // Below this, silence (cursor is basically still)
  const MAX_VELOCITY = 5;    // Above this, max volume (calibrated for animation playback at ~60fps)
  if (velocity < MIN_VELOCITY) return 0;
  const normalized = Math.min(1, (velocity - MIN_VELOCITY) / (MAX_VELOCITY - MIN_VELOCITY));
  // Square root curve so even slow movement is audible
  return Math.sqrt(normalized) * 0.8;
}

/**
 * Map a velocity value to a gain (0-1) for discrete note events.
 *
 * Unlike velocityToGain, this does not saturate at 5 px/frame — the usable
 * range extends to NOTE_MAX_VELOCITY so genuinely fast sweeps are audibly
 * louder than medium ones. The curve is gentler than sqrt (pow 0.7) so slow
 * movement stays audible without flattening the top of the range.
 */
export const NOTE_MIN_VELOCITY = 0.3;
export const NOTE_MAX_VELOCITY = 25;

export function velocityToNoteGain(velocity: number): number {
  if (velocity < NOTE_MIN_VELOCITY) return 0;
  const normalized = Math.min(
    1,
    (velocity - NOTE_MIN_VELOCITY) / (NOTE_MAX_VELOCITY - NOTE_MIN_VELOCITY),
  );
  return 0.15 + Math.pow(normalized, 0.7) * 0.85;
}

/** Velocity above which notes jump an octave, and two octaves. */
export const OCTAVE_UP_VELOCITY = 8;
export const OCTAVE_UP_TWO_VELOCITY = 18;

/**
 * Multiply a base pitch by an octave shift determined by velocity.
 * Fast gestures sit in a higher register, so a sweep reads as a run upward
 * rather than a louder version of the same note.
 */
export function velocityToOctaveMultiplier(velocity: number): number {
  if (velocity >= OCTAVE_UP_TWO_VELOCITY) return 4;
  if (velocity >= OCTAVE_UP_VELOCITY) return 2;
  return 1;
}

/** Lowpass cutoff range for note brightness (Hz). */
export const NOTE_FILTER_MIN_HZ = 800;
export const NOTE_FILTER_MAX_HZ = 6000;

/**
 * Map velocity to a lowpass cutoff so faster movement sounds brighter.
 */
export function velocityToFilterFrequency(velocity: number): number {
  const normalized = Math.min(
    1,
    Math.max(0, velocity / NOTE_MAX_VELOCITY),
  );
  return (
    NOTE_FILTER_MIN_HZ +
    Math.pow(normalized, 0.6) * (NOTE_FILTER_MAX_HZ - NOTE_FILTER_MIN_HZ)
  );
}

/**
 * Smallest signed difference between two angles (radians), in [-PI, PI].
 */
export function angleDelta(a: number, b: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/**
 * Map x position to stereo pan (-1 = left, 1 = right).
 * canvasWidth is needed to normalize.
 */
export function positionToPan(x: number, canvasWidth: number): number {
  if (canvasWidth <= 0) return 0;
  return (x / canvasWidth) * 2 - 1;
}
