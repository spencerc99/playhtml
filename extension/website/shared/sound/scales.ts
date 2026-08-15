// ABOUTME: Musical scale definitions and direction-to-pitch mapping
// ABOUTME: Maps cursor movement direction to notes in a shared pentatonic scale

/** D minor pentatonic across two octaves (Hz values) */
export const D_MINOR_PENTATONIC = [
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
 * Every pitch the engine can play, drawn from D natural minor
 * (D E F G A Bb C) across the D3-C5 span the base palette already occupies.
 * Chord palettes select from this set, so the harmony never leaves the key.
 */
export const D_NATURAL_MINOR_PITCHES: Record<string, number> = {
  D3: 146.83,
  E3: 164.81,
  F3: 174.61,
  G3: 196.0,
  A3: 220.0,
  Bb3: 233.08,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  Bb4: 466.16,
  C5: 523.25,
};

/**
 * A harmonic centre the pitch palette can sit on. `pitches` is the palette the
 * compass directions map onto — eight notes, all diatonic to D natural minor,
 * with the chord's own tones on the directions cursors travel most.
 */
export interface Chord {
  name: string;
  pitches: number[];
}

const P = D_NATURAL_MINOR_PITCHES;

/**
 * The rotation, i -> VI -> III -> VII in D minor.
 *
 * Each palette is built from D natural minor only, so no chord introduces an
 * accidental against the others — transposing the pentatonic shape onto each
 * root (the earlier approach) produced Db/Eb/Ab against a D minor context and
 * read as chromatic rather than as a progression. Every palette also spans the
 * same D3-C5 register, so the rotation changes colour without dropping the
 * whole scene into a lower octave.
 *
 * Edit freely: any list of chords works, and the engine simply cycles it.
 */
export const CHORD_PROGRESSION: Chord[] = [
  // Dm — chord tones D F A, coloured with G and C.
  { name: "Dm", pitches: [P.D3, P.F3, P.A3, P.G3, P.C4, P.D4, P.F4, P.A4] },
  // Bb — chord tones Bb D F, coloured with C and G.
  { name: "Bb", pitches: [P.D3, P.F3, P.Bb3, P.G3, P.C4, P.D4, P.F4, P.Bb4] },
  // F — chord tones F A C, coloured with D and G.
  { name: "F", pitches: [P.F3, P.A3, P.C4, P.G3, P.D4, P.F4, P.A4, P.C5] },
  // C — chord tones C E G, coloured with D and A.
  { name: "C", pitches: [P.E3, P.G3, P.C4, P.A3, P.D4, P.E4, P.G4, P.C5] },
];

/** How long each chord holds before the progression advances (ms). */
export const CHORD_DWELL_MS = 20000;

export function scaleForChord(chord: Chord): number[] {
  return chord.pitches;
}

/**
 * The upper reaches of a chord's palette, used for click bells so they ring
 * above the sustained voices while staying inside the current harmony.
 */
export function bellScaleForChord(chord: Chord): number[] {
  return [...chord.pitches].sort((a, b) => a - b).slice(-6);
}

/**
 * Map a direction angle (radians) to a scale degree.
 * 0 = right, PI/2 = down, PI = left, -PI/2 = up.
 * Quantizes to 8 compass directions, each mapped to a scale degree.
 *
 * Passing a `scale` draws from a transposed palette instead of the default
 * D minor pentatonic; the direction-to-degree mapping is identical either way.
 */
export function directionToPitch(
  angleRadians: number,
  scale: number[] = D_MINOR_PENTATONIC,
): number {
  // Normalize to 0-2PI
  const normalized = ((angleRadians % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  // 8 compass directions, each covering a 45-degree arc
  // Index 0 = right (centered on 0 radians)
  const directionIndex = Math.round((normalized / (2 * Math.PI)) * 8) % 8;

  // Map 8 directions to scale degrees across two octaves:
  // Right=D3, UpRight=F3, Up=G3, UpLeft=A3,
  // Left=C4, DownLeft=D4, Down=F4, DownRight=G4
  const DIRECTION_TO_SCALE_INDEX = [0, 1, 2, 3, 4, 5, 6, 7];

  return scale[DIRECTION_TO_SCALE_INDEX[directionIndex]];
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
