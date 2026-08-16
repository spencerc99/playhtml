// ABOUTME: Core generative sound engine driven by cursor trail animation data
// ABOUTME: Manages Web Audio voices, maps trail frames to musical parameters each animation frame

import {
  TrailSoundFrame,
  ClickSoundEvent,
  InstrumentConfig,
  NavigationSoundEvent,
  AuditionAccent,
  SoundLayer,
  SOUND_LAYERS,
} from "./types";
import {
  directionToPitch,
  computeDirection,
  computeVelocity,
  velocityToGain,
  positionToPan,
  scaleForChord,
  bellScaleForChord,
  hashIdentity,
  hashUnit,
  homeToneForHash,
  leadHomeTone,
  ATTACK_SALT,
  DETUNE_SALT,
  VIBRATO_DEPTH_SALT,
  VIBRATO_RATE_SALT,
  CHORD_PROGRESSION,
  CHORD_DWELL_MS,
  D_MINOR_PENTATONIC,
} from "./scales";
import { getInstrument, CLICK_BELL } from "./instruments";
import { NotesEngine } from "./NotesEngine";

/** Minimum time between note changes for a single voice (ms) */
const MIN_NOTE_INTERVAL_MS = 80;

/** Ordinary pitch move: fast enough that motion still reads as note changes. */
const NOTE_GLIDE_SECONDS = 0.08;

/**
 * Pitch move onto a newly-led home tone. Long, so a sounding voice slides into
 * the new chord rather than snapping — the rotation should be heard as the
 * ensemble leaning, not as everyone retuning on a downbeat.
 */
const VOICE_LEADING_GLIDE_SECONDS = 1;

/** Nominal frame interval, used to rate-limit per-frame smoothing. */
const FRAME_MS = 16;

/** Fixed reverb send used whenever the energy arc is not driving it. */
const DEFAULT_REVERB_SEND = 0.3;

/** Duration of cursor-instrument timbre crossfades (seconds). */
const OSCILLATOR_CROSSFADE_SECONDS = 0.03;

/** Minimum velocity to trigger any sound (pixels per frame at ~60fps) */
const SILENCE_VELOCITY_THRESHOLD = 0.05;

/** Reference frame duration used to make cursor velocity independent of rAF lag. */
const REFERENCE_FRAME_DURATION_MS = 1000 / 60;

/** Interval between continuous gain and pan updates for each voice. */
const VOICE_CONTROL_INTERVAL_MS = 50;

/**
 * Ramp length for throttled continuous params. Must be at least
 * VOICE_CONTROL_INTERVAL_MS so each ramp is still in flight when the next one
 * is scheduled; a shorter ramp lands early and holds, and the resulting
 * staircase of held values is audible as zipper noise.
 */
const VOICE_CONTROL_RAMP_SECONDS = 0.07;

/** Interval between repeated plucks for percussive cursor types like text (ms) */
const PLUCK_REPEAT_INTERVAL_MS = 120;

/** Distance threshold for trail crossing detection (pixels) */
const CROSSING_DISTANCE_THRESHOLD = 15;

/** Minimum time between crossing triggers for the same pair (ms) */
const CROSSING_COOLDOWN_MS = 500;
/** Default user-facing volume when sound is enabled. */
const DEFAULT_MASTER_VOLUME = 0.5;
/**
 * Lower bound for overlap normalization so dense scenes stay audible while
 * preventing clipping/crackle when many trails stack at once.
 */
const MIN_POLYPHONY_GAIN_SCALE = 0.35;

/**
 * How trail motion becomes sound.
 * "sustained" holds one continuous oscillator per trail whose pitch and gain
 * follow the cursor. "spotlight" is that same sustained sound with the
 * relative-velocity soloist treatment layered on. "notes" emits discrete
 * plucked events as a trail travels, so movement reads as rhythm and melody
 * rather than a drone.
 */
export type SoundMode = "sustained" | "spotlight" | "notes";

/**
 * What happens when one trail crosses another's path.
 * "dissonance" sounds a tense interval at the crossing point; "merge" sounds
 * the two trails' home chord tones as a consonant dyad and briefly pulls their
 * timbres together, so a crossing reads as recognition rather than friction.
 */
export type CrossingFlavor = "off" | "dissonance" | "merge";

/** Configurable sound modes */
export interface SoundConfig {
  mode: SoundMode;
  chordVoicing: boolean;
  cursorInstruments: boolean;
  crossings: CrossingFlavor;
  /**
   * Give each trail a stable sonic fingerprint — a home chord tone it biases
   * toward, plus its own detune, vibrato and attack. Identity, not novelty:
   * the crowd should still voice one chord.
   */
  trailVoices: boolean;
  /**
   * Breathing dynamics over the sustained bed: a trail that keeps moving
   * crescendos like a bowed string leaning in, releases slowly when it stops,
   * and the whole bed rises and falls on a slow ensemble breath.
   */
  swells: boolean;
  /**
   * Colour the sustained crowd with vowel formants, so the bed reads as voices
   * rather than as oscillators. The vowel opens from "ooh" to "ahh" with speed.
   */
  choralTimbre: boolean;
  /**
   * Relative-velocity spotlight over the sustained voices: the fastest clear
   * outlier is lifted and brightened while the rest duck behind it.
   */
  spotlight: boolean;
  /** Rotate the harmonic root through a slow chord progression. */
  chordRotation: boolean;
  /** Let accumulated scene motion swell and relax the whole mix. */
  energyArc: boolean;
  /** Soft two-note figures as trails enter and leave the scene. */
  trailArrivals: boolean;
  /** A deep resonant note on each animated page navigation. */
  navigationSounds: boolean;
  /** A sustained low drone on the current chord root, under everything. */
  bassPedal: boolean;
}

/**
 * What `setConfig` accepts. `crossingDissonance` is the boolean this setting
 * used to be, kept so existing callers keep working; it maps onto `crossings`.
 */
export type SoundConfigInput = Partial<SoundConfig> & {
  /** @deprecated Pass `crossings: "dissonance" | "off"` instead. */
  crossingDissonance?: boolean;
};

const DEFAULT_CONFIG: SoundConfig = {
  mode: "sustained",
  chordVoicing: false,
  cursorInstruments: false,
  crossings: "off",
  trailVoices: false,
  swells: false,
  choralTimbre: false,
  spotlight: false,
  chordRotation: false,
  energyArc: false,
  trailArrivals: false,
  navigationSounds: false,
  bassPedal: false,
};

/**
 * Per-trail fingerprint tuning. Every value here is deliberately small: the
 * point is that a listener can tell two trails apart when they are side by
 * side, not that any one trail sounds like a different instrument.
 */
const TRAIL_VOICE_TUNING = {
  /**
   * How often a direction-derived note change is overruled in favour of the
   * trail's home tone. High enough that a crowd audibly settles onto the
   * chord, low enough that motion still drives the melody.
   */
  homeToneBias: 0.4,
  /** Per-trail pitch offset, in cents either side of true. */
  maxDetuneCents: 8,
  /** Personal vibrato: a slow LFO on the voice's frequency. */
  vibratoMinRateHz: 3,
  vibratoMaxRateHz: 6,
  /** Vibrato depth in cents. Under 4 reads as warmth rather than as wobble. */
  maxVibratoDepthCents: 4,
  /**
   * Multiplier range on the instrument's attack, so some trails speak a touch
   * more promptly than others.
   */
  minAttackScale: 0.7,
  maxAttackScale: 1.4,
};

/**
 * Swell tuning. Loudness stops tracking velocity instantly and instead
 * breathes: a trail that keeps moving leans in over seconds, and one that
 * stops falls away rather than cutting.
 */
const SWELL_TUNING = {
  /**
   * How long a trail must move continuously before the crescendo begins. Short
   * gestures finish inside this window and so keep the responsive, unswelled
   * behaviour — the swell is for sustained motion, not for flicks.
   */
  onsetMs: 800,
  /** Seconds the crescendo takes to reach its peak once it starts. */
  crescendoSeconds: 2.5,
  /** Gain multiplier at the top of a full crescendo. */
  peakScale: 1.4,
  /** Seconds a voice takes to fall away once its trail stops. */
  releaseSeconds: 1.5,
  /**
   * Motion below this (px/frame) counts as stopped for swell purposes. Above
   * the silence threshold, so a barely-drifting cursor releases rather than
   * holding a crescendo it is no longer earning.
   */
  movingVelocity: 0.6,
  /**
   * How long a trail may pause without losing its accumulated crescendo. Real
   * cursor motion has gaps in it; without this every one of them would reset
   * the swell and the bed would never actually lean in.
   */
  motionGraceMs: 250,
  /** The ensemble breath: one slow sine over the whole bed. */
  breathPeriodSeconds: 21,
  /** Breath depth as a fraction either side of unity. */
  breathDepth: 0.15,
};

/**
 * Choral tuning. Two vowel formant pairs, morphed by velocity, so the bed
 * reads as voices: closed and dark when slow, open and bright when fast.
 */
const CHORAL_TUNING = {
  /** "ooh" — the closed vowel a slow trail sits on. */
  closedFormantsHz: [300, 870],
  /** "ahh" — the open vowel a fast trail reaches. */
  openFormantsHz: [700, 1220],
  /** Resonance of each formant band. High enough to colour, low enough to sing. */
  formantQ: 6,
  /**
   * Level of the formant bands against the voice's own filtered tone. The
   * fundamental stays present underneath — the formants are a colour over it,
   * not a replacement.
   */
  formantMix: 0.55,
  /** Velocity that maps to the fully open vowel. */
  fullOpenVelocity: 12,
  /** Ramp length for formant moves, matched to the voice control throttle. */
  morphSeconds: 0.12,
};

/**
 * Crossing-merge tuning. Two trails meeting sound their own home tones
 * together and briefly pull toward each other before drifting back apart.
 */
const CROSSING_MERGE_TUNING = {
  /** Peak gain of the dyad, matched to the dissonance it replaces. */
  dyadGain: 0.06,
  attackSeconds: 0.02,
  decaySeconds: 1.5,
  /** Level of the 3x partial that gives the dyad its bell body. */
  partialGain: 0.25,
  /** How long the two sustained voices stay pulled together (ms). */
  pullDurationMs: 1500,
  /** Register multiplier placing the dyad above the sustained bed. */
  registerMultiplier: 2,
};

/**
 * Trail arrival/departure tuning. A trail entering the scene rises through two
 * notes, one leaving falls through them, so the population of the canvas is
 * audible without needing to watch it.
 */
const ARRIVAL_TUNING = {
  /**
   * Octave multiplier placing the chime above the bed. The palettes sit in
   * D3-C5, so the top of the palette doubled lands the cluster around C5-D6 —
   * the register a door chime actually occupies.
   */
  registerMultiplier: 2,
  /** How many notes an arrival chime scatters. */
  minNotes: 3,
  maxNotes: 5,
  /** Gap between consecutive chime notes (seconds), jittered per note. */
  minSpacingSeconds: 0.06,
  maxSpacingSeconds: 0.12,
  /** Peak gain, kept under the click bell so a real click stays the accent. */
  noteGain: 0.026,
  /** Level of the 3x partial relative to the fundamental. */
  partialGain: 0.22,
  attackSeconds: 0.006,
  /** Light shimmering ring-out, varied per note. */
  minDecaySeconds: 1.2,
  maxDecaySeconds: 2,
  /** Per-note detune spread, in cents either side, so the cluster shimmers. */
  detuneCents: 5,
  /** How many pitches from the top of the palette the chime draws from. */
  paletteTopCount: 5,
  /** Departure sits quieter, shorter and falling. */
  departureGainScale: 0.8,
  departureNotes: 3,
  departureDecaySeconds: 1.4,
  /**
   * Minimum gap between arrival sounds for the same trail, so a trail
   * flickering in and out of the active set does not retrigger.
   */
  perTrailDebounceMs: 2000,
  /**
   * Global ceiling on arrival sounds. A day swap or a data load makes dozens
   * of trails appear at once; without a cap that lands as a volley rather than
   * as arrivals, so anything over the rate is dropped silently.
   */
  maxPerSecond: 2,
  /**
   * How long arrivals stay silent after a reset. Long enough for the rebuilt
   * scene's initial population to land without sounding, short enough that
   * genuinely new trails afterwards still announce themselves.
   */
  resetSuppressionMs: 1500,
};

/**
 * Navigation-note tuning. One deep resonant strike per animated navigation,
 * far below the click bells so a page change reads as structural.
 */
const NAVIGATION_TUNING = {
  /**
   * Octave multiplier on the chord root, placing the note at the root itself
   * (D3). An octave lower put the fundamental near 73Hz, under the point where
   * laptop speakers reproduce anything, so the note was inaudible outside
   * headphones. D3 still sits well below the click bells.
   */
  registerMultiplier: 1,
  /** Detune of the two supporting partials, in cents either side. */
  detuneCents: 7,
  /** Level of the detuned partials relative to the fundamental. */
  partialGain: 0.35,
  /**
   * Level of the octave-up shimmer that gives the strike its edge. Carries the
   * note on speakers that roll off the fundamental.
   */
  octaveGain: 0.3,
  peakGain: 0.32,
  attackSeconds: 0.008,
  decaySeconds: 3.5,
  /** Lowpass cutoff, high enough to pass the octave partial's harmonics. */
  filterHz: 1800,
  /** Minimum gap between navigation notes; extras are dropped. */
  minIntervalMs: 1500,
};

/**
 * Bass-pedal tuning. A single very quiet low voice on the chord root, held
 * under the whole scene and crossfaded rather than pitch-slid when the
 * progression moves.
 */
const BASS_PEDAL_TUNING = {
  /** Octave multiplier on the chord root, placing the drone in D2. */
  registerMultiplier: 0.5,
  /** Steady gain. Well under the crowd bed — felt as floor, not as a part. */
  gain: 0.055,
  /** Seconds to fade the pedal in when it is switched on. */
  fadeInSeconds: 1.5,
  /** Seconds to fade the pedal out when it is switched off. */
  fadeOutSeconds: 0.8,
  /** Overlap when the chord moves: the old root fades as the new one rises. */
  crossfadeSeconds: 2,
  /** Lowpass cutoff, keeping the drone dark under the mix (Hz). */
  filterHz: 220,
  filterQ: 0.7,
  /** Extra gain at full energy when the energy arc is driving it. */
  energyGainBoost: 0.6,
};

/**
 * Energy-arc tuning. Energy is a slow leaky integral of total scene motion,
 * normalized to 0-1, driving master swell and reverb depth.
 */
const ENERGY_TUNING = {
  /** Time constant of the energy follower (ms). */
  timeConstantMs: 10000,
  /** Scene motion (summed px/frame) that reads as fully energized. */
  fullScaleMotion: 120,
  /** Master gain multiplier at zero energy and at full energy. */
  minGain: 0.7,
  maxGain: 1.15,
  /** Reverb send at zero energy and at full energy. */
  minReverb: 0.12,
  maxReverb: 0.55,
  /**
   * Below this energy the mix is treated as a lull and decays toward silence,
   * so the next burst of activity lands with contrast.
   */
  lullThreshold: 0.12,
  /** Master multiplier at the very bottom of a lull. */
  lullFloorGain: 0.12,
  /** Chord dwell scaling when energyArc rides chordRotation. */
  dwellAtLowEnergy: 1.6,
  dwellAtHighEnergy: 0.55,
};

/**
 * Spotlight tuning. Detection thresholds mirror the discrete-note engine's
 * soloist rules so the two modes promote the same trails, but the treatment
 * here is gain/brightness on continuous voices rather than note selection.
 */
