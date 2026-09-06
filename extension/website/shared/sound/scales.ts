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
 * D dorian (D E F G A B C) across the same D3-C5 span. Identical to D natural
 * minor but for the sixth: B natural in place of Bb. That one note is what
 * gives dorian its lift, and it is why a dorian progression needs its own
 * collection — a G major chord over a natural-minor collection would be
 * spelled with a Bb and stop being G major.
 */
export const D_DORIAN_PITCHES: Record<string, number> = {
  D3: 146.83,
  E3: 164.81,
  F3: 174.61,
  G3: 196.0,
  A3: 220.0,
  B3: 246.94,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
};

/**
 * The pitch collection a progression's palettes are drawn from. Every palette
 * note must be a member of its progression's collection, which is what keeps a
 * rotation sounding like a progression rather than like chromatic drift.
 */
export type PitchCollection = "naturalMinor" | "dorian";

/** The pitches each collection admits, keyed by note name. */
export const PITCH_COLLECTIONS: Record<
  PitchCollection,
  Record<string, number>
> = {
  naturalMinor: D_NATURAL_MINOR_PITCHES,
  dorian: D_DORIAN_PITCHES,
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
const O = D_DORIAN_PITCHES;

/**
 * A named rotation the scene can be set to. Chords cycle in order, each held
 * for `CHORD_DWELL_MS * dwellScale`.
 */
export interface Progression {
  id: ProgressionId;
  /** Short name, shown in the playground's dropdown. */
  label: string;
  /** One line on what this rotation feels like, for the same dropdown. */
  description: string;
  /** Which pitch collection every palette here is drawn from. */
  collection: PitchCollection;
  chords: Chord[];
  /**
   * Multiplier on the base dwell. Progressions with fewer chords can afford to
   * sit on each one longer without the rotation feeling static.
   */
  dwellScale: number;
}

export type ProgressionId =
  | "circular"
  | "drifter"
  | "lament"
  | "dorian"
  | "breath";

/**
 * The rotations available to the scene.
 *
 * Every palette in a progression is built from that progression's own
 * collection, so no chord introduces an accidental against the others —
 * transposing a pentatonic shape onto each root (the earliest approach)
 * produced Db/Eb/Ab against a D minor context and read as chromatic rather
 * than as a progression. Every palette also spans the same D3-C5 register, so
 * a rotation changes colour without dropping the whole scene into a lower
 * octave, and each puts the chord's own tones on the first compass directions
 * so a typical gesture lands on the harmony.
 *
 * Edit freely: any list of chords works, and the engine simply cycles it.
 */
export const PROGRESSIONS: Record<ProgressionId, Progression> = {
  // i -> VI -> III -> VII. Turns and returns; the rotation everything else
  // was tuned against.
  circular: {
    id: "circular",
    label: "circular",
    description: "Dm Bb F C — turns and returns.",
    collection: "naturalMinor",
    dwellScale: 1,
    chords: [
      // Dm — chord tones D F A, coloured with G and C.
      { name: "Dm", pitches: [P.D3, P.F3, P.A3, P.G3, P.C4, P.D4, P.F4, P.A4] },
      // Bb — chord tones Bb D F, coloured with C and G.
      { name: "Bb", pitches: [P.D3, P.F3, P.Bb3, P.G3, P.C4, P.D4, P.F4, P.Bb4] },
      // F — chord tones F A C, coloured with D and G.
      { name: "F", pitches: [P.F3, P.A3, P.C4, P.G3, P.D4, P.F4, P.A4, P.C5] },
      // C — chord tones C E G, coloured with D and A.
      { name: "C", pitches: [P.E3, P.G3, P.C4, P.A3, P.D4, P.E4, P.G4, P.C5] },
    ],
  },

  // i -> VII -> VI -> VII. Never resolves downward past Bb; the C either side
  // keeps pulling it back, so the rotation reads as wandering.
  drifter: {
    id: "drifter",
    label: "drifter",
    description: "Dm C Bb C — never quite settles.",
    collection: "naturalMinor",
    dwellScale: 1,
    chords: [
      { name: "Dm", pitches: [P.D3, P.F3, P.A3, P.G3, P.C4, P.D4, P.F4, P.A4] },
      { name: "C", pitches: [P.E3, P.G3, P.C4, P.A3, P.D4, P.E4, P.G4, P.C5] },
      { name: "Bb", pitches: [P.D3, P.F3, P.Bb3, P.G3, P.C4, P.D4, P.F4, P.Bb4] },
      { name: "C", pitches: [P.E3, P.G3, P.C4, P.A3, P.D4, P.E4, P.G4, P.C5] },
    ],
  },

  // i -> iv -> VI -> v. Two minor chords either side of Bb; the Am at the end
  // falls back into the Dm rather than lifting out of it.
  lament: {
    id: "lament",
    label: "lament",
    description: "Dm Gm Bb Am — falls and falls again.",
    collection: "naturalMinor",
    dwellScale: 1,
    chords: [
      { name: "Dm", pitches: [P.D3, P.F3, P.A3, P.G3, P.C4, P.D4, P.F4, P.A4] },
      // Gm — chord tones G Bb D, coloured with C and F.
      { name: "Gm", pitches: [P.G3, P.Bb3, P.D4, P.C4, P.F3, P.G4, P.Bb4, P.D3] },
      { name: "Bb", pitches: [P.D3, P.F3, P.Bb3, P.G3, P.C4, P.D4, P.F4, P.Bb4] },
      // Am — chord tones A C E, coloured with D and G.
      { name: "Am", pitches: [P.A3, P.C4, P.E4, P.D4, P.G3, P.A4, P.C5, P.E3] },
    ],
  },

  // i -> IV -> VII -> i, in dorian. The G is major here, not minor, which is
  // the whole point: the B natural lifts the rotation out of the lament.
  dorian: {
    id: "dorian",
    label: "dorian",
    description: "Dm G C Dm — the major fourth lifts it.",
    collection: "dorian",
    dwellScale: 1,
    chords: [
      { name: "Dm", pitches: [O.D3, O.F3, O.A3, O.G3, O.C4, O.D4, O.F4, O.A4] },
      // G — chord tones G B D, coloured with A and E. The B natural is what
      // separates dorian from natural minor.
      { name: "G", pitches: [O.G3, O.B3, O.D4, O.A3, O.E4, O.G4, O.B4, O.D3] },
      { name: "C", pitches: [O.E3, O.G3, O.C4, O.A3, O.D4, O.E4, O.G4, O.C5] },
      { name: "Dm", pitches: [O.D3, O.F3, O.A3, O.G3, O.C4, O.D4, O.F4, O.A4] },
    ],
  },

  // i -> VI, held twice as long. Two chords breathing in and out; the least
  // eventful rotation, for scenes where the harmony should be weather.
  breath: {
    id: "breath",
    label: "breath",
    description: "Dm Bb — two chords, held twice as long.",
    collection: "naturalMinor",
    dwellScale: 2,
    chords: [
      { name: "Dm", pitches: [P.D3, P.F3, P.A3, P.G3, P.C4, P.D4, P.F4, P.A4] },
      { name: "Bb", pitches: [P.D3, P.F3, P.Bb3, P.G3, P.C4, P.D4, P.F4, P.Bb4] },
    ],
  },
};

/** Every progression, in the order a picker should present them. */
export const PROGRESSION_IDS: ProgressionId[] = [
  "circular",
  "drifter",
  "lament",
  "dorian",
  "breath",
];

/** The rotation used unless a caller picks another. */
export const DEFAULT_PROGRESSION_ID: ProgressionId = "circular";

/**
 * The chords of the default rotation. Kept as a named export because it is the
 * palette anything not choosing a progression falls back to.
 */
export const CHORD_PROGRESSION: Chord[] =
  PROGRESSIONS[DEFAULT_PROGRESSION_ID].chords;

/** Look up a progression, falling back to the default for an unknown id. */
export function progressionById(id: ProgressionId | undefined): Progression {
  return PROGRESSIONS[id ?? DEFAULT_PROGRESSION_ID] ??
    PROGRESSIONS[DEFAULT_PROGRESSION_ID];
}

/**
 * Whether a pitch belongs to a collection. The membership test a progression's
 * palettes are checked against — dorian palettes are measured against D dorian,
 * everything else against D natural minor, so B natural is legal in exactly one
 * of them.
 */
export function isPitchInCollection(
  pitch: number,
  collection: PitchCollection,
): boolean {
  return Object.values(PITCH_COLLECTIONS[collection]).some(
    (member) => Math.abs(member - pitch) < 1e-6,
  );
}

/** Base time each chord holds before the progression advances (ms). */
export const CHORD_DWELL_MS = 20000;

export function scaleForChord(chord: Chord): number[] {
  return chord.pitches;
}

/**
 * How many entries at the front of a palette are the chord's own tones.
 *
 * Every palette above is written the same way: root, third and fifth first, in
 * ascending order, then the colouring tones. A voice that must stay on the
 * harmony — a soloist arpeggio, a descant leading through the chord — reads
 * this prefix rather than the whole palette, so it never lands on a colour
 * tone and never has to guess which entries are consonant.
 */
export const CHORD_TONE_COUNT = 3;

/**
 * The chord's own tones from a palette, low to high, with their octave
 * duplicates. The palette repeats its pitch classes an octave up in its upper
 * half, so a voice constrained to chord tones still has a range to move in
 * rather than three fixed pitches.
 */
export function chordTones(scale: number[]): number[] {
  if (scale.length === 0) return [];
  const base = scale.slice(0, Math.min(CHORD_TONE_COUNT, scale.length));
  const classes = base.map(pitchClassOf);
  const tones = scale.filter((pitch) =>
    classes.some((cls) => Math.abs(pitchClassOf(pitch) - cls) < 1e-6),
  );
  return [...new Set(tones)].sort((a, b) => a - b);
}

/**
 * A pitch reduced to its class, as semitones above D0 within one octave. Two
 * pitches an octave apart share a class, which is how a palette's upper
 * octave is recognised as the same chord tone.
 */
function pitchClassOf(frequency: number): number {
  const semitones = 12 * Math.log2(frequency / D_NATURAL_MINOR_PITCHES.D3);
  const wrapped = ((semitones % 12) + 12) % 12;
  // Anything within a cent of the octave belongs to the class below it, not
  // to a class of its own just under 12.
  return wrapped > 12 - 0.01 ? 0 : wrapped;
}

/**
 * The chord tone nearest a pitch, so a voice moving onto a new chord steps to
 * its closest consonance rather than jumping. Returns the pitch unchanged when
 * the palette has no chord tones to move onto.
 */
export function nearestChordTone(pitch: number, scale: number[]): number {
  const tones = chordTones(scale);
  return tones.length === 0 ? pitch : leadHomeTone(pitch, tones);
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
 * The four bands span roughly D2-C5 and overlap generously, the way real
 * voice parts do — a hard split at the octave makes the crowd sound like four
 * separate instruments rather than one choir. Bass and tenor keep their full
 * octave-plus-a-semitone width; alto and soprano are compressed into a
 * smaller top of the range (each a clean octave, overlapping the neighbours
 * on both sides by more than the original semitone) so the ensemble's
 * ceiling sits at C5 rather than reaching into D6 — nothing sustained should
 * ring above about C5.
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
 * Bass and tenor are anchored on D so their bounds land on octaves of the
 * key's root: D2 ~73Hz, D3 ~147Hz, each a little over an octave wide. Alto
 * and soprano are compressed to fit the remaining room under the C5 ceiling —
 * A3-A4 and C4-C5, each a clean octave — rather than continuing the D-anchored
 * ladder up to D6.
 */
export const REGISTER_BAND_RANGES: Record<
  RegisterBand,
  { minHz: number; maxHz: number }
> = {
  bass: { minHz: 73.42, maxHz: 155.56 },
  tenor: { minHz: 146.83, maxHz: 311.13 },
  alto: { minHz: 220.0, maxHz: 440.0 },
  soprano: { minHz: 261.63, maxHz: 523.25 },
};

/**
 * Which mechanism assigns a trail its register band.
 *
 * "hue" reads the band off the colour wheel; "luminance" reads it off how
 * bright the colour looks. Both are cross-modal mappings from the same colour,
 * so switching between them changes which visual property the ear tracks.
 */
export type RegisterMappingMode = "hue" | "luminance";

/**
 * Which register a trail sings in, from the hue of the colour it is drawn in.
 *
 * Hue is split into four quadrants and each takes one choral part, cool to
 * warm, low to high:
 *
 *   blue/purple  (hue 200-289) -> bass     (D2-D#3)
 *   cyan/green   (hue 110-199) -> tenor    (D3-D#4)
 *   yellow/lime  (hue  50-109) -> alto     (A3-A4)
 *   red/pink     (hue 290-49)  -> soprano  (C4-C5)
 *
 * Cool colours sit low and warm colours sit high: a blue trail rumbles, a red
 * one rings out on top. The boundaries are rotated off the multiples of 90 so
 * each quadrant is centred on a colour you would name — bass on blue (~245),
 * tenor on green (~155), alto on yellow (~80), soprano on red (~350) — rather
 * than straddling two of them. Soprano wraps through 0, which is what puts the
 * whole red-through-pink arc in one part instead of splitting it.
 *
 * Unparseable colours fall to alto, the middle of the range, so a trail with a
 * colour the parser does not recognise still sings somewhere sensible.
 */
export function registerBandForHue(hue: number): RegisterBand {
  const normalized = ((hue % 360) + 360) % 360;
  if (normalized >= 200 && normalized < 290) return "bass";
  if (normalized >= 110 && normalized < 200) return "tenor";
  if (normalized >= 50 && normalized < 110) return "alto";
  return "soprano";
}

/**
 * Perceived brightness of a colour, 0 (black) to 1 (white).
 *
 * Rec. 709 luma weights on the rendered RGB: green carries most of the
 * perceived light, blue almost none, which is why a saturated blue and a
 * saturated yellow at the same HSL lightness look nothing alike.
 */
export function perceivedLuminance(rgb: {
  r: number;
  g: number;
  b: number;
}): number {
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

/** Convert HSL (h 0-360, s/l 0-100) to RGB with each channel in 0-1. */
export function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = s / 100;
  const light = l / 100;
  if (sat === 0) return { r: light, g: light, b: light };
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t: number): number => {
    let position = t;
    if (position < 0) position += 1;
    if (position > 1) position -= 1;
    if (position < 1 / 6) return p + (q - p) * 6 * position;
    if (position < 1 / 2) return q;
    if (position < 2 / 3) return p + (q - p) * (2 / 3 - position) * 6;
    return p;
  };
  return {
    r: channel(hue + 1 / 3),
    g: channel(hue),
    b: channel(hue - 1 / 3),
  };
}

/**
 * Luminance cut points separating the four bands, dark to bright.
 *
 * Chosen as the quartiles of the perceived brightness of the colours the
 * cursors actually wear — random hue at 65-80% saturation and 55-70%
 * lightness — so a mixed crowd spreads across all four parts rather than
 * piling into one. Fixed thresholds rather than a running percentile: a band
 * should mean the same thing from one scene to the next, and a scene of five
 * blue trails should sound like five bass trails, not like a whole choir.
 */
export const REGISTER_LUMINANCE_THRESHOLDS = [0.49, 0.63, 0.77];

/**
 * Which register a trail sings in, from how bright its colour looks.
 *
 * The darkest quarter of the colour space sings bass and the brightest sings
 * soprano, which is the association a listener reaches for without being told:
 * dark is heavy, bright is light. Unlike the hue mapping this cuts across the
 * colour wheel — a dark red and a dark blue share a part.
 */
export function registerBandForLuminance(luminance: number): RegisterBand {
  const [low, mid, high] = REGISTER_LUMINANCE_THRESHOLDS;
  if (luminance < low) return "bass";
  if (luminance < mid) return "tenor";
  if (luminance < high) return "alto";
  return "soprano";
}

/**
 * The band a colour assigns a trail under the mapping currently in force.
 */
export function registerBandForColor(
  hsl: { h: number; s: number; l: number },
  mode: RegisterMappingMode,
): RegisterBand {
  if (mode === "luminance") {
    return registerBandForLuminance(
      perceivedLuminance(hslToRgb(hsl.h, hsl.s, hsl.l)),
    );
  }
  return registerBandForHue(hsl.h);
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

/**
 * The next tone up from `pitch` inside a collection — its diatonic upper
 * neighbour. Used to build a suspension: the neighbour is held against the
 * chord tone below it, then falls onto it.
 *
 * Searching the collection rather than the chord palette is deliberate. A
 * palette holds only eight of the collection's notes, so the "next one up" in
 * a palette can be a third away, which is a chord tone rather than a
 * suspension. The collection's next note is always a step.
 *
 * Returns null when nothing in the collection sits above the pitch.
 */
export function upperNeighbor(
  pitch: number,
  collection: PitchCollection,
): number | null {
  let best: number | null = null;
  for (const member of Object.values(PITCH_COLLECTIONS[collection])) {
    if (member <= pitch + 1e-6) continue;
    if (best === null || member < best) best = member;
  }
  return best;
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
