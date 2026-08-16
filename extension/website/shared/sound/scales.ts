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
 * Deterministic 32-bit hash of an identity string. Trails need a stable sonic
 * fingerprint, so every derived parameter is drawn from this one value rather
 * than from randomness that would change on every reload.
 */
export function hashIdentity(key: string): number {
  // FNV-1a. Cheap, and spreads short keys (a pid, a colour) well enough that
  // neighbouring trails do not land on the same fingerprint.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * One deterministic 0-1 value from an identity hash. `salt` separates the
 * independent parameters of a fingerprint so detune, vibrato rate, vibrato
 * depth and attack do not all move together.
 */
export function hashUnit(hash: number, salt: number): number {
  let mixed = (hash ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0;
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 0x100000000;
}

/**
 * The chord tone a trail calls home when it first appears, chosen from the
 * palette in force by its identity hash. Only the initial seat comes from the
 * hash — once a trail is sounding, `leadHomeTone` moves it from wherever it
 * already sits rather than re-rolling it against each new palette.
 */
export function homeToneForHash(hash: number, scale: number[]): number {
  if (scale.length === 0) return D_MINOR_PENTATONIC[0];
  const index = Math.min(
    scale.length - 1,
    Math.floor(hashUnit(hash, HOME_TONE_SALT) * scale.length),
  );
  return scale[index];
}

/** Distance between two pitches in semitones, signed (positive = target higher). */
export function semitonesBetween(from: number, to: number): number {
  return 12 * Math.log2(to / from);
}

/**
 * Move a home tone onto the nearest tone of a new palette.
 *
 * Re-hashing against every palette makes a trail leap around the register on
 * each chord change — the crowd re-seats itself all at once and the rotation
 * reads as a cut rather than as harmony moving. Choosing the nearest tone
 * instead gives each trail a slowly-gliding line: over a session its home tone
 * walks by a step or two at a time, which is what voice leading is.
 *
 * Distance is measured in semitones so the choice is musical rather than
 * linear-in-Hz (a fixed Hz gap is a much wider interval down low than up high).
 * Ties go downward: an exact tritone either way resolves to the lower tone, so
 * the ensemble as a whole drifts to settle rather than to climb.
 */
export function leadHomeTone(currentHome: number, scale: number[]): number {
  if (scale.length === 0) return currentHome;
  let best = scale[0];
  let bestDistance = Math.abs(semitonesBetween(currentHome, best));
  for (const candidate of scale.slice(1)) {
    const distance = Math.abs(semitonesBetween(currentHome, candidate));
    // Strictly-less keeps the first-seen on a tie, so scanning a palette that
    // is not sorted would be order-dependent — hence the explicit lower-wins
    // branch below rather than relying on iteration order.
    if (distance < bestDistance - 1e-9) {
      best = candidate;
      bestDistance = distance;
    } else if (
      Math.abs(distance - bestDistance) <= 1e-9 &&
      candidate < best
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * A register the trails sing in, named for the choral part it occupies.
 *
 * The four bands span roughly D2-D6 and overlap by a little, the way real
 * voice parts do — a hard split at the octave makes the crowd sound like four
 * separate instruments rather than one choir.
 */
export type RegisterBand = "bass" | "tenor" | "alto" | "soprano";

/** Every band, low to high. */
export const REGISTER_BANDS: RegisterBand[] = [
  "bass",
  "tenor",
  "alto",
  "soprano",
];

/**
 * The pitch window each band voices in (Hz), low bound inclusive.
 *
 * Anchored on D so the bounds land on octaves of the key's root: D2 ~73Hz,
 * D3 ~147Hz, D4 ~294Hz, D5 ~587Hz, D6 ~1175Hz. Each band is a little over an
 * octave wide, which is enough room for a palette's worth of tones.
 */
export const REGISTER_BAND_RANGES: Record<
  RegisterBand,
  { minHz: number; maxHz: number }
> = {
  bass: { minHz: 73.42, maxHz: 155.56 },
  tenor: { minHz: 146.83, maxHz: 311.13 },
  alto: { minHz: 293.66, maxHz: 622.25 },
  soprano: { minHz: 587.33, maxHz: 1244.51 },
};

/**
 * Which register a trail sings in, from the hue of the colour it is drawn in.
 *
 * The cross-modal mapping, so the colour you see tells you the register you
 * hear. Hue is split into four quadrants and each takes one choral part, warm
 * to cool, low to high:
 *
 *   red/orange   (hue   0-89)  -> bass     (D2-D3)
 *   yellow/green (hue  90-179) -> tenor    (D3-D4)
 *   cyan/blue    (hue 180-269) -> alto     (D4-D5)
 *   purple/pink  (hue 270-359) -> soprano  (D5-D6)
 *
 * Warm colours sit low and cool colours sit high, which is the association
 * most listeners already carry — a red trail sounds like a red trail. Because
 * the RISO palette spreads its eight colours evenly around the wheel, a mixed
 * crowd lands roughly two trails per part rather than crowding one octave.
 *
 * Unparseable colours fall to alto, the middle of the range, so a trail with a
 * colour the parser does not recognise still sings somewhere sensible.
 */
export function registerBandForHue(hue: number): RegisterBand {
  const normalized = ((hue % 360) + 360) % 360;
  return REGISTER_BANDS[Math.min(3, Math.floor(normalized / 90))];
}

/**
 * Fold a pitch into a band by octave, so it keeps its pitch class — the note
 * is still in the chord, just sung by the part that owns that register.
 */
export function foldPitchIntoBand(
  frequency: number,
  band: RegisterBand,
): number {
  const { minHz, maxHz } = REGISTER_BAND_RANGES[band];
  if (frequency <= 0) return frequency;
  let folded = frequency;
  while (folded < minHz) folded *= 2;
  while (folded > maxHz) folded /= 2;
  // A band narrower than an octave could push a pitch back below the floor;
  // the ranges are all wider than an octave, so this only guards the edge.
  return folded < minHz ? folded * 2 : folded;
}

/** Salts separating the independent parameters drawn from one identity hash. */
export const HOME_TONE_SALT = 0;
export const DETUNE_SALT = 1;
export const VIBRATO_RATE_SALT = 2;
export const VIBRATO_DEPTH_SALT = 3;
export const ATTACK_SALT = 4;

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