const SPOTLIGHT_TUNING = {
  /** Seconds of velocity history behind the rolling scene average. */
  velocityWindowMs: 3000,
  /** Velocity ratio vs the rest of the scene that promotes a trail to soloist. */
  velocityRatio: 2.5,
  /**
   * Ratio the soloist must fall below to be demoted. Well under the promote
   * ratio: real cursor velocity oscillates within a single sweep, so a shared
   * threshold makes a trail promote and demote several times a second, and
   * every one of those flaps costs a resolving note plus a fresh anticipation
   * silence. That alternation is the audible interrupt.
   */
  demoteVelocityRatio: 1.4,
  /** Absolute floor so a calm scene never promotes near-still noise. */
  minVelocity: 4,
  /** Absolute floor the soloist must drop below to be demoted. */
  demoteMinVelocity: 2.2,
  /**
   * Shortest a promotion can last. A flourish needs room to read as a phrase,
   * so once a trail has the spotlight it keeps it for at least this long even
   * if it dips.
   */
  minSoloDurationMs: 1000,
  /**
   * Time constant of the smoothed velocity the soloist test runs on. Raw
   * per-frame velocity is dominated by rAF jitter and within-sweep speed
   * changes; the decision needs the shape of the gesture, not the frame.
   */
  velocitySmoothingMs: 120,
  /**
   * Gain multiplier applied to the soloist's sustained voice. Deliberately
   * mild — the flourish notes carry the drama, so a big boost here just makes
   * a louder drone.
   */
  soloistGain: 1.1,
  /** Gain multiplier applied to every other voice while a soloist holds. */
  duckedGain: 0.4,
  /** Ramp onto the soloist/ducked targets — fast enough to feel like a cue. */
  attackSeconds: 0.25,
  /** Recovery back to unity once the outlier subsides. */
  releaseSeconds: 1,
  /**
   * Brightness range the soloist's filter sweeps across. The floor sits above
   * every instrument's own cutoff so promotion always opens the filter rather
   * than closing it — a soloist is never darker than it was unpromoted.
   */
  filterMinHz: 3200,
  filterMaxHz: 6000,
  /** Velocity that maps to fully-open brightness. */
  filterFullVelocity: 40,
  /**
   * Filter ramp length. Longer than the control interval so consecutive
   * targets connect into one continuous glide instead of a stair-step.
   */
  filterRampSeconds: 0.12,
};

/**
 * Soloist flourish tuning. While a trail holds the spotlight its sustained
 * voice steps back and it plays a run of discrete bell notes along its path,
 * so the promotion reads as an event rather than a louder drone.
 */
const FLOURISH_TUNING = {
  /** Pixels of travel between flourish notes. */
  distancePerNotePx: 50,
  /** Floor on the gap between one trail's notes, so a sprint stays musical. */
  minNoteIntervalMs: 70,
  /**
   * Silence between promotion and the first note. A beat of nothing makes the
   * run read as an entrance rather than a continuation.
   */
  anticipationMs: 80,
  /**
   * Multiplier on the soloist's sustained voice while it is flourishing. It
   * ducks toward the bed rather than disappearing — the drone is still the
   * trail's body, the notes are its gesture.
   */
  sustainedDuck: 0.5,
  /** Seconds over which the sustained voice returns to normal after demotion. */
  sustainedRecoverySeconds: 1,
  /** Bell envelope (seconds). Fast strike, exponential ring-out. */
  attackSeconds: 0.005,
  decayMinSeconds: 0.8,
  decayMaxSeconds: 1.5,
  /** Peak gain, kept under CLICK_BELL.gain so real clicks stay the accent. */
  noteGain: 0.055,
  /** Level of the 3x partial relative to the fundamental. */
  partialGain: 0.3,
  /** Cap on simultaneously-sounding flourish notes. */
  maxConcurrentNotes: 16,
  /** Velocity that maps to the top of the register range. */
  registerFullVelocity: 30,
  /**
   * Register window the flourish selects across, as octave multipliers on the
   * chosen palette pitch. The palettes sit in D3-C5, so 1x-2x covers D3-C6
   * without ever leaving the key.
   */
  registerMinMultiplier: 1,
  registerMaxMultiplier: 2,
  /** The resolving note played once on demotion. */
  resolveDecaySeconds: 2.2,
  resolveGainScale: 0.8,
};

/** Click-bell pitches used whenever the chord progression is not rotating. */
const FIXED_BELL_SCALE = [
  293.66, // D4
  349.23, // F4
  392.0,  // G4
  440.0,  // A4
  523.25, // C5
  587.33, // D5
];

/** Cursor types that use repeating pluck instead of sustained tone */
const PERCUSSIVE_CURSOR_TYPES = new Set(["text"]);

/**
 * A trail's stable sonic identity, derived once from its identity key. Every
 * field is a pure function of the hash, so the same participant sounds the
 * same across reloads, and re-deriving after a chord change moves only the
 * home tone.
 */
interface TrailFingerprint {
  /** The hash itself, kept so the initial home tone can be derived. */
  hash: number;
  /**
   * The chord tone this trail currently calls home. Seeded from the hash on
   * first sight, then led to the nearest tone of each new palette rather than
   * re-hashed — see `leadHomeTone`. This is the one field of a fingerprint
   * that is not a pure function of the hash.
   */
  homeTone: number;
  /** Palette the home tone was last led onto, so a rotation is detected once. */
  homeToneScale: number[] | null;
  detuneCents: number;
  vibratoRateHz: number;
  vibratoDepthCents: number;
  /** Multiplier on the instrument's own attack time. */
  attackScale: number;
}

/** The LFO pair giving one voice its personal vibrato. */
interface VibratoNodes {
  oscillator: OscillatorNode;
  depth: GainNode;
}

/**
 * One voice's formant bank: parallel bandpass filters tapped off the voice's
 * own filtered tone and mixed back in beside it.
 */
interface FormantNodes {
  filters: BiquadFilterNode[];
  mix: GainNode;
  /** Last vowel openness scheduled, so an unchanged morph is not re-ramped. */
  lastOpenness: number;
}

/** How long a trail has been moving, and where its swell has got to. */
interface SwellState {
  /** Tick time continuous motion began, or null while the trail is stopped. */
  movingSinceMs: number | null;
  /** Tick time motion was last observed, for the pause grace window. */
  lastMovingMs: number;
  /** Smoothed 0-1 crescendo progress, so the multiplier never jumps. */
  progress: number;
}

/** Per-trail voice state */
interface Voice {
  oscillator: OscillatorNode | null;
  oscillatorLevel: GainNode | null;
  /** Fifth oscillator for chord voicing mode */
  fifthOscillator: OscillatorNode | null;
  fifthOscillatorLevel: GainNode | null;
  gainNode: GainNode;
  /** Separate gain for the fifth so we can enable/disable it */
  fifthGainNode: GainNode | null;
  filterNode: BiquadFilterNode;
  panNode: StereoPannerNode;
  currentFrequency: number;
  lastNoteTimeMs: number;
  lastCursorType: string | undefined;
  /** Last time a percussive pluck was triggered (ms) */
  lastPluckMs: number;
  lastControlTimeMs: number;
  /** True while spotlight brightness owns this voice's filter cutoff. */
  spotlightBrightened: boolean;
  /** Personal vibrato LFO, present only while trail voices are on. */
  vibrato: VibratoNodes | null;
  /** Vowel formant bank, present only while the choral timbre is on. */
  formants: FormantNodes | null;
  /** Detune in cents currently applied, so a merge can pull it and restore it. */
  appliedDetuneCents: number;
  /**
   * Palette this voice last took a pitch from. When it differs from the one in
   * force, the voice has not yet moved into the new chord, so its next pitch
   * update is a voice-leading move and glides over `VOICE_LEADING_GLIDE_SECONDS`
   * rather than snapping.
   */
  lastPitchScale: number[] | null;
  active: boolean;
}

/** Bookkeeping for the run of notes a soloist plays along its path. */
interface FlourishState {
  /** When this trail was promoted, so the anticipation gap can be measured. */
  promotedAtMs: number;
  /** Travel accumulated since the last note fired. */
  distanceSinceNote: number;
  lastNoteTimeMs: number;
  /** Last position the soloist's palette index was drawn from. */
  paletteStep: number;
}

/** One low drone voice of the bass pedal. Two exist only mid-crossfade. */
interface BassPedalVoice {
  oscillator: OscillatorNode;
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
  frequency: number;
}

/** A single self-disconnecting flourish note. */
interface FlourishNote {
  oscillator: OscillatorNode;
  partial: OscillatorNode;
  gainNode: GainNode;
  partialGainNode: GainNode;
  panNode: StereoPannerNode;
  peakGain: number;
  startedAtMs: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverbGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private voices: Map<number, Voice> = new Map();
  private canvasWidth: number = 0;
  private enabled: boolean = false;
  private baseVolume: number = DEFAULT_MASTER_VOLUME;
  private lastActiveTrailCount: number = 0;
  private prevPositions: Map<number, { x: number; y: number }> = new Map();
  private prevSampleTimesMs: Map<number, number> = new Map();
  /** Accumulated path history per trail for crossing detection */
  private trailPaths: Map<number, Array<{ x: number; y: number }>> = new Map();
  private config: SoundConfig = { ...DEFAULT_CONFIG };
  /** Tracks recent crossing events to prevent rapid re-triggering */
  private crossingCooldowns: Map<string, number> = new Map();
  /** Per-trail sonic fingerprints, derived once from each trail's identity. */
  private fingerprints: Map<number, TrailFingerprint> = new Map();
  /** Identity key each fingerprint was derived from, to detect a re-key. */
  private fingerprintKeys: Map<number, string> = new Map();
  /**
   * Trails currently pulled toward unison by a merge, and the tick time the
   * pull expires. While pulled, a voice's detune and vibrato are overridden.
   */
  private mergePullsUntilMs: Map<number, number> = new Map();
  /** Per-trail crescendo bookkeeping, maintained only while swells are on. */
  private swells: Map<number, SwellState> = new Map();
  /** Discrete-note path, used only while config.mode is "notes". */
  private notesEngine: NotesEngine = new NotesEngine();
  /**
   * Rolling velocity samples per trail: [timestampMs, velocity]. Kept per
   * trail so a candidate can be compared against the rest of the scene
   * without its own speed inflating the bar it has to clear.
   */
  private spotlightVelocitySamples: Map<number, Array<[number, number]>> =
    new Map();
  /** Trail currently held by the sustained spotlight, or null. */
  private spotlightTrailIndex: number | null = null;
  /** When the current soloist was promoted, for the minimum-hold check. */
  private spotlightPromotedAtMs = 0;
  /**
   * Per-trail EMA of velocity. The soloist decision reads this rather than raw
   * per-frame velocity so a single slow frame inside a fast sweep cannot
   * demote the trail that is mid-flourish.
   */
  private spotlightSmoothedVelocities: Map<number, number> = new Map();
  private spotlightSceneAverage = 0;
  /** Per-trail smoothed spotlight gain multiplier, so ramps stay continuous. */
  private spotlightGains: Map<number, number> = new Map();
  /** Flourish bookkeeping for the trail currently soloing. */
  private flourish: FlourishState | null = null;
  /** One-shot flourish notes still ringing. */
  private flourishNotes: Set<FlourishNote> = new Set();
  /** Index into CHORD_PROGRESSION, and when the current chord started. */
  private chordIndex = 0;
  private chordStartedMs = 0;
  /** Smoothed 0-1 scene energy driving the swell. */
  private energy = 0;
  private lastEnergyTickMs: number | null = null;
  /** Trails that have already sounded an arrival, and when they last did. */
  private arrivalTimesMs: Map<number, number> = new Map();
  /** Chime seed per trail, so its arrival and departure share one pattern. */
  private arrivalSeeds: Map<number, number> = new Map();
  /** Timestamps of recent arrival sounds, for the global rate cap. */
  private recentArrivalsMs: number[] = [];
  /** Latest tick time, so retireTrail can rate-limit without its own clock. */
  private lastTickMs = 0;
  /**
   * Tick time until which arrivals stay silent. A reset tears the scene down
   * and rebuilds it, and sounding every trail in the new scene is a volley.
   */
  private arrivalsSuppressedUntilMs = Number.NEGATIVE_INFINITY;
  /** When the last navigation note fired, for the global rate limit. */
  private lastNavigationNoteMs = Number.NEGATIVE_INFINITY;
  /** The bass pedal voices currently sounding — two only while crossfading. */
  private bassPedalVoices: BassPedalVoice[] = [];
  /** Chord root the pedal is currently holding, so it only moves on a change. */
  private bassPedalFrequency: number | null = null;
  /** Last reverb target actually scheduled, so ramps are not restarted. */
  private lastReverbTarget = DEFAULT_REVERB_SEND;
  /** Last master gain target actually scheduled, for the same reason. */
  private lastMasterGainTarget = Number.NaN;
  /**
   * One gain node per sound family, sitting between that family's sources and
   * the master bus. Every source connects to its family's bus rather than to
   * master directly, so a family can be silenced without unpicking the graph.
   */
  private layerBuses: Map<SoundLayer, GainNode> = new Map();
  /** Layers explicitly muted from the playground's mixer strip. */
  private mutedLayers: Set<SoundLayer> = new Set();
  /** Layers explicitly soloed. Any entry here silences every other layer. */
  private soloedLayers: Set<SoundLayer> = new Set();

  async init(): Promise<void> {
    if (this.ctx) return;

    this.ctx = new AudioContext();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.baseVolume;
    this.lastMasterGainTarget = Number.NaN;

    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.createReverbImpulse(this.ctx, 3.0, 2.0);

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = DEFAULT_REVERB_SEND;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 12;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.2;

    // One bus per family, feeding master. Sources connect to these rather than
    // to master, which is what lets the playground's mixer solo or mute a
    // family without touching anything downstream.
    this.layerBuses.clear();
    for (const layer of SOUND_LAYERS) {
      const bus = this.ctx.createGain();
      bus.gain.value = this.layerGainValue(layer);
      bus.connect(this.masterGain);
      this.layerBuses.set(layer, bus);
    }

    this.masterGain.connect(this.compressor);
    this.masterGain.connect(this.reverbGain);
    this.reverbGain.connect(this.convolver);
    this.convolver.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);

    // Notes mode runs its own gain/compressor chain straight to the
    // destination, so it never inherits the sustained path's polyphony
    // ducking or 12:1 compression.
    this.notesEngine.attach(this.ctx, this.ctx.destination, this.convolver);
    this.notesEngine.setVolume(this.baseVolume);
    this.notesEngine.setCursorInstruments(this.config.cursorInstruments);

    this.enabled = true;

    // init() is triggered by a user gesture (sound-toggle click), so resuming
    // here satisfies the browser autoplay policy. Without this, the context
    // stays suspended until tick() happens to fire from AnimatedTrails' rAF
    // loop, which can delay audible sound by seconds.
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  private createReverbImpulse(
    ctx: AudioContext,
    duration: number,
    decay: number,
  ): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * duration;
    const impulse = ctx.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        channelData[i] =
          (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }

    return impulse;
  }

  setCanvasWidth(width: number): void {
    this.canvasWidth = width;
    this.notesEngine.setCanvasWidth(width);
  }

  /** Update sound configuration (mode, chord voicing, instruments, crossings) */
  setConfig(config: SoundConfigInput): void {
    const prevChord = this.config.chordVoicing;
    const prevMode = this.config.mode;
    const prevTrailVoices = this.config.trailVoices;
    const { crossingDissonance, ...rest } = config;
    Object.assign(this.config, rest);

    // Callers predating the three-way flavor pass a boolean. An explicit
    // `crossings` always wins, so a caller can send both during a migration.
    if (crossingDissonance !== undefined && config.crossings === undefined) {
      this.config.crossings = crossingDissonance ? "dissonance" : "off";
    }

    // Path history and cooldowns only mean anything while crossings are on;
    // leaving them behind would fire a stale crossing when it is switched back.
    if (this.config.crossings === "off") {
      this.trailPaths.clear();
      this.crossingCooldowns.clear();
      this.mergePullsUntilMs.clear();
    }

    // "spotlight" is the sustained engine with the soloist treatment on, so
    // the mode drives the flag unless a caller sets `spotlight` explicitly.
    if (config.mode !== undefined && config.spotlight === undefined) {
      this.config.spotlight = config.mode === "spotlight";
    }

    this.notesEngine.setCursorInstruments(this.config.cursorInstruments);

    // Turning the arc off must hand the reverb back to its fixed default,
    // otherwise it stays frozen at whatever the last energy value set.
    if (config.energyArc === false && this.reverbGain) {
      this.energy = 0;
      this.lastEnergyTickMs = null;
      this.lastReverbTarget = DEFAULT_REVERB_SEND;
      this.rampParam(this.reverbGain.gain, DEFAULT_REVERB_SEND, 0.3);
    }

    // Toggling an accent instrument off must silence it now rather than
    // waiting for the next tick, which may never come on a paused canvas.
    if (config.bassPedal === false) {
      this.releaseBassPedal();
    }
    if (config.trailArrivals === false) {
      this.arrivalTimesMs.clear();
      this.arrivalSeeds.clear();
      this.recentArrivalsMs.length = 0;
    }

    // Fingerprints are audible on the voices already sounding, so a toggle has
    // to reach them now rather than waiting for each voice to be recreated.
    if (prevTrailVoices !== this.config.trailVoices) {
      this.mergePullsUntilMs.clear();
      for (const [trailIndex, voice] of this.voices) {
        if (this.config.trailVoices) {
          this.applyFingerprintToVoice(voice, this.fingerprints.get(trailIndex));
        } else {
          this.clearFingerprintFromVoice(voice);
        }
      }
      if (!this.config.trailVoices) {
        this.fingerprints.clear();
        this.fingerprintKeys.clear();
      }
    }

    // Both of these are audible on voices already sounding, and a paused
    // canvas may never tick again, so switching them off has to land now.
    if (config.swells === false) {
      this.swells.clear();
      if (this.masterGain) {
        // Hand the master gain back a breath-free target rather than leaving
        // it frozen wherever the breath happened to be.
        this.lastMasterGainTarget = Number.NaN;
        this.updateMasterGainForPolyphony(this.lastActiveTrailCount);
      }
    }
    if (config.choralTimbre === false) {
      for (const [, voice] of this.voices) this.detachFormants(voice);
    }

    // Switching modes mid-session must not leave the other path sounding.
    if (prevMode !== this.config.mode) {
      if (this.config.mode === "notes") {
        this.releaseAllVoices();
      } else {
        this.notesEngine.reset();
      }
      // Drop smoothing state so the new mode does not inherit a stale duck.
      this.spotlightGains.clear();
      this.spotlightVelocitySamples.clear();
      this.spotlightSmoothedVelocities.clear();
      this.spotlightTrailIndex = null;
      this.spotlightSceneAverage = 0;
      this.clearFlourish();
    }

    // If chord voicing was toggled, update existing voices
    if (prevChord !== this.config.chordVoicing) {
      for (const [, voice] of this.voices) {
        if (this.config.chordVoicing) {
          this.enableFifth(voice);
        } else {
          this.disableFifth(voice);
        }
      }
    }
  }

  tick(elapsedMs: number, activeTrails: TrailSoundFrame[]): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;

    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    this.lastTickMs = elapsedMs;

    if (this.config.mode === "notes") {
      // Notes runs its own graph, so it needs the arc and progression applied
      // here rather than through the sustained voice loop below.
      this.updateEnergy(elapsedMs, activeTrails);
      this.updateChord(elapsedMs);
      this.updateEnergyReverb();
      // The accent instruments sit outside the mode split — they mark scene
      // and structure, not trail motion, so they sound the same either way.
      this.updateBassPedal();
      this.updateArrivals(elapsedMs, activeTrails);
      this.notesEngine.setScale(this.currentScale());
      this.notesEngine.setVolume(this.baseVolume * this.energyGainScale());
      this.notesEngine.tick(elapsedMs, activeTrails);
      // prevPositions feeds the energy measurement above; the sustained loop
      // that normally maintains it is skipped in this mode.
      this.prevPositions.clear();
      for (const frame of activeTrails) {
        this.prevPositions.set(frame.trailIndex, { x: frame.x, y: frame.y });
      }
      return;
    }

    const activeIndices = new Set(activeTrails.map((t) => t.trailIndex));
    this.lastActiveTrailCount = activeTrails.length;

    // These run before the voice loop overwrites prevPositions, so they
    // measure this frame's motion rather than the next one's. Energy leads,
    // since the master gain below folds in its swell.
    this.updateEnergy(elapsedMs, activeTrails);
    this.updateChord(elapsedMs);
    this.updateEnergyReverb();
    this.updateBassPedal();
    this.updateArrivals(elapsedMs, activeTrails);
    this.updateMasterGainForPolyphony(activeTrails.length);
    // Resolve the soloist before touching any voice, so every trail in this
    // frame is judged against the same scene average.
    this.updateSpotlight(elapsedMs, activeTrails);
    const scale = this.currentScale();

    for (const [idx, voice] of this.voices) {
      if (!activeIndices.has(idx) && voice.active) {
        this.releaseVoice(voice);
      }
    }

    for (const frame of activeTrails) {
      const prev = this.prevPositions.get(frame.trailIndex);
      const prevX = prev?.x ?? frame.x;
      const prevY = prev?.y ?? frame.y;
      const sampleTimeMs = this.ctx.currentTime * 1000;
      const prevSampleTimeMs = this.prevSampleTimesMs.get(frame.trailIndex);
      const sampleIntervalMs = prevSampleTimeMs === undefined
        ? REFERENCE_FRAME_DURATION_MS
        : Math.max(1, sampleTimeMs - prevSampleTimeMs);
      const distance = computeVelocity(prevX, prevY, frame.x, frame.y);
      const velocity =
        distance * (REFERENCE_FRAME_DURATION_MS / sampleIntervalMs);
      const gain = velocityToGain(velocity);

      // Fires before the silence check below: a soloist coasting to a stop
      // still owes its listener the notes it has already traveled for.
      if (
        this.config.spotlight &&
        this.spotlightTrailIndex === frame.trailIndex
      ) {
        this.advanceFlourish(elapsedMs, frame, distance, velocity);
      }

      this.prevPositions.set(frame.trailIndex, { x: frame.x, y: frame.y });
      this.prevSampleTimesMs.set(frame.trailIndex, sampleTimeMs);

      // Accumulate path history for crossing detection (sample every few pixels)
      if (this.config.crossings !== "off") {
        let path = this.trailPaths.get(frame.trailIndex);
        if (!path) {
          path = [];
          this.trailPaths.set(frame.trailIndex, path);
        }
        const lastPathPt = path[path.length - 1];
        if (
          !lastPathPt ||
          Math.abs(frame.x - lastPathPt.x) > 3 ||
          Math.abs(frame.y - lastPathPt.y) > 3
        ) {
          path.push({ x: frame.x, y: frame.y });
        }
      }

      if (velocity < SILENCE_VELOCITY_THRESHOLD) {
        const voice = this.voices.get(frame.trailIndex);
        if (voice?.active) {
          // With swells on a stopped trail is released rather than cut, so the
          // bed thins out as breath running out rather than as a gate closing.
          this.fadeVoice(
            voice,
            this.config.swells ? SWELL_TUNING.releaseSeconds : 0.05,
          );
        }
        // Keep advancing the crescendo so a stopped trail decays toward zero
        // instead of freezing at whatever it had reached.
        this.swellGainFor(frame.trailIndex, elapsedMs, 0);
        continue;
      }

      const direction = computeDirection(prevX, prevY, frame.x, frame.y);
      // Only newly-selected pitches use the current chord, so voices already
      // sounding drift into the new harmony at their own next note change
      // rather than all retuning together on the chord boundary.
      const directionPitch = directionToPitch(direction, scale);
      // With trail voices on, a share of note changes land on the trail's own
      // chord tone instead, so the crowd collectively voices the chord while
      // motion still steers the line.
      const fingerprint = this.config.trailVoices
        ? this.fingerprintFor(frame)
        : null;
      const frequency = fingerprint
        ? this.applyHomeToneBias(directionPitch, fingerprint)
        : directionPitch;
      const pan = positionToPan(frame.x, this.canvasWidth);

      // When cursor instruments are off, use the default instrument for all
      const instrument = this.config.cursorInstruments
        ? getInstrument(frame.cursorType)
        : getInstrument(undefined);

      let voice = this.voices.get(frame.trailIndex);

      if (!voice || !voice.oscillator) {
        voice = this.createVoice(instrument);
        this.voices.set(frame.trailIndex, voice);
      }

      // Also covers the toggle being switched on mid-scene: the fingerprint is
      // derived here, so a voice already sounding picks up its identity on the
      // very next frame rather than waiting to be recreated.
      if (fingerprint && !voice.vibrato) {
        this.applyFingerprintToVoice(voice, fingerprint);
      }

      // A merge holds this voice at unison for its duration; once it lapses the
      // trail drifts back to its own detune.
      if (fingerprint) {
        const pullUntil = this.mergePullsUntilMs.get(frame.trailIndex);
        if (pullUntil !== undefined && elapsedMs >= pullUntil) {
          this.mergePullsUntilMs.delete(frame.trailIndex);
          this.releaseMergePull(voice, fingerprint);
        }
      }

      // Update instrument if cursor type changed and cursor instruments mode is on
      if (this.config.cursorInstruments && frame.cursorType !== voice.lastCursorType) {
        this.updateVoiceInstrument(voice, instrument);
        voice.lastCursorType = frame.cursorType;
      }

      if (
        frequency !== voice.currentFrequency &&
        elapsedMs - voice.lastNoteTimeMs > MIN_NOTE_INTERVAL_MS
      ) {
        // The first pitch this voice takes from a new palette is its move into
        // the new chord, so it slides rather than snapping. A voice that has
        // already spoken in this palette moves at the ordinary note rate.
        const isVoiceLeadingMove =
          voice.lastPitchScale !== null && voice.lastPitchScale !== scale;
        this.setVoiceFrequency(
          voice,
          frequency,
          isVoiceLeadingMove
            ? VOICE_LEADING_GLIDE_SECONDS
            : NOTE_GLIDE_SECONDS,
        );
        voice.lastPitchScale = scale ?? null;
        voice.lastNoteTimeMs = elapsedMs;
        voice.currentFrequency = frequency;
      }

      // Percussive cursor types (e.g. text) use repeating plucks instead of
      // a sustained tone — like typing rhythm
      const isPercussive = this.config.cursorInstruments &&
        PERCUSSIVE_CURSOR_TYPES.has(frame.cursorType ?? "");
      const shouldUpdateContinuousParams =
        !voice.active ||
        sampleTimeMs - voice.lastControlTimeMs >= VOICE_CONTROL_INTERVAL_MS;

      // Multiplies the existing gain, so the spotlight rides on top of the
      // normal velocity mapping instead of replacing it. Exactly 1 when the
      // spotlight is off, which keeps plain sustained mode bit-for-bit the same.
      const spotlightGain = this.spotlightGainFor(frame.trailIndex);
      // Same idea: exactly 1 when swells are off, so the plain gain path is
      // untouched. Percussive voices are excluded — a pluck is a transient,
      // and there is nothing there to lean into.
      const swellGain = isPercussive
        ? 1
        : this.swellGainFor(frame.trailIndex, elapsedMs, velocity);

      if (this.config.choralTimbre) {
        this.attachFormants(voice);
      } else if (voice.formants) {
        this.detachFormants(voice);
      }

      if (isPercussive) {
        if (elapsedMs - voice.lastPluckMs > PLUCK_REPEAT_INTERVAL_MS) {
          voice.lastPluckMs = elapsedMs;
          const now = this.ctx.currentTime;
          const pluckGain = gain * instrument.gain * spotlightGain;
          // Sharp attack, quick decay — percussive envelope
          this.holdParam(voice.gainNode.gain, now);
          // Hold the current automation value, then ramp up quickly.
          voice.gainNode.gain.linearRampToValueAtTime(pluckGain, now + 0.005);
          voice.gainNode.gain.exponentialRampToValueAtTime(
            0.001,
            now + 0.005 + instrument.attack + instrument.decay + instrument.release,
          );
        }
      } else if (shouldUpdateContinuousParams) {
        this.rampParam(
          voice.gainNode.gain,
          gain * instrument.gain * spotlightGain * swellGain,
          // A swelling voice rides a longer ramp so the crescendo glides
          // rather than advancing as a staircase of control-rate steps.
          this.config.swells
            ? SWELL_TUNING.releaseSeconds / 2
            : VOICE_CONTROL_RAMP_SECONDS,
        );
      }

      if (shouldUpdateContinuousParams) {
        this.rampParam(voice.panNode.pan, pan, VOICE_CONTROL_RAMP_SECONDS);
        if (this.config.choralTimbre) {
          this.updateFormants(voice, velocity);
        }
        // Brightness rides the same throttle as gain and pan. Re-ramping the
        // filter every animation frame restarts a 120ms glide every ~16ms, so
        // the cutoff advances as a staircase of held values rather than a
        // smooth sweep — that stepping is the crackle.
        if (this.config.spotlight) {
          this.applySpotlightBrightness(
            voice,
            frame.trailIndex,
            velocity,
            instrument,
          );
        }
        voice.lastControlTimeMs = sampleTimeMs;
      }

      voice.active = true;
    }

    // Detect trail crossings and sound them in the configured flavor
    if (this.config.crossings !== "off" && activeTrails.length >= 2) {
      this.detectCrossings(elapsedMs, activeTrails);
    }
  }

  /** Detect when an active cursor crosses over another trail's path */
  private detectCrossings(
    elapsedMs: number,
    activeTrails: TrailSoundFrame[],
  ): void {
    if (!this.ctx || !this.masterGain) return;

    // For each active trail, check if its cursor is near any point in another trail's path
    for (const frame of activeTrails) {
      for (const [otherIdx, otherPath] of this.trailPaths) {
        if (otherIdx === frame.trailIndex) continue;
        if (otherPath.length < 2) continue;

        // Check cooldown for this trail-path pair
        const pairKey = `${frame.trailIndex}-path-${otherIdx}`;
        const lastCrossing = this.crossingCooldowns.get(pairKey) ?? 0;
        if (elapsedMs - lastCrossing < CROSSING_COOLDOWN_MS) continue;

        // Check cursor position against sampled path points
        // Sample every 10th point to keep it fast
        let closestDist = Infinity;
        for (let i = 0; i < otherPath.length; i += 10) {
          const pt = otherPath[i];
          const dx = frame.x - pt.x;
          const dy = frame.y - pt.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < closestDist) closestDist = dist;
          if (dist < CROSSING_DISTANCE_THRESHOLD) break;
        }

        if (closestDist >= CROSSING_DISTANCE_THRESHOLD) continue;

        this.crossingCooldowns.set(pairKey, elapsedMs);
        // The crossing happens where the moving cursor is, so that point is
        // both trails' position for the purposes of placing the sound.
        if (this.config.crossings === "merge") {
          this.triggerCrossingMerge(
            elapsedMs,
            frame.trailIndex,
            otherIdx,
            frame.x,
          );
        } else {
          this.triggerCrossingDissonance(
            frame.trailIndex,
            otherIdx,
            frame.x,
            frame.y,
            closestDist,
          );
        }
      }
    }
  }

  /** Trigger a brief dissonant tone at the crossing point */
  private triggerCrossingDissonance(
    trailIndexA: number,
    trailIndexB: number,
    x: number,
    y: number,
    distance: number,
  ): void {
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;

    // Dissonant intervals: minor second (16/15) and tritone (Math.sqrt(2))
    // Pick based on which trails are crossing
    const baseFreq = 220 + (y / (window.innerHeight || 800)) * 440;
    const dissonantRatio = (trailIndexA + trailIndexB) % 2 === 0
      ? 16 / 15  // minor second — tense, close
      : Math.SQRT2; // tritone — unstable, eerie

    const osc1 = this.ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = baseFreq;

    const osc2 = this.ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = baseFreq * dissonantRatio;

    // Closer crossing = louder dissonance
    const proximityGain = 1 - distance / CROSSING_DISTANCE_THRESHOLD;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.06 * proximityGain, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    const pan = this.ctx.createStereoPanner();
    pan.pan.value = positionToPan(x, this.canvasWidth);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(pan);
    pan.connect(this.busFor("crossing"));

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 1.6);
    osc2.stop(now + 1.6);
  }

  /**
   * Sound two trails meeting as recognition rather than friction: their two
   * home chord tones ring together as a consonant dyad, and for the length of
   * that ring their sustained voices are pulled to unison so the pair briefly
   * sounds like one voice before drifting apart again.
   */
  private triggerCrossingMerge(
    elapsedMs: number,
    trailIndexA: number,
    trailIndexB: number,
    x: number,
  ): void {
    if (!this.ctx || !this.masterGain) return;

    const [lower, upper] = this.mergeDyadPitches(trailIndexA, trailIndexB);
    const { dyadGain, attackSeconds, decaySeconds, partialGain } =
      CROSSING_MERGE_TUNING;

    for (const pitch of [lower, upper]) {
      this.triggerFlourishNote(pitch, x, dyadGain, decaySeconds, {
        attackSeconds,
        partialGain,
        layer: "crossing",
      });
    }

    // Without fingerprints there is nothing personal to pull together, so the
    // merge is the dyad alone.
    if (!this.config.trailVoices) return;

    const pullUntil = elapsedMs + CROSSING_MERGE_TUNING.pullDurationMs;
    for (const trailIndex of [trailIndexA, trailIndexB]) {
      const voice = this.voices.get(trailIndex);
      if (!voice) continue;
      this.mergePullsUntilMs.set(trailIndex, pullUntil);
      this.applyMergePull(voice);
    }
  }

  /**
   * The two pitches a merge rings. With fingerprints on these are the trails'
   * own home tones, so a listener hears exactly the two voices that met; two
   * trails sharing a home tone (or fingerprints being off) fall back to root
   * and fifth of the current chord so the dyad is never a bare unison.
   */
  private mergeDyadPitches(
    trailIndexA: number,
    trailIndexB: number,
  ): [number, number] {
    const register = CROSSING_MERGE_TUNING.registerMultiplier;
    const homeA = this.homeToneFor(trailIndexA);
    const homeB = this.homeToneFor(trailIndexB);

    if (this.config.trailVoices && homeA !== null && homeB !== null) {
      if (Math.abs(homeA - homeB) > 0.01) {
        const lower = Math.min(homeA, homeB) * register;
        const upper = Math.max(homeA, homeB) * register;
        return [lower, upper];
      }
      return [homeA * register, homeA * register * 1.5];
    }

    const root = this.currentRoot() * register;
    return [root, root * 1.5];
  }

  /** Hold a voice at unison — no detune, no vibrato — for a merge. */
  private applyMergePull(voice: Voice): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const glideSeconds = CROSSING_MERGE_TUNING.attackSeconds * 10;
    voice.appliedDetuneCents = 0;
    voice.oscillator?.detune.linearRampToValueAtTime(0, now + glideSeconds);
    voice.fifthOscillator?.detune.linearRampToValueAtTime(0, now + glideSeconds);
    if (voice.vibrato) {
      // Depth to zero rather than stopping the LFO: when the pull lapses both
      // voices resume from the same phase, which is what makes them read as
      // having been briefly aligned.
      voice.vibrato.depth.gain.linearRampToValueAtTime(0, now + glideSeconds);
    }
  }

  /** Let a merged voice drift back to its own fingerprint. */
  private releaseMergePull(
    voice: Voice,
    fingerprint: TrailFingerprint,
  ): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Slower than the pull onto unison: coming together is an event, drifting
    // apart is a settling.
    const driftSeconds = 1.2;
    voice.appliedDetuneCents = fingerprint.detuneCents;
    voice.oscillator?.detune.linearRampToValueAtTime(
      fingerprint.detuneCents,
      now + driftSeconds,
    );
    voice.fifthOscillator?.detune.linearRampToValueAtTime(
      fingerprint.detuneCents,
      now + driftSeconds,
    );
    voice.vibrato?.depth.gain.linearRampToValueAtTime(
      fingerprint.vibratoDepthCents,
      now + driftSeconds,
    );
  }

  triggerClick(click: ClickSoundEvent): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;

    const instrument = CLICK_BELL;
    // Delay the bell ~one frame so it lines up with the React paint that
    // renders the matching ripple. Without this, audio (sample-accurate)
    // arrives ~16ms before the SVG circle appears on screen.
    const VISUAL_SYNC_DELAY = 0.016;
    const now = this.ctx.currentTime + VISUAL_SYNC_DELAY;

    const osc = this.ctx.createOscillator();
    osc.type = instrument.oscillatorType;

    const bellScale = this.currentBellScale();
    const pitchRatio = 1 - (click.y / (window.innerHeight || 800));
    const scaleIndex = Math.min(
      bellScale.length - 1,
      Math.floor(pitchRatio * bellScale.length),
    );
    const baseFreq = bellScale[scaleIndex];
    osc.frequency.value = baseFreq;

    const osc2 = this.ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = baseFreq * 3;

    const gain = this.ctx.createGain();
    const holdScale = click.holdDuration
      ? Math.min(3, 1 + click.holdDuration / 1000)
      : 1;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(
      instrument.gain * holdScale,
      now + instrument.attack,
    );
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      now + instrument.attack + instrument.release * holdScale,
    );

    const gain2 = this.ctx.createGain();
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(
      instrument.gain * 0.3 * holdScale,
      now + instrument.attack,
    );
    gain2.gain.exponentialRampToValueAtTime(
      0.001,
      now + instrument.attack + (instrument.release * holdScale) / 2,
    );

    const pan = this.ctx.createStereoPanner();
    pan.pan.value = positionToPan(click.x, this.canvasWidth);

    osc.connect(gain);
    osc2.connect(gain2);
    gain.connect(pan);
    gain2.connect(pan);
    pan.connect(this.busFor("clickBell"));

    osc.start(now);
    osc2.start(now);
    const stopTime = now + instrument.attack + instrument.release * holdScale + 0.1;
    osc.stop(stopTime);
    osc2.stop(stopTime);
  }

  private createVoice(instrument: InstrumentConfig): Voice {
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = instrument.oscillatorType;
    osc.frequency.value = 220;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = instrument.filterFrequency;
    filter.Q.value = instrument.filterQ;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);

    const pan = ctx.createStereoPanner();

    const oscillatorLevel = ctx.createGain();
    oscillatorLevel.gain.setValueAtTime(1, now);
    osc.connect(oscillatorLevel);
    oscillatorLevel.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.busFor("bed"));

    osc.start(now);

    // Create fifth oscillator for chord voicing (always created, gain-gated)
    const fifthOsc = ctx.createOscillator();
    fifthOsc.type = instrument.oscillatorType;
    fifthOsc.frequency.value = 220 * 1.5; // Perfect fifth

    const fifthGain = ctx.createGain();
    fifthGain.gain.setValueAtTime(
      this.config.chordVoicing ? 0.6 : 0,
      now,
    );

    const fifthOscillatorLevel = ctx.createGain();
    fifthOscillatorLevel.gain.setValueAtTime(1, now);
    fifthOsc.connect(fifthOscillatorLevel);
    fifthOscillatorLevel.connect(fifthGain);
    fifthGain.connect(filter);
    fifthOsc.start(now);

    return {
      oscillator: osc,
      oscillatorLevel,
      fifthOscillator: fifthOsc,
      fifthOscillatorLevel,
      gainNode: gain,
      fifthGainNode: fifthGain,
      filterNode: filter,
      panNode: pan,
      currentFrequency: 0,
      lastNoteTimeMs: 0,
      lastCursorType: undefined,
      lastPluckMs: 0,
      lastControlTimeMs: Number.NEGATIVE_INFINITY,
      spotlightBrightened: false,
      vibrato: null,
      formants: null,
      appliedDetuneCents: 0,
      lastPitchScale: null,
      active: false,
    };
  }

  /**
   * The identity a trail's fingerprint is hashed from. `identityKey` is a
   * participant-scoped id and is by far the most stable thing available — trail
   * indices are positions in a re-derived array and shuffle as the data window
   * slides. Colour plus index is the fallback: colour alone collides across
   * participants sharing a palette entry, and index alone is unstable.
   */
  private identityKeyFor(frame: TrailSoundFrame): string {
    return frame.identityKey ?? `${frame.color}#${frame.trailIndex}`;
  }

  /**
   * This trail's fingerprint, derived on first sight and re-derived if its
   * identity key ever changes underneath the same index.
   */
  private fingerprintFor(frame: TrailSoundFrame): TrailFingerprint {
    const key = this.identityKeyFor(frame);
    const existing = this.fingerprints.get(frame.trailIndex);
    if (existing && this.fingerprintKeys.get(frame.trailIndex) === key) {
      return existing;
    }

    const hash = hashIdentity(key);
    const {
      maxDetuneCents,
      vibratoMinRateHz,
      vibratoMaxRateHz,
      maxVibratoDepthCents,
      minAttackScale,
      maxAttackScale,
    } = TRAIL_VOICE_TUNING;
    const scale = this.flourishPalette();
    const fingerprint: TrailFingerprint = {
      hash,
      // A brand-new trail takes its seat from its identity; only trails already
      // sounding are led from where they are.
      homeTone: homeToneForHash(hash, scale),
      homeToneScale: scale,
      detuneCents: (hashUnit(hash, DETUNE_SALT) * 2 - 1) * maxDetuneCents,
      vibratoRateHz:
        vibratoMinRateHz +
        hashUnit(hash, VIBRATO_RATE_SALT) * (vibratoMaxRateHz - vibratoMinRateHz),
      vibratoDepthCents:
        hashUnit(hash, VIBRATO_DEPTH_SALT) * maxVibratoDepthCents,
      attackScale:
        minAttackScale +
        hashUnit(hash, ATTACK_SALT) * (maxAttackScale - minAttackScale),
    };
    this.fingerprints.set(frame.trailIndex, fingerprint);
    this.fingerprintKeys.set(frame.trailIndex, key);
    return fingerprint;
  }

  /** The chord tone this trail calls home in the palette currently in force. */
  private homeToneFor(trailIndex: number): number | null {
    const fingerprint = this.fingerprints.get(trailIndex);
    if (!fingerprint) return null;
    return this.resolveHomeTone(fingerprint);
  }

  /**
   * This trail's home tone in the palette currently in force, leading it onto
   * the nearest tone of a new palette when the progression has turned. Called
   * from the read paths rather than from `updateChord`, so a trail that was not
   * sounding across a rotation still resolves correctly the moment it returns.
   */
  private resolveHomeTone(fingerprint: TrailFingerprint): number {
    const scale = this.flourishPalette();
    if (fingerprint.homeToneScale === scale) return fingerprint.homeTone;
    fingerprint.homeTone = leadHomeTone(fingerprint.homeTone, scale);
    fingerprint.homeToneScale = scale;
    return fingerprint.homeTone;
  }

  /**
   * Bias a direction-derived pitch toward the trail's home tone. The choice is
   * deterministic in the pitch being replaced rather than random, so a trail
   * held on one heading does not flicker between two notes.
   */
  private applyHomeToneBias(
    frequency: number,
    fingerprint: TrailFingerprint,
  ): number {
    const home = this.resolveHomeTone(fingerprint);
    const roll = hashUnit(fingerprint.hash ^ Math.round(frequency * 100), 7);
    return roll < TRAIL_VOICE_TUNING.homeToneBias ? home : frequency;
  }

  /**
   * Give a voice its fingerprint: a fixed detune and a personal vibrato LFO on
   * the oscillator frequency. Passing no fingerprint strips both.
   */
  private applyFingerprintToVoice(
    voice: Voice,
    fingerprint: TrailFingerprint | undefined,
  ): void {
    if (!this.ctx || !voice.oscillator) return;
    if (!fingerprint) {
      this.clearFingerprintFromVoice(voice);
      return;
    }

    this.setVoiceDetune(voice, fingerprint.detuneCents);

    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (!voice.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      const depth = ctx.createGain();
      // The LFO drives detune rather than frequency, so its depth is in cents
      // and stays musically constant as the voice changes pitch.
      lfo.connect(depth);
      depth.connect(voice.oscillator.detune);
      lfo.start(now);
      voice.vibrato = { oscillator: lfo, depth };
    }
    voice.vibrato.oscillator.frequency.setValueAtTime(
      fingerprint.vibratoRateHz,
      now,
    );
    voice.vibrato.depth.gain.setValueAtTime(fingerprint.vibratoDepthCents, now);
  }

  /** Return a voice to the shared, unfingerprinted timbre. */
  private clearFingerprintFromVoice(voice: Voice): void {
    if (!this.ctx) return;
    this.setVoiceDetune(voice, 0);
    this.stopVibrato(voice);
  }

  /** Stop and detach a voice's vibrato LFO, if it has one. */
  private stopVibrato(voice: Voice): void {
    if (!voice.vibrato) return;
    try {
      voice.vibrato.oscillator.stop(
        this.ctx ? this.ctx.currentTime + 0.02 : undefined,
      );
    } catch {
      /* already stopped */
    }
    try {
      voice.vibrato.oscillator.disconnect();
      voice.vibrato.depth.disconnect();
    } catch {
      /* already disconnected */
    }
    voice.vibrato = null;
  }

  /** Set the fixed pitch offset on both of a voice's oscillators. */
  private setVoiceDetune(voice: Voice, cents: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    voice.appliedDetuneCents = cents;
    voice.oscillator?.detune.setValueAtTime(cents, now);
    voice.fifthOscillator?.detune.setValueAtTime(cents, now);
  }

  /**
   * Tap a voice's filtered tone into a bank of parallel bandpass formants and
   * mix them back in beside it. Two extra filters plus one gain per voice, and
   * only while the choral timbre is on.
   */
  private attachFormants(voice: Voice): void {
    if (!this.ctx || voice.formants) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const mix = ctx.createGain();
    mix.gain.setValueAtTime(CHORAL_TUNING.formantMix, now);

    const filters = CHORAL_TUNING.closedFormantsHz.map((hz) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(hz, now);
      filter.Q.setValueAtTime(CHORAL_TUNING.formantQ, now);
      // Tapped off the voice's own lowpass so the formants sing the same tone
      // the voice is already making, then summed back into its gain stage.
      voice.filterNode.connect(filter);
      filter.connect(mix);
      return filter;
    });

    mix.connect(voice.gainNode);
    voice.formants = { filters, mix, lastOpenness: 0 };
  }

  /** Remove a voice's formant bank, returning it to its plain lowpass tone. */
  private detachFormants(voice: Voice): void {
    if (!voice.formants) return;
    try {
      for (const filter of voice.formants.filters) filter.disconnect();
      voice.formants.mix.disconnect();
    } catch {
      /* already disconnected */
    }
    voice.formants = null;
  }

  /**
   * Morph a voice's vowel with its speed: closed and dark when slow, open and
   * bright when fast. Called on the same throttle as gain and pan, and skipped
   * entirely when the vowel has not meaningfully moved — re-ramping an
   * unchanged target every frame is what turns a morph into zipper noise.
   */
  private updateFormants(voice: Voice, velocity: number): void {
    if (!this.ctx || !voice.formants) return;

    const openness = Math.min(
      1,
      Math.max(0, velocity / CHORAL_TUNING.fullOpenVelocity),
    );
    if (Math.abs(openness - voice.formants.lastOpenness) < 0.02) return;
    voice.formants.lastOpenness = openness;

    const { closedFormantsHz, openFormantsHz, morphSeconds } = CHORAL_TUNING;
    voice.formants.filters.forEach((filter, i) => {
      const closed = closedFormantsHz[i];
      const open = openFormantsHz[i];
      this.rampParam(filter.frequency, closed + (open - closed) * openness, morphSeconds);
    });
  }

  /** Enable the fifth oscillator on an existing voice */
  private enableFifth(voice: Voice): void {
    if (!this.ctx || !voice.fifthGainNode) return;
    voice.fifthGainNode.gain.linearRampToValueAtTime(
      0.6,
      this.ctx.currentTime + 0.3,
    );
  }

  /** Disable the fifth oscillator on an existing voice */
  private disableFifth(voice: Voice): void {
    if (!this.ctx || !voice.fifthGainNode) return;
    voice.fifthGainNode.gain.linearRampToValueAtTime(
      0,
      this.ctx.currentTime + 0.3,
    );
  }

  private setVoiceFrequency(
    voice: Voice,
    frequency: number,
    glideSeconds: number = NOTE_GLIDE_SECONDS,
  ): void {
    if (!this.ctx) return;
    if (voice.oscillator) {
      voice.oscillator.frequency.exponentialRampToValueAtTime(
        frequency,
        this.ctx.currentTime + glideSeconds,
      );
    }
    if (voice.fifthOscillator) {
      voice.fifthOscillator.frequency.exponentialRampToValueAtTime(
        frequency * 1.5, // Perfect fifth
        this.ctx.currentTime + glideSeconds,
      );
    }
  }

  private updateVoiceInstrument(
    voice: Voice,
    instrument: InstrumentConfig,
  ): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    voice.filterNode.frequency.linearRampToValueAtTime(
      instrument.filterFrequency,
      now + 0.1,
    );
    voice.filterNode.Q.linearRampToValueAtTime(instrument.filterQ, now + 0.1);

    if (
      voice.oscillator &&
      voice.oscillatorLevel &&
      voice.oscillator.type !== instrument.oscillatorType
    ) {
      const primary = this.crossfadeOscillator(
        voice.oscillator,
        voice.oscillatorLevel,
        voice.filterNode,
        instrument.oscillatorType,
        voice.currentFrequency || 220,
      );
      voice.oscillator = primary.oscillator;
      voice.oscillatorLevel = primary.level;

      if (
        voice.fifthOscillator &&
        voice.fifthOscillatorLevel &&
        voice.fifthGainNode
      ) {
        const fifth = this.crossfadeOscillator(
          voice.fifthOscillator,
          voice.fifthOscillatorLevel,
          voice.fifthGainNode,
          instrument.oscillatorType,
          (voice.currentFrequency || 220) * 1.5,
        );
        voice.fifthOscillator = fifth.oscillator;
        voice.fifthOscillatorLevel = fifth.level;
      }

      // The crossfade builds fresh oscillators, so the detune offset and the
      // vibrato LFO's destination both belong to nodes that no longer exist.
      // Re-attaching here is what keeps a trail's voice its own across a
      // cursor-type change.
      if (voice.appliedDetuneCents !== 0 || voice.vibrato) {
        const now = this.ctx.currentTime;
        voice.oscillator?.detune.setValueAtTime(voice.appliedDetuneCents, now);
        voice.fifthOscillator?.detune.setValueAtTime(
          voice.appliedDetuneCents,
          now,
        );
        if (voice.vibrato && voice.oscillator) {
          voice.vibrato.depth.disconnect();
          voice.vibrato.depth.connect(voice.oscillator.detune);
        }
      }
    }
  }

  private crossfadeOscillator(
    oscillator: OscillatorNode,
    level: GainNode,
    destination: AudioNode,
    oscillatorType: OscillatorType,
    frequency: number,
  ): { oscillator: OscillatorNode; level: GainNode } {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const currentOscillator = ctx.createOscillator();
    const currentLevel = ctx.createGain();

    currentOscillator.type = oscillatorType;
    currentOscillator.frequency.value = frequency;
    currentLevel.gain.setValueAtTime(0, now);
    currentOscillator.connect(currentLevel);
    currentLevel.connect(destination);
    currentOscillator.start(now);

    this.holdParam(level.gain, now);
    level.gain.linearRampToValueAtTime(
      0,
      now + OSCILLATOR_CROSSFADE_SECONDS,
    );
    currentLevel.gain.linearRampToValueAtTime(
      1,
      now + OSCILLATOR_CROSSFADE_SECONDS,
    );
    oscillator.onended = () => level.disconnect();
    oscillator.stop(now + OSCILLATOR_CROSSFADE_SECONDS);

    return { oscillator: currentOscillator, level: currentLevel };
  }

  /** Release every sustained voice, e.g. when handing off to notes mode. */
  private releaseAllVoices(): void {
    for (const [, voice] of this.voices) {
      if (voice.active || voice.oscillator) this.releaseVoice(voice);
    }
  }

  private fadeVoice(voice: Voice, duration: number): void {
    if (!this.ctx) return;
    voice.gainNode.gain.linearRampToValueAtTime(
      0,
      this.ctx.currentTime + duration,
    );
    voice.active = false;
  }

  private releaseVoice(voice: Voice): void {
    if (!this.ctx) return;
    this.rampParam(voice.gainNode.gain, 0, 0.5);
    voice.active = false;
  }

  /** Permanently remove a trail's audio graph and cached motion state. */
  retireTrail(trailIndex: number): void {
    this.notesEngine.retireTrail(trailIndex);
    // Only a trail that announced itself gets a departure, so a trail retired
    // during a suppressed batch does not leave without ever having arrived.
    if (
      this.config.trailArrivals &&
      this.lastTickMs >= this.arrivalsSuppressedUntilMs &&
      this.arrivalTimesMs.has(trailIndex)
    ) {
      const position = this.prevPositions.get(trailIndex);
      // Departure reuses the arrival's seed, so a trail leaves in the same
      // voice it arrived in.
      this.triggerArrivalFigure(
        position?.x ?? this.canvasWidth / 2,
        false,
        this.arrivalSeeds.get(trailIndex) ?? hashIdentity(String(trailIndex)),
      );
    }
    this.arrivalTimesMs.delete(trailIndex);
    this.arrivalSeeds.delete(trailIndex);
    const voice = this.voices.get(trailIndex);
    if (voice) {
      const disconnect = () => this.disconnectVoice(voice);
      let disconnectWhenStopped = false;
      if (this.ctx && voice.oscillator) {
        const now = this.ctx.currentTime;
        this.holdParam(voice.gainNode.gain, now);
        voice.gainNode.gain.linearRampToValueAtTime(0, now + 0.03);
        voice.oscillator.onended = disconnect;
        try {
          voice.oscillator.stop(now + 0.04);
          disconnectWhenStopped = true;
        } catch { /* already stopped */ }
      }
      if (voice.oscillator) {
        voice.oscillator = null;
      }
      if (voice.fifthOscillator) {
        try {
          voice.fifthOscillator.stop(
            this.ctx ? this.ctx.currentTime + 0.04 : undefined,
          );
        } catch { /* already stopped */ }
        voice.fifthOscillator = null;
      }
      if (!disconnectWhenStopped) {
        disconnect();
      }
      this.voices.delete(trailIndex);
    }
    this.prevPositions.delete(trailIndex);
    this.prevSampleTimesMs.delete(trailIndex);
    this.trailPaths.delete(trailIndex);
    this.fingerprints.delete(trailIndex);
    this.fingerprintKeys.delete(trailIndex);
    this.mergePullsUntilMs.delete(trailIndex);
    this.swells.delete(trailIndex);
    this.spotlightGains.delete(trailIndex);
    this.spotlightVelocitySamples.delete(trailIndex);
    this.spotlightSmoothedVelocities.delete(trailIndex);
    if (this.spotlightTrailIndex === trailIndex) {
      this.spotlightTrailIndex = null;
      // No resolving note: the trail is gone rather than slowing, so there is
      // nothing left for the phrase to resolve on.
      this.flourish = null;
    }
    for (const key of this.crossingCooldowns.keys()) {
      if (
        key.startsWith(`${trailIndex}-path-`) ||
        key.endsWith(`-path-${trailIndex}`)
      ) {
        this.crossingCooldowns.delete(key);
      }
    }
  }

  /**
   * Advance the energy follower from this frame's total scene motion. Energy
   * is a leaky integral, so a burst of activity swells the mix over seconds
   * and a lull drains it back down rather than cutting out.
   */
  private updateEnergy(
    elapsedMs: number,
    activeTrails: TrailSoundFrame[],
  ): void {
    if (!this.config.energyArc) {
      this.energy = 0;
      this.lastEnergyTickMs = null;
      return;
    }

    const deltaMs =
      this.lastEnergyTickMs === null
        ? FRAME_MS
        : Math.max(0, Math.min(500, elapsedMs - this.lastEnergyTickMs));
    this.lastEnergyTickMs = elapsedMs;

    let motion = 0;
    for (const frame of activeTrails) {
      const prev = this.prevPositions.get(frame.trailIndex);
      if (!prev) continue;
      motion += computeVelocity(prev.x, prev.y, frame.x, frame.y);
    }

    const target = Math.min(1, motion / ENERGY_TUNING.fullScaleMotion);
    const rate = Math.min(1, deltaMs / ENERGY_TUNING.timeConstantMs);
    this.energy += (target - this.energy) * rate;
  }

  /**
   * Master multiplier from current energy. Above the lull threshold this is a
   * gentle swell; below it the mix drains toward near-silence so the next
   * burst of activity arrives against an empty canvas.
   */
  private energyGainScale(): number {
    if (!this.config.energyArc) return 1;
    const { minGain, maxGain, lullThreshold, lullFloorGain } = ENERGY_TUNING;
    if (this.energy <= lullThreshold) {
      const t = lullThreshold > 0 ? this.energy / lullThreshold : 0;
      return lullFloorGain + (minGain - lullFloorGain) * t;
    }
    const t = (this.energy - lullThreshold) / (1 - lullThreshold);
    return minGain + (maxGain - minGain) * t;
  }

  /** Reverb send follows energy: drier when quiet, lusher as activity builds. */
  private updateEnergyReverb(): void {
    if (!this.reverbGain || !this.config.energyArc) return;
    const { minReverb, maxReverb } = ENERGY_TUNING;
    const target = minReverb + (maxReverb - minReverb) * this.energy;
    // Re-ramping every frame would restart the glide before it ever arrived,
    // pinning the value near its start. Only schedule on a real move; the
    // energy follower is already slow, so this stays smooth.
    if (Math.abs(target - this.lastReverbTarget) < 0.01) return;
    this.lastReverbTarget = target;
    this.rampParam(this.reverbGain.gain, target, 0.5);
  }

  /**
   * Advance the chord progression. Dwell time shortens as energy rises when
   * the energy arc is also on, so a busy scene moves harmonically faster.
   */
  private updateChord(elapsedMs: number): void {
    if (!this.config.chordRotation) {
      this.chordIndex = 0;
      this.chordStartedMs = elapsedMs;
      return;
    }

    let dwell = CHORD_DWELL_MS;
    if (this.config.energyArc) {
      const { dwellAtLowEnergy, dwellAtHighEnergy } = ENERGY_TUNING;
      dwell *=
        dwellAtLowEnergy + (dwellAtHighEnergy - dwellAtLowEnergy) * this.energy;
    }

    if (elapsedMs - this.chordStartedMs >= dwell) {
      this.chordIndex = (this.chordIndex + 1) % CHORD_PROGRESSION.length;
      this.chordStartedMs = elapsedMs;
    }
  }

  /** The pitch palette for this frame — the base scale unless rotating. */
  private currentScale(): number[] | undefined {
    if (!this.config.chordRotation) return undefined;
    return scaleForChord(CHORD_PROGRESSION[this.chordIndex]);
  }

  /**
   * Pitch set for click bells. While the progression rotates, bells draw from
   * the current chord's upper register so a click always lands consonant with
   * whatever the sustained voices are holding. With rotation off the bells
   * keep their original fixed D minor ring.
   */
  private currentBellScale(): number[] {
    if (!this.config.chordRotation) return FIXED_BELL_SCALE;
    return bellScaleForChord(CHORD_PROGRESSION[this.chordIndex]);
  }

  /** Name of the chord currently in force (diagnostics). */
  getCurrentChordName(): string {
    return this.config.chordRotation
      ? CHORD_PROGRESSION[this.chordIndex].name
      : "Dm";
  }

  /** Current 0-1 scene energy (diagnostics). */
  getEnergy(): number {
    return this.energy;
  }

  /**
   * The chord tone a trail is currently biased toward, or null when it has no
   * fingerprint (diagnostics, and how the TrailPad labels each trail).
   */
  getHomeTone(trailIndex: number): number | null {
    if (!this.config.trailVoices) return null;
    return this.homeToneFor(trailIndex);
  }

  /**
   * Pick this frame's soloist: the fastest trail that is both a clear outlier
   * against the rolling scene average and above an absolute floor. Runs only
   * while the spotlight is on; otherwise all spotlight state is cleared so
   * turning it back on starts from a neutral scene.
   */
  private updateSpotlight(
    elapsedMs: number,
    activeTrails: TrailSoundFrame[],
  ): void {
    if (!this.config.spotlight) {
      if (this.spotlightTrailIndex !== null || this.spotlightGains.size > 0) {
        this.spotlightTrailIndex = null;
        this.spotlightSceneAverage = 0;
        this.spotlightVelocitySamples.clear();
        this.spotlightSmoothedVelocities.clear();
        this.spotlightGains.clear();
        this.clearFlourish();
      }
      return;
    }

    const cutoff = elapsedMs - SPOTLIGHT_TUNING.velocityWindowMs;

    let soloistIndex: number | null = null;
    let soloistVelocity = 0;
    const present = new Set<number>();
    for (const frame of activeTrails) {
      const prev = this.prevPositions.get(frame.trailIndex);
      // A trail with no previous position has no measurable velocity yet; it
      // is sampled next frame rather than counted as still.
      if (!prev) continue;
      present.add(frame.trailIndex);
      const velocity = computeVelocity(prev.x, prev.y, frame.x, frame.y);
      let samples = this.spotlightVelocitySamples.get(frame.trailIndex);
      if (!samples) {
        samples = [];
        this.spotlightVelocitySamples.set(frame.trailIndex, samples);
      }
      samples.push([elapsedMs, velocity]);

      const previousSmoothed = this.spotlightSmoothedVelocities.get(
        frame.trailIndex,
      );
      const rate = Math.min(
        1,
        FRAME_MS / SPOTLIGHT_TUNING.velocitySmoothingMs,
      );
      const smoothed =
        previousSmoothed === undefined
          ? velocity
          : previousSmoothed + (velocity - previousSmoothed) * rate;
      this.spotlightSmoothedVelocities.set(frame.trailIndex, smoothed);

      if (smoothed > soloistVelocity) {
        soloistIndex = frame.trailIndex;
        soloistVelocity = smoothed;
      }
    }
    for (const index of this.spotlightSmoothedVelocities.keys()) {
      if (!present.has(index)) this.spotlightSmoothedVelocities.delete(index);
    }

    for (const [index, samples] of this.spotlightVelocitySamples) {
      let dropCount = 0;
      while (dropCount < samples.length && samples[dropCount][0] < cutoff) {
        dropCount++;
      }
      if (dropCount > 0) samples.splice(0, dropCount);
      if (samples.length === 0) this.spotlightVelocitySamples.delete(index);
    }

    this.spotlightSceneAverage =
      this.velocityAverageExcluding(soloistIndex) ?? 0;

    // Promotion and demotion run off different thresholds, and an incumbent is
    // additionally held for a minimum duration. Judging both directions on one
    // instantaneous test makes a normal sweep flap several times a second.
    const current = this.spotlightTrailIndex;
    const clears = (
      candidate: number,
      velocity: number,
      ratio: number,
      floor: number,
    ) => {
      if (velocity < floor) return false;
      const rest = this.velocityAverageExcluding(candidate);
      // With no other trail to compare against, clearing the absolute floor is
      // enough: a single fast mover is by definition the scene's outlier.
      return rest === null || velocity > rest * ratio;
    };

    let nextSoloist: number | null;
    if (current !== null) {
      const incumbentVelocity =
        this.spotlightSmoothedVelocities.get(current) ?? 0;
      const heldLongEnough =
        elapsedMs - this.spotlightPromotedAtMs >=
        SPOTLIGHT_TUNING.minSoloDurationMs;
      const stillQualifies = clears(
        current,
        incumbentVelocity,
        SPOTLIGHT_TUNING.demoteVelocityRatio,
        SPOTLIGHT_TUNING.demoteMinVelocity,
      );
      // The incumbent keeps the spotlight until it has both held it long
      // enough and genuinely fallen off, so the flourish always gets a phrase.
      nextSoloist =
        heldLongEnough && !stillQualifies
          ? soloistIndex !== null &&
            soloistIndex !== current &&
            clears(
              soloistIndex,
              soloistVelocity,
              SPOTLIGHT_TUNING.velocityRatio,
              SPOTLIGHT_TUNING.minVelocity,
            )
            ? soloistIndex
            : null
          : current;
    } else {
      nextSoloist =
        soloistIndex !== null &&
        clears(
          soloistIndex,
          soloistVelocity,
          SPOTLIGHT_TUNING.velocityRatio,
          SPOTLIGHT_TUNING.minVelocity,
        )
          ? soloistIndex
          : null;
    }

    if (nextSoloist !== current) {
      this.handleSoloistChange(current, nextSoloist, elapsedMs);
      if (nextSoloist !== null) this.spotlightPromotedAtMs = elapsedMs;
    }
    this.spotlightTrailIndex = nextSoloist;

    // Advance smoothing for every active trail, including ones too slow to
    // voice this frame. Doing it lazily in the voice loop would freeze a
    // stopped trail at its last multiplier and resurrect a stale boost when
    // it moves again.
    for (const frame of activeTrails) {
      this.advanceSpotlightGain(frame.trailIndex);
    }
    for (const index of this.spotlightGains.keys()) {
      if (!activeTrails.some((f) => f.trailIndex === index)) {
        this.spotlightGains.delete(index);
      }
    }
  }

  /**
   * Rolling velocity average of every trail except `candidate`. A candidate is
   * judged against the rest of the scene, not against a pool that includes
   * itself — pooling makes the bar rise with the very speed being measured, so
   * a lone fast cursor could never clear the ratio. Null when the candidate is
   * the only trail with samples.
   */
  private velocityAverageExcluding(candidate: number | null): number | null {
    let sum = 0;
    let count = 0;
    for (const [index, samples] of this.spotlightVelocitySamples) {
      if (index === candidate) continue;
      for (const [, velocity] of samples) {
        sum += velocity;
        count++;
      }
    }
    return count > 0 ? sum / count : null;
  }

  /** Step one trail's spotlight multiplier toward its target for this frame. */
  private advanceSpotlightGain(trailIndex: number): number {
    const hasSoloist = this.spotlightTrailIndex !== null;
    const isSoloist = this.spotlightTrailIndex === trailIndex;
    const target = !hasSoloist
      ? 1
      : isSoloist
        ? // The soloist's sustained voice steps back while it flourishes, so
          // the discrete notes carry the promotion instead of competing with a
          // louder drone from the same trail.
          SPOTLIGHT_TUNING.soloistGain * FLOURISH_TUNING.sustainedDuck
        : SPOTLIGHT_TUNING.duckedGain;

    const current = this.spotlightGains.get(trailIndex) ?? 1;
    // Ducking engages faster than it recovers, so the soloist reads clearly
    // but the scene does not pump back up the instant they slow. A demoted
    // soloist gets its own, slower walk back so the drone swells in behind
    // the resolving note rather than snapping back.
    const durationSeconds =
      target < current
        ? SPOTLIGHT_TUNING.attackSeconds
        : isSoloist || target === 1
          ? Math.max(
              SPOTLIGHT_TUNING.releaseSeconds,
              FLOURISH_TUNING.sustainedRecoverySeconds,
            )
          : SPOTLIGHT_TUNING.releaseSeconds;
    const rate = Math.min(1, FRAME_MS / (durationSeconds * 1000));
    const next = current + (target - current) * rate;
    this.spotlightGains.set(trailIndex, next);
    return next;
  }

  /**
   * This frame's smoothed gain multiplier for a trail, already advanced by
   * `updateSpotlight`. Exactly 1 when the spotlight is off.
   */
  private spotlightGainFor(trailIndex: number): number {
    if (!this.config.spotlight) return 1;
    return this.spotlightGains.get(trailIndex) ?? 1;
  }

  /**
   * Advance one trail's crescendo and return its gain multiplier for this
   * frame. Sustained motion leans in over seconds; stopping falls away over a
   * slower release than the plain velocity mapping would give. Exactly 1 when
   * swells are off, which leaves the unswelled gain path untouched.
   */
  private swellGainFor(
    trailIndex: number,
    elapsedMs: number,
    velocity: number,
  ): number {
    if (!this.config.swells) return 1;

    const {
      onsetMs,
      crescendoSeconds,
      peakScale,
      releaseSeconds,
      movingVelocity,
      motionGraceMs,
    } = SWELL_TUNING;

    let state = this.swells.get(trailIndex);
    if (!state) {
      state = { movingSinceMs: null, lastMovingMs: elapsedMs, progress: 0 };
      this.swells.set(trailIndex, state);
    }

    if (velocity >= movingVelocity) {
      // A gap shorter than the grace window is treated as continuous motion,
      // so the ordinary stutter of a real cursor does not reset the swell.
      if (
        state.movingSinceMs === null ||
        elapsedMs - state.lastMovingMs > motionGraceMs
      ) {
        state.movingSinceMs = elapsedMs;
      }
      state.lastMovingMs = elapsedMs;
    } else if (elapsedMs - state.lastMovingMs > motionGraceMs) {
      state.movingSinceMs = null;
    }

    const sustained =
      state.movingSinceMs !== null &&
      elapsedMs - state.movingSinceMs >= onsetMs;
    const target = sustained ? 1 : 0;
    // Rising and falling use their own durations: leaning in is slower than
    // the release, so a trail that stops does not hang at full swell.
    const durationSeconds = sustained ? crescendoSeconds : releaseSeconds;
    const rate = Math.min(1, FRAME_MS / (durationSeconds * 1000));
    state.progress += (target - state.progress) * rate;

    // Ease-in on the way up so the lean is felt as a build rather than as a
    // linear fade; the release rides the same curve back down.
    const eased = state.progress * state.progress;
    return 1 + (peakScale - 1) * eased;
  }

  /**
   * The ensemble breath: one slow sine over the whole bed, so even a static
   * busy scene rises and falls. Runs off the audio clock rather than the tick,
   * so it keeps its period regardless of frame pacing.
   */
  private breathGainScale(): number {
    if (!this.config.swells || !this.ctx) return 1;
    const { breathPeriodSeconds, breathDepth } = SWELL_TUNING;
    const phase =
      (this.ctx.currentTime / breathPeriodSeconds) * 2 * Math.PI;
    return 1 + breathDepth * Math.sin(phase);
  }

  /**
   * Open the soloist's filter with velocity. Non-soloists are left entirely
   * alone on their instrument's own cutoff — touching every voice's filter is
   * what turns the spotlight into a blanket muffle over the whole scene, and
   * re-ramping an unchanged target every frame is audible as zipper noise.
   * A demoted soloist gets exactly one ramp back to its instrument default.
   */
  private applySpotlightBrightness(
    voice: Voice,
    trailIndex: number,
    velocity: number,
    instrument: InstrumentConfig,
  ): void {
    if (!this.ctx) return;

    const isSoloist = this.spotlightTrailIndex === trailIndex;

    if (!isSoloist) {
      if (voice.spotlightBrightened) {
        voice.spotlightBrightened = false;
        this.rampParam(
          voice.filterNode.frequency,
          instrument.filterFrequency,
          SPOTLIGHT_TUNING.releaseSeconds,
        );
      }
      return;
    }

    const normalized = Math.min(
      1,
      velocity / SPOTLIGHT_TUNING.filterFullVelocity,
    );
    const target = Math.max(
      instrument.filterFrequency,
      SPOTLIGHT_TUNING.filterMinHz +
        Math.pow(normalized, 0.6) *
          (SPOTLIGHT_TUNING.filterMaxHz - SPOTLIGHT_TUNING.filterMinHz),
    );

    voice.spotlightBrightened = true;
    this.rampParam(
      voice.filterNode.frequency,
      target,
      SPOTLIGHT_TUNING.filterRampSeconds,
    );
  }

  /**
   * Handle the spotlight passing from one trail to another. The outgoing
   * soloist resolves on the chord root; the incoming one starts a fresh
   * flourish, silent until the anticipation gap has elapsed.
   */
  private handleSoloistChange(
    previous: number | null,
    next: number | null,
    elapsedMs: number,
  ): void {
    if (previous !== null) {
      this.triggerResolvingNote(previous);
    }
    this.flourish =
      next === null
        ? null
        : {
            promotedAtMs: elapsedMs,
            distanceSinceNote: 0,
            lastNoteTimeMs: Number.NEGATIVE_INFINITY,
            paletteStep: 0,
          };
  }

  /** Palette flourish notes are drawn from this frame. */
  private flourishPalette(): number[] {
    return this.currentScale() ?? D_MINOR_PENTATONIC;
  }

  /** The chord root this frame — the pitch every accent instrument sits on. */
  private currentRoot(): number {
    return this.flourishPalette()[0];
  }

  /**
   * Sound an arrival for each trail entering the scene. A trail counts as
   * arriving the first time its index is seen, or when it reappears after the
   * debounce, so a trail flickering across the active-set boundary stays
   * silent.
   */
  private updateArrivals(
    elapsedMs: number,
    activeTrails: TrailSoundFrame[],
  ): void {
    if (!this.config.trailArrivals) {
      if (this.arrivalTimesMs.size > 0) this.arrivalTimesMs.clear();
      this.arrivalSeeds.clear();
      this.recentArrivalsMs.length = 0;
      return;
    }
    if (elapsedMs < this.arrivalsSuppressedUntilMs) return;

    for (const frame of activeTrails) {
      const lastArrival = this.arrivalTimesMs.get(frame.trailIndex);
      if (
        lastArrival !== undefined &&
        elapsedMs - lastArrival < ARRIVAL_TUNING.perTrailDebounceMs
      ) {
        continue;
      }
      // A trail already known and outside its debounce is only arriving if it
      // says so; otherwise it is simply still here.
      if (lastArrival !== undefined && !frame.isNewlyActive) continue;

      this.arrivalTimesMs.set(frame.trailIndex, elapsedMs);
      if (!this.claimArrivalSlot(elapsedMs)) continue;
      // Seeded from the trail's own identity, so a participant's chime is
      // recognisably theirs every time they appear.
      this.arrivalSeeds.set(
        frame.trailIndex,
        hashIdentity(this.identityKeyFor(frame)),
      );
      this.triggerArrivalFigure(
        frame.x,
        true,
        this.arrivalSeeds.get(frame.trailIndex)!,
      );
    }
  }

  /**
   * Take one slot from the global arrival budget, or report that the budget is
   * spent. A day swap makes dozens of trails appear on one frame; letting them
   * all sound turns an arrival into a volley.
   */
  private claimArrivalSlot(elapsedMs: number): boolean {
    const windowStart = elapsedMs - 1000;
    while (
      this.recentArrivalsMs.length > 0 &&
      this.recentArrivalsMs[0] < windowStart
    ) {
      this.recentArrivalsMs.shift();
    }
    if (this.recentArrivalsMs.length >= ARRIVAL_TUNING.maxPerSecond) {
      return false;
    }
    this.recentArrivalsMs.push(elapsedMs);
    return true;
  }

  /**
   * A door-chime cluster from the top of the current palette: a scatter of
   * quick high notes for an arrival, a shorter falling one for a departure.
   * The pattern is drawn from `seed`, so the same trail chimes the same way
   * every time it appears while different trails sound distinct.
   */
  private triggerArrivalFigure(x: number, rising: boolean, seed: number): void {
    if (!this.ctx) return;

    const {
      registerMultiplier,
      minNotes,
      maxNotes,
      minSpacingSeconds,
      maxSpacingSeconds,
      noteGain,
      partialGain,
      attackSeconds,
      minDecaySeconds,
      maxDecaySeconds,
      detuneCents,
      paletteTopCount,
      departureGainScale,
      departureNotes,
      departureDecaySeconds,
    } = ARRIVAL_TUNING;

    // The top of the palette, so the chime rings above the sustained bed
    // while staying inside whatever harmony is in force.
    const palette = [...this.flourishPalette()].sort((a, b) => a - b);
    const top = palette.slice(-paletteTopCount);

    const noteCount = rising
      ? minNotes + Math.floor(hashUnit(seed, 11) * (maxNotes - minNotes + 1))
      : departureNotes;

    // A departure falls: the highest tones first, descending. An arrival
    // scatters, which is what makes a chime read as a chime rather than a run.
    const pitches: number[] = [];
    for (let i = 0; i < noteCount; i++) {
      const index = rising
        ? Math.floor(hashUnit(seed, 20 + i) * top.length)
        : top.length - 1 - (i % top.length);
      pitches.push(top[Math.min(top.length - 1, Math.max(0, index))]);
    }

    const gain = noteGain * (rising ? 1 : departureGainScale);

    let delaySeconds = 0;
    pitches.forEach((pitch, order) => {
      const decay = rising
        ? minDecaySeconds +
          hashUnit(seed, 40 + order) * (maxDecaySeconds - minDecaySeconds)
        : departureDecaySeconds;
      this.triggerFlourishNote(pitch * registerMultiplier, x, gain, decay, {
        delaySeconds,
        attackSeconds,
        partialGain,
        // A few cents either side, so the cluster shimmers rather than
        // sounding like one pitch struck repeatedly.
        detuneCents: (hashUnit(seed, 60 + order) * 2 - 1) * detuneCents,
        layer: "chime",
      });
      // Jittered spacing, so the notes land like struck tubes rather than on
      // a grid.
      delaySeconds +=
        minSpacingSeconds +
        hashUnit(seed, 80 + order) * (maxSpacingSeconds - minSpacingSeconds);
    });
  }

  /**
   * A deep resonant note marking one page navigation. Rate-limited globally —
   * a burst of navigations should read as one structural event, not a run.
   */
  triggerNavigation(event: NavigationSoundEvent = {}): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    if (!this.config.navigationSounds) return;

    const ctx = this.ctx;
    const startTime = ctx.currentTime;

    // Rate-limit against the audio clock rather than the render tick. The
    // navigation views draw no trails, so tick() never runs there and
    // lastTickMs would stay frozen at 0 — every note after the first would
    // measure a zero-length gap and be dropped. ctx.currentTime always
    // advances, whichever view is on screen.
    const nowMs = startTime * 1000;
    if (nowMs - this.lastNavigationNoteMs < NAVIGATION_TUNING.minIntervalMs) {
      return;
    }
    this.lastNavigationNoteMs = nowMs;
    const {
      registerMultiplier,
      detuneCents,
      partialGain,
      octaveGain,
      peakGain,
      attackSeconds,
      decaySeconds,
      filterHz,
    } = NAVIGATION_TUNING;

    const frequency = this.currentRoot() * registerMultiplier;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterHz;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + attackSeconds);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      startTime + attackSeconds + decaySeconds,
    );

    const pan = ctx.createStereoPanner();
    pan.pan.value =
      event.x === undefined ? 0 : positionToPan(event.x, this.canvasWidth);

    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.busFor("navigation"));

    // The fundamental plus two partials detuned either side of it. The slow
    // beating between them is what gives the note its struck, resonant body.
    const stopTime = startTime + attackSeconds + decaySeconds + 0.1;
    const voices: Array<{ frequency: number; detune: number; level: number }> = [
      { frequency, detune: 0, level: 1 },
      { frequency, detune: -detuneCents, level: partialGain },
      { frequency, detune: detuneCents, level: partialGain },
      { frequency: frequency * 2, detune: 0, level: octaveGain },
    ];

    const oscillators: OscillatorNode[] = [];
    for (const voice of voices) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = voice.frequency;
      osc.detune.value = voice.detune;

      const level = ctx.createGain();
      level.gain.setValueAtTime(voice.level, startTime);

      osc.connect(level);
      level.connect(filter);
      osc.start(startTime);
      osc.stop(stopTime);
      oscillators.push(osc);
    }

    oscillators[0].onended = () => {
      for (const osc of oscillators) {
        try {
          osc.disconnect();
        } catch {
          /* already disconnected */
        }
      }
      try {
        filter.disconnect();
        gain.disconnect();
        pan.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  }

  /**
   * Play one accent in isolation, on demand, at the current chord.
   *
   * These route straight to the same private synthesis the live features call,
   * bypassing only the gating that makes sense for a scene — the enable
   * toggles, the rate limiters, the arrival debounce. Auditioning a sound is
   * an explicit request for exactly one note, so nothing should swallow it.
   */
  audition(accent: AuditionAccent): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;

    const centre = this.canvasWidth / 2;
    switch (accent) {
      case "trailArrival":
        // No trail to key off, so the audition uses a fixed seed: pressing
        // the button twice should sound the same chime, not a new one.
        this.triggerArrivalFigure(centre, true, hashIdentity("audition-chime"));
        return;
      case "trailDeparture":
        this.triggerArrivalFigure(
          centre,
          false,
          hashIdentity("audition-chime"),
        );
        return;
      case "navigation": {
        // The navigation note is the one accent whose production trigger is
        // public and rate-limited. Clear the limiter so repeated presses of
        // the audition button each sound.
        this.lastNavigationNoteMs = Number.NEGATIVE_INFINITY;
        const wasEnabled = this.config.navigationSounds;
        this.config.navigationSounds = true;
        this.triggerNavigation({ x: centre });
        this.config.navigationSounds = wasEnabled;
        return;
      }
      case "soloistFlourish": {
        // A representative mid-velocity note: the same palette walk and
        // quantized octave selection the soloist uses, at half the velocity
        // that reaches the top register.
        const palette = this.flourishPalette();
        const normalized = 0.5;
        const {
          registerMinMultiplier: registerMin,
          registerMaxMultiplier: registerMax,
        } = FLOURISH_TUNING;
        const octaves = Math.round(
          Math.log2(registerMin) +
            normalized * (Math.log2(registerMax) - Math.log2(registerMin)),
        );
        const decay =
          FLOURISH_TUNING.decayMinSeconds +
          normalized *
            (FLOURISH_TUNING.decayMaxSeconds - FLOURISH_TUNING.decayMinSeconds);
        this.triggerFlourishNote(
          palette[0] * Math.pow(2, octaves),
          centre,
          FLOURISH_TUNING.noteGain,
          decay,
        );
        return;
      }
      case "soloistResolve":
        this.triggerFlourishNote(
          this.flourishPalette()[0] * 2,
          centre,
          FLOURISH_TUNING.noteGain * FLOURISH_TUNING.resolveGainScale,
          FLOURISH_TUNING.resolveDecaySeconds,
        );
        return;
      case "crossingDissonance":
        // Mid-canvas, at the closest distance the detector accepts, so the
        // audition is the loudest version of what a crossing actually sounds.
        this.triggerCrossingDissonance(0, 1, centre, 0, 0);
        return;
      case "crossingMerge": {
        // The live merge draws its two pitches from the crossing trails'
        // fingerprints. Auditioning has no trails, so this sounds the fallback
        // dyad — root and fifth of the current chord.
        const { dyadGain, attackSeconds, decaySeconds, partialGain } =
          CROSSING_MERGE_TUNING;
        const root = this.currentRoot() * CROSSING_MERGE_TUNING.registerMultiplier;
        for (const pitch of [root, root * 1.5]) {
          this.triggerFlourishNote(pitch, centre, dyadGain, decaySeconds, {
            attackSeconds,
            partialGain,
            layer: "crossing",
          });
        }
        return;
      }
      case "trailVoicePair":
        this.auditionVoicePair();
        return;
      case "choralSwell":
        this.auditionChoralSwell();
        return;
    }
  }

  /**
   * One voice through the whole swell shape — onset, crescendo, release — in
   * the choral timbre, so the envelope and the vowel can be judged on their
   * own rather than picked out of a moving scene.
   */
  private auditionChoralSwell(): void {
    if (!this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const { onsetMs, crescendoSeconds, peakScale, releaseSeconds } =
      SWELL_TUNING;
    const onsetSeconds = onsetMs / 1000;
    const totalSeconds = onsetSeconds + crescendoSeconds + releaseSeconds;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = this.currentRoot() * 2;

    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2000;

    const gain = ctx.createGain();
    // The full shape: a level onset while the swell has not yet started, the
    // crescendo leaning in, then the slow release.
    const baseGain = 0.09;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(baseGain, now + 0.15);
    gain.gain.setValueAtTime(baseGain, now + onsetSeconds);
    gain.gain.linearRampToValueAtTime(
      baseGain * peakScale,
      now + onsetSeconds + crescendoSeconds,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + totalSeconds);

    const pan = ctx.createStereoPanner();
    osc.connect(tone);
    tone.connect(gain);

    // The same formant bank the live voices use, opening from "ooh" to "ahh"
    // across the crescendo so the vowel morph is audible too.
    const mix = ctx.createGain();
    mix.gain.setValueAtTime(CHORAL_TUNING.formantMix, now);
    const { closedFormantsHz, openFormantsHz, formantQ } = CHORAL_TUNING;
    const formants = closedFormantsHz.map((hz, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(hz, now);
      filter.frequency.linearRampToValueAtTime(
        openFormantsHz[i],
        now + onsetSeconds + crescendoSeconds,
      );
      filter.Q.setValueAtTime(formantQ, now);
      tone.connect(filter);
      filter.connect(mix);
      return filter;
    });
    mix.connect(gain);

    gain.connect(pan);
    pan.connect(this.busFor("bed"));

    osc.start(now);
    osc.stop(now + totalSeconds + 0.1);
    osc.onended = () => {
      try {
        osc.disconnect();
        tone.disconnect();
        for (const filter of formants) filter.disconnect();
        mix.disconnect();
        gain.disconnect();
        pan.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  }

  /**
   * Two example fingerprints side by side, so the difference a trail voice
   * makes is audible without needing two real trails to cross the canvas. Each
   * holds for a couple of seconds on its own home tone, with its own detune
   * and vibrato, panned apart.
   */
  private auditionVoicePair(): void {
    if (!this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const scale = this.flourishPalette();
    const holdSeconds = 2;

    // Two fixed keys chosen so their fingerprints differ audibly; the live
    // engine hashes real participant ids the same way.
    const keys = ["audition-voice-a", "audition-voice-b"];
    keys.forEach((key, order) => {
      const hash = hashIdentity(key);
      const {
        maxDetuneCents,
        vibratoMinRateHz,
        vibratoMaxRateHz,
        maxVibratoDepthCents,
      } = TRAIL_VOICE_TUNING;
      const detuneCents =
        (hashUnit(hash, DETUNE_SALT) * 2 - 1) * maxDetuneCents;
      const vibratoRateHz =
        vibratoMinRateHz +
        hashUnit(hash, VIBRATO_RATE_SALT) *
          (vibratoMaxRateHz - vibratoMinRateHz);
      const vibratoDepthCents =
        hashUnit(hash, VIBRATO_DEPTH_SALT) * maxVibratoDepthCents;

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = homeToneForHash(hash, scale) * 2;
      osc.detune.value = detuneCents;

      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = vibratoRateHz;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = vibratoDepthCents;
      lfo.connect(lfoDepth);
      lfoDepth.connect(osc.detune);

      // Sequential rather than simultaneous: the point is to compare them, and
      // two sustained tones a few cents apart just sound like one beating tone.
      const startAt = now + order * holdSeconds;
      const stopAt = startAt + holdSeconds + 0.05;

      const gain = ctx.createGain();
      const attackSeconds = 0.08;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.1, startAt + attackSeconds);
      gain.gain.setValueAtTime(0.1, startAt + holdSeconds - 0.3);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + holdSeconds);

      const pan = ctx.createStereoPanner();
      pan.pan.value = order === 0 ? -0.5 : 0.5;

      osc.connect(gain);
      gain.connect(pan);
      pan.connect(this.busFor("bed"));
      osc.start(startAt);
      lfo.start(startAt);
      osc.stop(stopAt);
      lfo.stop(stopAt);
      osc.onended = () => {
        try {
          osc.disconnect();
          lfo.disconnect();
          lfoDepth.disconnect();
          gain.disconnect();
          pan.disconnect();
        } catch {
          /* already disconnected */
        }
      };
    });
  }

  /**
   * Hold the bass pedal on the current chord root. Chord changes crossfade to
   * a second voice rather than sliding the pitch, so the floor moves without
   * an audible glide.
   */
  private updateBassPedal(): void {
    if (!this.ctx || !this.masterGain) return;

    if (!this.config.bassPedal) {
      if (this.bassPedalVoices.length > 0) this.releaseBassPedal();
      return;
    }

    const target = this.currentRoot() * BASS_PEDAL_TUNING.registerMultiplier;
    if (this.bassPedalFrequency !== target) {
      const isFirstVoice = this.bassPedalVoices.length === 0;
      // Switching the pedal on fades in from silence; a chord change overlaps
      // the outgoing root with the incoming one.
      const fadeSeconds = isFirstVoice
        ? BASS_PEDAL_TUNING.fadeInSeconds
        : BASS_PEDAL_TUNING.crossfadeSeconds;
      for (const voice of this.bassPedalVoices) {
        this.retireBassPedalVoice(voice, fadeSeconds);
      }
      this.bassPedalVoices = [this.createBassPedalVoice(target, fadeSeconds)];
      this.bassPedalFrequency = target;
      return;
    }

    // Level tracks the energy arc so the floor swells with a busy scene.
    for (const voice of this.bassPedalVoices) {
      this.rampParam(voice.gainNode.gain, this.bassPedalGain(), 0.5);
    }
  }

  /** Steady pedal level, lifted modestly by energy when the arc is running. */
  private bassPedalGain(): number {
    const { gain, energyGainBoost } = BASS_PEDAL_TUNING;
    if (!this.config.energyArc) return gain;
    return gain * (1 + energyGainBoost * this.energy);
  }

  private createBassPedalVoice(
    frequency: number,
    fadeSeconds: number,
  ): BassPedalVoice {
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = frequency;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = BASS_PEDAL_TUNING.filterHz;
    filter.Q.value = BASS_PEDAL_TUNING.filterQ;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(this.bassPedalGain(), now + fadeSeconds);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.busFor("bassPedal"));
    osc.start(now);

    return { oscillator: osc, gainNode: gain, filterNode: filter, frequency };
  }

  /** Fade one pedal voice out and tear it down once it is silent. */
  private retireBassPedalVoice(
    voice: BassPedalVoice,
    fadeSeconds: number,
  ): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.rampParam(voice.gainNode.gain, 0, fadeSeconds);
    voice.oscillator.onended = () => {
      try {
        voice.oscillator.disconnect();
        voice.filterNode.disconnect();
        voice.gainNode.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    try {
      voice.oscillator.stop(now + fadeSeconds + 0.05);
    } catch {
      /* already stopped */
    }
  }

  /** Silence the pedal entirely, e.g. when it is switched off or on reset. */
  private releaseBassPedal(): void {
    for (const voice of this.bassPedalVoices) {
      this.retireBassPedalVoice(voice, BASS_PEDAL_TUNING.fadeOutSeconds);
    }
    this.bassPedalVoices = [];
    this.bassPedalFrequency = null;
  }

  /** Low drone voices currently sounding (diagnostics). */
  getBassPedalVoiceCount(): number {
    return this.bassPedalVoices.length;
  }

  /**
   * Advance the soloist's flourish by this frame's travel, firing a bell when
   * enough ground has been covered. Called only for the trail holding the
   * spotlight; every other trail is untouched.
   */
  private advanceFlourish(
    elapsedMs: number,
    frame: TrailSoundFrame,
    distance: number,
    velocity: number,
  ): void {
    const state = this.flourish;
    if (!state) return;

    state.distanceSinceNote += distance;

    if (elapsedMs - state.promotedAtMs < FLOURISH_TUNING.anticipationMs) return;
    if (state.distanceSinceNote < FLOURISH_TUNING.distancePerNotePx) return;
    if (
      elapsedMs - state.lastNoteTimeMs < FLOURISH_TUNING.minNoteIntervalMs
    ) {
      return;
    }

    state.distanceSinceNote = 0;
    state.lastNoteTimeMs = elapsedMs;

    const palette = this.flourishPalette();
    // Walking the palette rather than re-deriving from direction keeps the run
    // reading as a melodic line instead of a jitter of repeated notes.
    const pitch = palette[state.paletteStep % palette.length];
    state.paletteStep++;

    // Faster movement selects a higher register, so an accelerating sweep
    // climbs rather than just getting louder.
    const normalized = Math.min(
      1,
      velocity / FLOURISH_TUNING.registerFullVelocity,
    );
    const {
      registerMinMultiplier: registerMin,
      registerMaxMultiplier: registerMax,
    } = FLOURISH_TUNING;
    // Octave selection is quantized, so the run lands on real octaves of the
    // palette pitch rather than sliding between them.
    const octaves = Math.round(
      Math.log2(registerMin) +
        normalized * (Math.log2(registerMax) - Math.log2(registerMin)),
    );

    const decay =
      FLOURISH_TUNING.decayMinSeconds +
      normalized *
        (FLOURISH_TUNING.decayMaxSeconds - FLOURISH_TUNING.decayMinSeconds);

    this.triggerFlourishNote(
      pitch * Math.pow(2, octaves),
      frame.x,
      FLOURISH_TUNING.noteGain,
      decay,
    );
  }

  /**
   * One closing note as the spotlight leaves a trail: the chord root in a
   * mid register with a longer ring, so the run has an ending rather than
   * just stopping.
   */
  private triggerResolvingNote(trailIndex: number): void {
    const palette = this.flourishPalette();
    const root = palette[0];
    const position = this.prevPositions.get(trailIndex);
    this.triggerFlourishNote(
      root * 2,
      position?.x ?? this.canvasWidth / 2,
      FLOURISH_TUNING.noteGain * FLOURISH_TUNING.resolveGainScale,
      FLOURISH_TUNING.resolveDecaySeconds,
    );
  }

  /**
   * Fire one bell-family note: a sine fundamental plus a 3x partial, fast
   * attack and exponential ring-out, on a graph that disconnects itself when
   * the oscillators stop. Same shape as the click bell but quieter, so a real
   * click still reads as the strongest accent in the scene.
   */
  private triggerFlourishNote(
    frequency: number,
    x: number,
    peakGain: number,
    decaySeconds: number,
    options: {
      /** Start the note this far in the future, for multi-note figures. */
      delaySeconds?: number;
      attackSeconds?: number;
      partialGain?: number;
      /** Fixed pitch offset in cents, used to make chime clusters shimmer. */
      detuneCents?: number;
      /**
       * Which mixer family this note belongs to. The same synthesis serves the
       * soloist's flourish, the arrival/departure chimes and the merged
       * crossing dyad, so the caller says which one it is sounding.
       */
      layer?: SoundLayer;
    } = {},
  ): void {
    if (!this.ctx || !this.masterGain) return;

    this.enforceFlourishBudget();

    const ctx = this.ctx;
    const now = ctx.currentTime + (options.delaySeconds ?? 0);
    const attackSeconds =
      options.attackSeconds ?? FLOURISH_TUNING.attackSeconds;
    const partialGain = options.partialGain ?? FLOURISH_TUNING.partialGain;

    const detuneCents = options.detuneCents ?? 0;

    const osc = ctx.createOscillator();
    osc.type = CLICK_BELL.oscillatorType;
    osc.frequency.value = frequency;
    osc.detune.value = detuneCents;

    const partial = ctx.createOscillator();
    partial.type = "sine";
    partial.frequency.value = frequency * 3;
    partial.detune.value = detuneCents;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + attackSeconds);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + attackSeconds + decaySeconds,
    );

    const partialLevel = ctx.createGain();
    partialLevel.gain.setValueAtTime(0, now);
    partialLevel.gain.linearRampToValueAtTime(
      peakGain * partialGain,
      now + attackSeconds,
    );
    // The partial dies first, so the note softens from struck to hummed.
    partialLevel.gain.exponentialRampToValueAtTime(
      0.0001,
      now + attackSeconds + decaySeconds / 2,
    );

    const pan = ctx.createStereoPanner();
    pan.pan.value = positionToPan(x, this.canvasWidth);

    osc.connect(gain);
    partial.connect(partialLevel);
    gain.connect(pan);
    partialLevel.connect(pan);
    pan.connect(this.busFor(options.layer ?? "flourish"));

    const note: FlourishNote = {
      oscillator: osc,
      partial,
      gainNode: gain,
      partialGainNode: partialLevel,
      panNode: pan,
      peakGain,
      startedAtMs: now * 1000,
    };
    this.flourishNotes.add(note);

    osc.onended = () => {
      this.disconnectFlourishNote(note);
      this.flourishNotes.delete(note);
    };

    const stopTime = now + attackSeconds + decaySeconds + 0.05;
    osc.start(now);
    partial.start(now);
    osc.stop(stopTime);
    partial.stop(stopTime);
  }

  /**
   * Keep the flourish note count bounded. At the cap the quietest note is cut
   * (ties broken by age) rather than refusing the new one — dropping a note
   * that is already ringing out is far less noticeable than a missing attack.
   */
  private enforceFlourishBudget(): void {
    while (this.flourishNotes.size >= FLOURISH_TUNING.maxConcurrentNotes) {
      let victim: FlourishNote | null = null;
      for (const note of this.flourishNotes) {
        if (
          !victim ||
          note.peakGain < victim.peakGain ||
          (note.peakGain === victim.peakGain &&
            note.startedAtMs < victim.startedAtMs)
        ) {
          victim = note;
        }
      }
      if (!victim) return;
      this.stopFlourishNote(victim);
    }
  }

  private stopFlourishNote(note: FlourishNote): void {
    const now = this.ctx?.currentTime ?? 0;
    try {
      this.holdParam(note.gainNode.gain, now);
      note.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.02);
      note.oscillator.stop(now + 0.03);
      note.partial.stop(now + 0.03);
    } catch {
      /* already stopped */
    }
    this.flourishNotes.delete(note);
  }

  private disconnectFlourishNote(note: FlourishNote): void {
    try {
      note.oscillator.disconnect();
      note.partial.disconnect();
      note.gainNode.disconnect();
      note.partialGainNode.disconnect();
      note.panNode.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  /** Silence and tear down every ringing flourish note. */
  private clearFlourish(): void {
    for (const note of [...this.flourishNotes]) {
      this.stopFlourishNote(note);
      this.disconnectFlourishNote(note);
    }
    this.flourishNotes.clear();
    this.flourish = null;
  }

  private disconnectVoice(voice: Voice): void {
    this.stopVibrato(voice);
    this.detachFormants(voice);
    voice.oscillatorLevel?.disconnect();
    voice.fifthOscillatorLevel?.disconnect();
    voice.fifthGainNode?.disconnect();
    voice.filterNode.disconnect();
    voice.gainNode.disconnect();
    voice.panNode.disconnect();
  }

  setVolume(volume: number): void {
    this.baseVolume = Math.max(0, Math.min(1, volume));
    this.updateMasterGainForPolyphony(this.lastActiveTrailCount);
    this.notesEngine.setVolume(this.baseVolume);
  }

  // ── Layer mixer ───────────────────────────────────────────────────────────
  // A diagnostic for the sound playground: solo or mute one family of sounds
  // to hear what it contributes. Live pages never touch these, so every layer
  // stays audible unless something explicitly asks otherwise.

  /**
   * Whether a layer should currently sound, under standard mixer semantics:
   * any solo anywhere silences every layer that is not soloed, and solo wins
   * over mute on the same layer.
   */
  isLayerAudible(layer: SoundLayer): boolean {
    if (this.soloedLayers.size > 0) return this.soloedLayers.has(layer);
    return !this.mutedLayers.has(layer);
  }

  /** 1 when a layer should sound, 0 when the mixer is holding it silent. */
  private layerGainValue(layer: SoundLayer): number {
    return this.isLayerAudible(layer) ? 1 : 0;
  }

  /** Mute or unmute one layer. Ignored while that layer is soloed. */
  setLayerMuted(layer: SoundLayer, muted: boolean): void {
    if (muted) this.mutedLayers.add(layer);
    else this.mutedLayers.delete(layer);
    this.applyLayerGains();
  }

  /** Solo or unsolo one layer. Any solo silences every layer without one. */
  setLayerSoloed(layer: SoundLayer, soloed: boolean): void {
    if (soloed) this.soloedLayers.add(layer);
    else this.soloedLayers.delete(layer);
    this.applyLayerGains();
  }

  /** Clear every solo and mute, so the whole mix is audible again. */
  clearLayerMix(): void {
    this.mutedLayers.clear();
    this.soloedLayers.clear();
    this.applyLayerGains();
  }

  /** The mixer state, for rendering the strip. */
  getLayerMix(): { muted: SoundLayer[]; soloed: SoundLayer[] } {
    return {
      muted: [...this.mutedLayers],
      soloed: [...this.soloedLayers],
    };
  }

  /** Push the resolved audibility of every layer onto its bus. */
  private applyLayerGains(): void {
    if (!this.ctx) return;
    for (const layer of SOUND_LAYERS) {
      const bus = this.layerBuses.get(layer);
      if (!bus) continue;
      // A short ramp rather than a hard step, so toggling a sustained layer
      // does not click.
      this.rampParam(bus.gain, this.layerGainValue(layer), 0.02);
    }
  }

  /**
   * The node a family's sources should connect to. Falls back to master when
   * the bus is missing, so synthesis never depends on the mixer existing.
   */
  private busFor(layer: SoundLayer): AudioNode {
    return this.layerBuses.get(layer) ?? this.masterGain!;
  }

  /** Number of one-shot notes currently sounding (notes mode diagnostics). */
  getActiveNoteCount(): number {
    return this.notesEngine.getActiveNoteCount();
  }

  /** Flourish notes currently ringing (spotlight mode diagnostics). */
  getActiveFlourishNoteCount(): number {
    return this.flourishNotes.size;
  }

  /** Trail index currently soloing, or null. */
  getSoloistTrailIndex(): number | null {
    return this.config.spotlight
      ? this.spotlightTrailIndex
      : this.notesEngine.getSoloistTrailIndex();
  }

  /** Rolling scene-average velocity behind the soloist decision. */
  getSceneAverageVelocity(): number {
    return this.config.spotlight
      ? this.spotlightSceneAverage
      : this.notesEngine.getSceneAverageVelocity();
  }

  private updateMasterGainForPolyphony(activeTrailCount: number): void {
    if (!this.masterGain || !this.ctx) return;
    // When many trails overlap, reduce total output energy to avoid clipping artifacts.
    const polyphonyScale = Math.max(
      MIN_POLYPHONY_GAIN_SCALE,
      1 / Math.sqrt(Math.max(1, activeTrailCount / 3)),
    );
    // The energy swell rides on top of the polyphony ducking rather than
    // replacing it, so dense scenes still avoid clipping. The ensemble breath
    // multiplies in beside it, so the two compose rather than one overriding
    // the other.
    const target =
      this.baseVolume *
      polyphonyScale *
      this.energyGainScale() *
      this.breathGainScale();
    // Re-ramping every frame would restart the glide before it arrived, so
    // only schedule on a real move. Both inputs are slow — trail count is
    // discrete and energy is a long follower — so this stays smooth.
    if (Math.abs(target - this.lastMasterGainTarget) < 0.001) return;
    this.lastMasterGainTarget = target;
    this.rampParam(this.masterGain.gain, target, 0.08);
  }

  private rampParam(
    param: AudioParam,
    targetValue: number,
    durationSeconds: number,
  ): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.holdParam(param, now);
    param.linearRampToValueAtTime(targetValue, now + durationSeconds);
  }

  private holdParam(param: AudioParam, time: number): void {
    // cancelAndHoldAtTime preserves the instantaneous computed value and avoids
    // discontinuities ("pops") from jumping to AudioParam.value mid-envelope.
    const hold = (param as AudioParam & {
      cancelAndHoldAtTime?: (time: number) => void;
    }).cancelAndHoldAtTime;
    if (hold) {
      hold.call(param, time);
      return;
    }
    // Fallback for older browsers lacking cancelAndHoldAtTime.
    // We intentionally avoid noisy compatibility logs in the audio hot path;
    // this degrades safely by cancelling future automation only.
    param.cancelScheduledValues(time);
  }

  dispose(): void {
    this.enabled = false;
    this.notesEngine.detach();
    this.clearFlourish();
    this.releaseBassPedal();
    this.arrivalTimesMs.clear();
    this.arrivalSeeds.clear();
    this.recentArrivalsMs.length = 0;
    for (const [, voice] of this.voices) {
      this.stopVibrato(voice);
      this.detachFormants(voice);
      if (voice.oscillator) {
        try { voice.oscillator.stop(); } catch { /* already stopped */ }
      }
      if (voice.fifthOscillator) {
        try { voice.fifthOscillator.stop(); } catch { /* already stopped */ }
      }
    }
    this.voices.clear();
    this.prevPositions.clear();
    this.prevSampleTimesMs.clear();
    this.crossingCooldowns.clear();
    this.trailPaths.clear();
    this.fingerprints.clear();
    this.fingerprintKeys.clear();
    this.mergePullsUntilMs.clear();
    this.swells.clear();
    for (const bus of this.layerBuses.values()) {
      try { bus.disconnect(); } catch { /* already disconnected */ }
    }
    this.layerBuses.clear();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }

  reset(): void {
    this.notesEngine.reset();
    // A reset tears the scene down and immediately rebuilds it. Every trail in
    // the new scene is technically arriving, but sounding that is a volley, so
    // arrivals stay suppressed until the rebuilt scene has settled.
    this.arrivalsSuppressedUntilMs =
      this.lastTickMs + ARRIVAL_TUNING.resetSuppressionMs;
    this.arrivalTimesMs.clear();
    this.arrivalSeeds.clear();
    this.recentArrivalsMs.length = 0;
    this.releaseBassPedal();
    // Fast-cut fade (30ms) — releaseVoice uses a 500ms ramp that audibly
    // overlaps with newly-created voices on data changes like day swaps.
    const now = this.ctx?.currentTime ?? 0;
    for (const [, voice] of this.voices) {
      let disconnectWhenStopped = false;
      if (this.ctx) {
        this.holdParam(voice.gainNode.gain, now);
        voice.gainNode.gain.linearRampToValueAtTime(0, now + 0.03);
      }
      if (voice.oscillator) {
        voice.oscillator.onended = () => this.disconnectVoice(voice);
        try {
          voice.oscillator.stop(now + 0.04);
          disconnectWhenStopped = true;
        } catch { /* already stopped */ }
        voice.oscillator = null;
      }
      if (voice.fifthOscillator) {
        try { voice.fifthOscillator.stop(now + 0.04); } catch { /* already stopped */ }
        voice.fifthOscillator = null;
      }
      if (!disconnectWhenStopped) {
        this.disconnectVoice(voice);
      }
      voice.active = false;
    }
    this.voices.clear();
    this.prevPositions.clear();
    this.prevSampleTimesMs.clear();
    this.crossingCooldowns.clear();
    this.trailPaths.clear();
    // Fingerprints deliberately survive a reset: a reset rebuilds the same
    // scene, and a participant who sounded one way before it should sound the
    // same way after. Only the merge pulls, which are moment-scoped, are cleared.
    this.mergePullsUntilMs.clear();
    this.swells.clear();
    this.spotlightGains.clear();
    this.spotlightVelocitySamples.clear();
    this.spotlightSmoothedVelocities.clear();
    this.spotlightTrailIndex = null;
    this.spotlightSceneAverage = 0;
    this.clearFlourish();
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
