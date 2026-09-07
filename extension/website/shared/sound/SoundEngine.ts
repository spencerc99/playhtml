// ABOUTME: Core generative sound engine driven by cursor trail animation data
// ABOUTME: Manages Web Audio voices, maps trail frames to musical parameters each animation frame

import {
  TrailSoundFrame,
  ClickSoundEvent,
  InstrumentConfig,
  NavigationSoundEvent,
  AuditionAccent,
  ClickPercussionVariant,
  PizzicatoVariant,
  TimpaniVariant,
  CantusVariant,
  SoundLayer,
  SoundNotice,
  SoundNoticeListener,
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
  foldPitchIntoBand,
  registerBandForHue,
  registerBandForColor,
  RegisterBand,
  RegisterMappingMode,
  REGISTER_BANDS,
  ATTACK_SALT,
  DETUNE_SALT,
  VIBRATO_DEPTH_SALT,
  VIBRATO_RATE_SALT,
  CHORD_DWELL_MS,
  Chord,
  DEFAULT_PROGRESSION_ID,
  Progression,
  progressionById,
  ProgressionId,
  upperNeighbor,
  chordTones,
  nearestChordTone,
  D_MINOR_PENTATONIC,
} from "./scales";
import { parseColorToHsl } from "../utils/eventUtils";
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

/**
 * What the soloist plays while it holds the spotlight.
 *
 * All three are the same promotion — the same trail, chosen the same way, held
 * for the same minimum — differing only in what it says. "bells" walks the
 * whole palette, so the run can pass through colour tones; the other two stay
 * on the chord, one as discrete notes and one as no notes at all.
 */
export type SoloistVoice =
  /** A run of bells stepping through the palette. The shipped voice. */
  | "bells"
  /**
   * An ascending roll through the chord's own tones, harp-like: softer attack
   * and a longer, gentler decay than the bell.
   */
  | "arpeggio"
  /**
   * No discrete notes at all. The trail's own sustained voice lifts an octave
   * and brightens on promotion, voice-leads through chord tones while it
   * holds, and returns on demotion.
   */
  | "descant";

/** Every soloist voice, in the order a selector should present them. */
export const SOLOIST_VOICES: SoloistVoice[] = ["bells", "arpeggio", "descant"];

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
  /**
   * Which named rotation `chordRotation` cycles. Only takes effect while
   * rotation is on; with it off the scene holds the default's first chord.
   */
  progression: ProgressionId;
  /** Let accumulated scene motion swell and relax the whole mix. */
  energyArc: boolean;
  /** Soft two-note figures as trails enter and leave the scene. */
  trailArrivals: boolean;
  /** A deep resonant note on each animated page navigation. */
  navigationSounds: boolean;
  /** A sustained low drone on the current chord root, under everything. */
  bassPedal: boolean;
  /**
   * How far the mix leans toward following one cursor rather than telling one
   * story, from 0 (story) to 1 (traceable).
   *
   * At 0 the scene is at the values everything else was tuned against: trails
   * settle onto their home tone often, so the crowd voices a chord, and swells
   * take their time, so the bed breathes as one ensemble. Turning it up loosens
   * both — trails follow their own motion more of the time and swells respond
   * faster — so an individual cursor becomes easier to pick out of the crowd,
   * at the cost of the arrangement holding together.
   *
   * `TRAIL_VOICE_TUNING.homeToneBias` and `SWELL_TUNING` remain the source of
   * truth for the story end; this only interpolates away from them.
   */
  traceability: number;
  /** How the spotlight's soloist speaks — see `SoloistVoice`. */
  soloistVoice: SoloistVoice;
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
  progression: DEFAULT_PROGRESSION_ID,
  energyArc: false,
  trailArrivals: false,
  navigationSounds: false,
  bassPedal: false,
  traceability: 0,
  soloistVoice: "bells",
};

/**
 * What the traceability dial reaches at its traceable end. The story end is
 * whatever `TRAIL_VOICE_TUNING` and `SWELL_TUNING` already say, so those stay
 * the single place the tuned arrangement is written down.
 */
const TRACEABILITY_LIMITS = {
  /** Trails take their own motion's note far more often than the chord tone. */
  homeToneBias: 0.1,
  /** Swell onset and crescendo, as a fraction of their story-end lengths. */
  swellTimeScale: 0.4,
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
 * Crossing-tension tuning. The dissonance flavor is a suspension rather than a
 * raw clash: a step above a chord tone, held, then falling onto it. Tension
 * that resolves reads as harmony under strain; tension that never resolves
 * just reads as a wrong note, which is what the earlier sine-dyad version was.
 *
 * Three variants, selected by how much is happening in the scene, so the same
 * gesture scales with the room rather than landing identically on an empty
 * canvas and a crowded one.
 */
const CROSSING_TENSION_TUNING = {
  /** Register multiplier placing the figure above the sustained bed. */
  registerMultiplier: 2,
  /** Peak gain. Quiet: a crossing is an inflection, not an event. */
  gain: 0.05,
  attackSeconds: 0.05,
  /** How long the two tones are held together before the upper one falls. */
  suspensionSeconds: 0.7,
  /** Ring-out of the resolved tone. Soft, so the release is a settling. */
  resolutionDecaySeconds: 1.5,
  /** Level of the suspended upper voice against the chord tone under it. */
  upperVoiceGain: 0.8,
  /**
   * Below this scene energy, the interval is dropped for a beating shimmer:
   * two tones a few Hz apart on the same chord tone. On a near-empty canvas
   * even a resolving second is more incident than the moment carries.
   */
  gentleEnergyThreshold: 0.18,
  /** Beat rate of the shimmer, in Hz — slow enough to read as a pulse. */
  shimmerMinBeatHz: 4,
  shimmerMaxBeatHz: 6,
  /** The shimmer is longer and quieter than the suspension it replaces. */
  shimmerGainScale: 0.7,
  shimmerDecaySeconds: 2.5,
  /**
   * Above this energy a crossing may sound the harsh version — the tritone the
   * flavor used to fire unconditionally. Kept because Spencer suspects promise
   * in real dissonance, but reserved for scenes busy enough to carry it.
   */
  harshEnergyThreshold: 0.75,
  /** Minimum gap between harsh crossings. Far harder than the pair cooldown. */
  harshMinIntervalMs: 8000,
  /** The harsh interval, and how long it grinds before decaying. */
  harshDecaySeconds: 1.2,
  harshGainScale: 0.9,
  /**
   * Recent-motion window used to stand in for scene energy when the energy arc
   * is off, so the variant choice still tracks how busy the canvas is.
   */
  motionWindowMs: 2000,
  /** Summed px/frame across the window that reads as a fully busy scene. */
  motionFullScale: 60,
};

/**
 * Which of the three crossing-tension figures a crossing sounds. Chosen from
 * scene energy, not at random, so the flavor tracks the room.
 */
export type CrossingTensionVariant = "shimmer" | "suspension" | "harsh";

/**
 * Which colour property assigns a trail its choral part.
 *
 * "hue" is the shipped mapping: cool colours low, warm colours high. Switch to
 * "luminance" to have the ear track how bright a trail looks instead of where
 * it sits on the wheel — dark trails sing bass, bright ones soprano. Kept as a
 * constant rather than a config toggle because it is a question to settle by
 * ear once, not a per-scene setting.
 */
export const REGISTER_MAPPING: RegisterMappingMode = "hue";

/**
 * Fixed octave step separating the arrival chime's bands, bass to soprano.
 * Bass, tenor and alto's chime registers are tuned against this baseline —
 * see `triggerArrivalFigure` — independent of `ARRIVAL_TUNING.registerMultiplier`,
 * which only moves the soprano ceiling.
 */
const ARRIVAL_REGISTER_STEP = 2;

/**
 * Trail arrival/departure tuning. A trail entering the scene rises through two
 * notes, one leaving falls through them, so the population of the canvas is
 * audible without needing to watch it.
 */
const ARRIVAL_TUNING = {
  /**
   * Octave multiplier placing the chime above the bed. The palettes sit in
   * D3-C5, so the top of the palette at this multiplier lands the soprano
   * chime at C5 — the ensemble ceiling — rather than reaching an octave above
   * it into C6-D6.
   */
  registerMultiplier: 1,
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
   * How the chime shifts across the register bands, soprano to bass.
   *
   * A chime at a fixed high register makes every arrival sound like the same
   * person walking in. Folding the cluster into the arriving trail's own band
   * makes the door announce who opened it: you hear the register before you
   * find the trail on the canvas.
   *
   * Soprano keeps the shipped sound exactly — it is the register the chime was
   * tuned in. The others darken toward the bass by interpolating on band
   * index, which is the only way a low chime reads as a woody knock rather
   * than as the bright chime played wrong: a bell struck low with its full 3x
   * partial intact sounds thin and electronic, and a short decay at that pitch
   * is barely audible at all.
   */
  bandTimbre: {
    /**
     * Level of the 3x partial relative to the soprano value, bass to soprano.
     * Stripping most of the partial is what turns the strike woody.
     */
    partialScale: { bass: 0.35, tenor: 0.55, alto: 0.8, soprano: 1 },
    /** Decay multiplier, bass to soprano. Low notes need room to speak. */
    decayScale: { bass: 1.6, tenor: 1.35, alto: 1.15, soprano: 1 },
    /**
     * Gain multiplier, bass to soprano. A low note carries further through a
     * mix at equal amplitude, so the bass chime is pulled back to sit at the
     * same apparent level as the soprano one.
     */
    gainScale: { bass: 0.8, tenor: 0.88, alto: 0.95, soprano: 1 },
  } satisfies Record<string, Record<RegisterBand, number>>,
  /**
   * Gap between the two chimes of the audition pair. Long enough for the bass
   * chime's stretched decay to clear, so the two are heard in comparison
   * rather than piled on top of each other.
   */
  auditionPairGapSeconds: 3,
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
 * Unpitched percussion candidates, reachable from the sound playground's
 * audition buttons and from its replay driver. No live page path triggers any
 * of them.
 *
 * Every other accent in the engine is pitched and therefore tied to whatever
 * chord is in force. These are not: a tap is a tap regardless of the harmony,
 * which is the whole reason to try them — the pitched accents have to be
 * rationed because too many of them turn the scene into a chord, and
 * percussion has no such ceiling. The gains sit deliberately under
 * `CLICK_BELL.gain`, so if any of these graduates to a real trigger it lands
 * beneath the bells rather than in front of them.
 */
const PERCUSSION_TUNING = {
  /**
   * The click tap: a filtered noise burst over a fast pitch drop, the two
   * halves of how a struck woodblock actually reads — a bright edge on the
   * attack and a body that falls away underneath it.
   */
  clickTap: {
    /** Length of the noise burst. Past ~60ms it stops reading as a tap. */
    noiseDurationSeconds: 0.045,
    /** Bandpass centre for the noise edge, and how tight the band is. */
    noiseFilterHz: 1800,
    noiseFilterQ: 1.2,
    noiseGain: 0.05,
    /**
     * The thump under the edge: a sine falling fast through its range.
     *
     * `thumpGain` is the value to reach for when the taps read as too heavy —
     * it is the whole low half of the sound, and the "tap (no thump)" variant
     * is the same sound with this removed entirely rather than turned down.
     */
    thumpStartHz: 180,
    thumpEndHz: 80,
    thumpDurationSeconds: 0.08,
    thumpGain: 0.07,
    attackSeconds: 0.002,
    /**
     * Level of the bell ghost in the hybrid variant, relative to the shipped
     * click bell, and how much of its ring-out is kept. Quiet and short: the
     * point of the hybrid is a tap with a hint of pitch behind it, not a bell
     * with a tap stuck on the front.
     */
    ghostGainScale: 0.25,
    ghostDecaySeconds: 0.5,
    /** Pitch of the bell ghost. Fixed, so the hybrid stays unpitched in feel. */
    ghostHz: 880,
  },
  /** Seconds of noise generated per buffer, reused by every noise source. */
  noiseBufferSeconds: 1,
};

/**
 * Pizzicato tuning: a plucked string for a click.
 *
 * Pitched, unlike the percussion above — the note comes from the same bell
 * palette and the same click height the shipped click bell uses, so a pluck
 * lands where a bell would have. What changes is the body: a pluck stops
 * dead where a bell rings out, which is what makes a run of clicks read as
 * rhythm inside the harmony rather than as a pile of overlapping bells.
 *
 * Levels sit under `CLICK_BELL.gain` for the same reason the percussion does.
 */
const PIZZICATO_TUNING = {
  /**
   * The warm variant. A triangle over a sine an octave down, with the filter
   * sweeping from open to closed across the decay — the closing filter is what
   * a nylon string does as its high partials die first.
   */
  soft: {
    decaySeconds: 0.25,
    gain: 0.055,
    attackSeconds: 0.004,
    /** Level of the sine an octave below the fundamental, for body. */
    subGain: 0.5,
    /** Filter travel across the decay: open on the pluck, closed at the end. */
    filterStartHz: 2600,
    filterEndHz: 500,
    filterQ: 0.8,
  },
  /**
   * The bright variant. Shorter, a sawtooth rather than a triangle, and with a
   * few milliseconds of filtered noise on the attack — a fingernail rather than
   * a fingertip. The noise is an attack component only, never a body: it is
   * over before the string has finished sounding its first cycle.
   */
  crisp: {
    decaySeconds: 0.15,
    gain: 0.045,
    attackSeconds: 0.002,
    subGain: 0.25,
    filterStartHz: 5000,
    filterEndHz: 1200,
    filterQ: 1,
    /** The fingernail edge: short, high, and well under the string itself. */
    edgeDurationSeconds: 0.012,
    edgeFilterHz: 4500,
    edgeFilterQ: 2,
    edgeGain: 0.02,
  },
  /**
   * The ornamented variant: a quieter grace note a chord tone away, then the
   * soft pluck. The gap is short enough to read as one gesture with a flick in
   * front of it rather than as two separate plucks.
   */
  double: {
    graceLeadSeconds: 0.06,
    graceGainScale: 0.55,
    graceDecayScale: 0.5,
    /**
     * How far up the palette the grace note sits from the main note. One step,
     * so the ornament is adjacent rather than a leap; it wraps down when the
     * main note is already at the top of the palette.
     */
    graceScaleSteps: 1,
  },
};

/**
 * Timpani tuning: the pitched roll under a held click.
 *
 * Replaces the noise roll this used to be. The pitch is the current chord
 * root dropped into D2-D3, and the sound is deliberately not a pure low sine:
 * a fundamental down there is inaudible on a laptop speaker, so the note is
 * built as a fundamental plus partials at 2x and 3x, the same trick that makes
 * the navigation gong survive small speakers. The lowpass sits well above the
 * fundamental so those partials get through.
 */
const TIMPANI_TUNING = {
  /**
   * Where the chord root is voiced. The palette's root is D3, so one octave
   * down puts the drum in D2-D3 — timpani territory, and low enough that the
   * partials are doing the work of making it audible.
   */
  registerMultiplier: 0.5,
  /** Roll length when nothing says otherwise, and the bounds a hold maps into. */
  durationSeconds: 1,
  minDurationSeconds: 0.4,
  maxDurationSeconds: 3,
  gain: 0.06,
  /**
   * Partial levels relative to the fundamental. A drumhead is inharmonic, but
   * plain 2x/3x is close enough to read as a struck skin while staying
   * consonant with the chord — and it is what carries the pitch on a speaker
   * that cannot reproduce the fundamental at all.
   */
  octavePartialGain: 0.45,
  twelfthPartialGain: 0.22,
  /** Lowpass, high enough to pass the partials that make the note audible. */
  filterHz: 1400,
  filterQ: 0.7,
  /** Tremolo rate and depth for the rolled variants. */
  tremoloHz: 13,
  tremoloDepth: 0.7,
  /** Fraction of the roll spent building to full before the cut-off. */
  buildFraction: 0.8,
  releaseSeconds: 0.09,
  /**
   * The root+fifth variant alternates between two pitches. This is how long
   * each one is held before the swap — slow enough to hear as alternation
   * rather than as a warble on top of the tremolo.
   */
  alternateSeconds: 0.22,
  /**
   * The swell variant has no tremolo at all: one tone crescendoing. Its build
   * runs longer than the rolled variants' so the crescendo is the whole event.
   */
  swellBuildFraction: 0.9,
  swellGainScale: 0.85,
};

/**
 * Cantus firmus tuning: one slow autonomous voice, belonging to no trail.
 *
 * The only instrument here that is not triggered by an event. It sings on its
 * own clock whenever it is switched on, drawing each note from the chord in
 * force and moving to the nearest tone from the note before — the same voice
 * leading a trail's home tone follows, which is what keeps it from leaping
 * around when the progression turns over.
 *
 * Quiet but present: the notes overlap because the release is longer than the
 * gap is short, so the line reads as one continuous voice rather than as
 * separate pings.
 */
const CANTUS_TUNING = {
  /** Gap between note onsets. Slow enough that the line is barely a melody. */
  minIntervalSeconds: 8,
  maxIntervalSeconds: 15,
  /**
   * Long either side, so the line never sounds struck and never fully stops.
   * The release is what overlaps into the next note.
   */
  attackSeconds: 3,
  releaseSeconds: 4,
  /**
   * How long the note holds at full before the release begins.
   *
   * Sized so that attack + sustain + release comfortably outlasts the longest
   * gap between onsets: the previous note must still be releasing when the
   * next one begins, or the line reads as separate tones rather than as one
   * voice. Shortening this below `maxIntervalSeconds - attackSeconds` opens
   * audible gaps at the slow end of the interval range.
   */
  sustainSeconds: 10,
  /**
   * The tenor register. The palette already sits at D3-C5, so the tenor sings
   * it as written — that lower octave is C3-C4.
   */
  registerMultiplier: 1,
  gain: 0.035,
  /**
   * Where the soprano variant sits relative to tenor, and how much quieter.
   * Up an octave the same level reads as much louder, hence the trim.
   */
  sopranoOctaves: 1,
  sopranoGainScale: 0.7,
  /**
   * The duet's second voice: a chord tone above the first, at half the level,
   * and offset by half the interval so the two alternate rather than land
   * together. Two notes in unison is one thicker note; offset, it is two
   * voices.
   */
  duetScaleSteps: 2,
  duetGainScale: 0.6,
  duetPhaseOffset: 0.5,
  /**
   * Pan drift across each note, either side of centre. The voice wanders
   * slowly rather than sitting in one place, which is most of what stops a
   * sustained tone reading as a test tone.
   */
  panTravel: 0.4,
  /** How far off centre a note may start. Kept inside `panTravel`. */
  panSpread: 0.3,
  /** Filter over the whole voice — warm, no top end. */
  filterHz: 1800,
  filterQ: 0.6,
  /** Level of the fifth partial that gives the voice a little body. */
  partialGain: 0.18,
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
   * Register window the flourish selects across, as multipliers on the
   * chosen palette pitch. The palettes sit in D3-C5, so a full octave of
   * climb (1x-2x) would carry the top of the palette to C6, past the
   * ensemble's ceiling. The window is capped at a major third instead
   * (1x-1.26x), so the worst case — the palette's own C5 — climbs to E5, a
   * few semitones over the ceiling rather than a whole octave over it. See
   * `advanceFlourish`'s quantization, which steps in two-semitone degrees
   * across this narrower window rather than in whole octaves.
   */
  registerMinMultiplier: 1,
  registerMaxMultiplier: 2 ** (4 / 12),
  /** The resolving note played once on demotion. */
  resolveDecaySeconds: 2.2,
  resolveGainScale: 0.8,
};

/**
 * The arpeggio soloist. Fires on the same distance trigger as the bell run, so
 * a promotion is paced identically and only the note choice and the envelope
 * change: the notes come from the chord's own tones, climbing, and each is
 * plucked rather than struck — a slower attack and a longer, softer decay than
 * the bell, which is what makes a roll read as harp rather than as chimes.
 */
const ARPEGGIO_TUNING = {
  /** Slower than the bell's 5ms strike, so the note blooms instead of hitting. */
  attackSeconds: 0.03,
  /** One ring, long enough that consecutive notes overlap into a roll. */
  decaySeconds: 1,
  /** Level of the 3x partial. Under the bell's, so the tone stays warm. */
  partialGain: 0.15,
  /**
   * Where the roll starts in the chord-tone ladder, as a fraction of it. The
   * run climbs from here and wraps back rather than starting at the bottom
   * every promotion, so a long solo keeps moving.
   */
  startFraction: 0.25,
};

/**
 * The descant soloist. The promotion is carried by the trail's own sustained
 * voice rather than by any new note: it lifts an octave, opens its filter and
 * swells in, then leads through chord tones for as long as it holds.
 */
export const DESCANT_TUNING = {
  /** How far the sustained voice lifts on promotion. One octave. */
  liftMultiple: 2,
  /**
   * Ceiling on the lifted pitch: C6, an octave above the top of the soprano
   * band the ensemble sings in.
   *
   * The descant is the one voice that rises above the choir, so its ceiling has
   * to sit above the choir's. Capping it at the ensemble's own top (C5) meant
   * every trail from the middle of the tenor band upward — the alto and soprano
   * bands entirely, so half the hue wheel — doubled straight past the cap and
   * fell back to the pitch it started on. The filter opened and the gain leaned
   * in, but the pitch never moved, which is a promotion nobody can hear.
   */
  ceilingHz: 1046.5,
  /** Filter cutoff while the descant holds, so the lift reads as brighter. */
  filterHz: 3200,
  /** Seconds the lift and the brightening take to arrive. */
  swellSeconds: 0.5,
  /** Seconds the return to the trail's own register takes on demotion. */
  returnSeconds: 0.8,
  /**
   * Gain multiplier while the descant holds. The lift and the brightness carry
   * the promotion, so this only keeps the higher octave from sounding thinner
   * than the register it left.
   */
  gain: 1.25,
  /**
   * The audition's chord pad: how many chord tones hold under the lift, how
   * quietly, and for how long. Quiet enough to stay a bed rather than a second
   * subject, and long enough to still be sounding when the lifted tone arrives.
   */
  auditionPadTones: 2,
  auditionPadGain: 0.28,
  auditionPadSeconds: 3.4,
};

/**
 * A chord tone raised into the descant's register: one octave up, unless that
 * would carry it over the ensemble's ceiling, in which case it stays where it
 * is. Falling back to the unlifted tone rather than to something between the
 * two is deliberate — a partial lift lands off the octave and reads as out of
 * tune, where staying put reads as a voice already at the top of its range.
 */
export function descantLift(pitch: number): number {
  const lifted = pitch * DESCANT_TUNING.liftMultiple;
  return lifted > DESCANT_TUNING.ceilingHz ? pitch : lifted;
}


/** Click-bell pitches used whenever the chord progression is not rotating. */
const FIXED_BELL_SCALE = [
  293.66, // D4
  349.23, // F4
  392.0,  // G4
  440.0,  // A4
  523.25, // C5
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
  /**
   * The choral part this trail sings, from the hue of its colour. Constrains
   * both its home tone and its direction-derived pitches, so the crowd spreads
   * into an arrangement instead of crowding one octave.
   */
  band: RegisterBand;
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
  /**
   * True while this voice is singing the descant, so the frame it stops is
   * recognised as the return and glides back rather than waiting out the note
   * interval like an ordinary pitch change.
   */
  descanting: boolean;
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
  /**
   * A context supplied by the caller instead of one the engine opens itself.
   *
   * The only reason this exists is offline rendering: an `OfflineAudioContext`
   * renders the whole graph to a buffer faster than real time, which is how a
   * scene gets turned into a file without playing it. Nothing about the
   * synthesis changes — the engine builds the same graph either way — so a
   * caller that passes nothing gets exactly the live behaviour.
   */
  private readonly providedCtx: BaseAudioContext | null;
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
  /** When the harsh crossing variant last fired, for its own hard rate limit. */
  private lastHarshCrossingMs = Number.NEGATIVE_INFINITY;
  /**
   * Recent total scene motion as [tickMs, summed px/frame]. Stands in for the
   * energy arc when it is off, so the crossing variant still tracks how busy
   * the canvas is.
   */
  private recentSceneMotion: Array<[number, number]> = [];
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
  /**
   * When the spotlight last ran, so a tick's real length is known. The
   * promotion thresholds are per-reference-frame, and playback ticks at
   * anything from 60fps to the 250ms hidden-tab fallback.
   */
  private lastSpotlightTickMs: number | null = null;
  /** Per-trail smoothed spotlight gain multiplier, so ramps stay continuous. */
  private spotlightGains: Map<number, number> = new Map();
  /** Flourish bookkeeping for the trail currently soloing. */
  private flourish: FlourishState | null = null;
  /** One-shot flourish notes still ringing. */
  private flourishNotes: Set<FlourishNote> = new Set();
  /**
   * A buffer of white noise, the source every percussion sound filters. Built
   * once and shared: each playback gets its own BufferSourceNode, but they all
   * read the same samples, so a burst of ticks does not allocate a buffer per
   * keystroke.
   */
  private noiseBuffer: AudioBuffer | null = null;
  /** Index into CHORD_PROGRESSION, and when the current chord started. */
  private chordIndex = 0;
  private chordStartedMs = 0;
  /**
   * Palette every sounding voice was last led onto. When it differs from the
   * one in force the progression has turned since the last re-lead, which is
   * what `releadSoundingVoices` watches for.
   */
  private lastReleadScale: number[] | null = null;
  /** Smoothed 0-1 scene energy driving the swell. */
  private energy = 0;
  private lastEnergyTickMs: number | null = null;
  /** Trails that have already sounded an arrival, and when they last did. */
  private arrivalTimesMs: Map<number, number> = new Map();
  /** Chime seed per trail, so its arrival and departure share one pattern. */
  private arrivalSeeds: Map<number, number> = new Map();
  /**
   * Band a trail chimed in on arrival, so its departure leaves in the same
   * register. Read at retirement, when the trail's frame — and with it the
   * colour the band came from — is already gone.
   */
  private arrivalBands: Map<number, RegisterBand> = new Map();
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
  /**
   * Whoever is drawing the scene, told about each sound as it is scheduled.
   * Optional — nothing in the engine depends on anybody listening.
   */
  private noticeListener: SoundNoticeListener | null = null;
  /** The bass pedal voices currently sounding — two only while crossfading. */
  private bassPedalVoices: BassPedalVoice[] = [];
  /** Chord root the pedal is currently holding, so it only moves on a change. */
  private bassPedalFrequency: number | null = null;
  /**
   * The cantus firmus, when it is running. Null whenever it is switched off,
   * which is also how it is stopped — nothing else holds a reference.
   *
   * `pitch` is the tone the line last sang, and it is the only state the voice
   * leading needs: each new note is the nearest palette tone to it, so the
   * line walks by a step at a time however the chords move underneath.
   */
  private cantus: {
    variant: CantusVariant;
    pitch: number | null;
    /** Second voice's last tone, for the duet. Null for the single-voice variants. */
    partnerPitch: number | null;
    /** Tick time the next note is due, and the one after that for the duet. */
    nextNoteMs: number;
    nextPartnerNoteMs: number;
    /** Counter feeding the pan and interval jitter, so the line is not on a grid. */
    noteCount: number;
  } | null = null;
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

  /**
   * `ctx` lets a caller render the engine into a context it owns — an
   * `OfflineAudioContext`, for turning a scene into a file. Omit it and the
   * engine opens its own live `AudioContext`, which is what every page does.
   */
  constructor(ctx?: BaseAudioContext) {
    this.providedCtx = ctx ?? null;
  }

  async init(): Promise<void> {
    if (this.ctx) return;

    // An offline context has no `resume` and never suspends, but every node
    // factory the engine uses is on `BaseAudioContext`, so the graph below is
    // identical either way. The cast keeps the rest of the class typed against
    // the live context it usually holds.
    this.ctx = (this.providedCtx ?? new AudioContext()) as AudioContext;

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
    // An offline context is rendered rather than played, so it has no resume
    // to call and never reaches this state in the first place.
    if (this.ctx.state === "suspended" && this.ctx.resume) {
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

  /**
   * Listen for the sounds the engine commits to, so a visual standing for a
   * sound is fired by that sound rather than by a second copy of the rules
   * deciding when it should have happened. Pass null to stop listening.
   */
  setSoundNoticeListener(listener: SoundNoticeListener | null): void {
    this.noticeListener = listener;
  }

  /** Tell the listener about a sound. A throwing listener never breaks audio. */
  private emitNotice(notice: SoundNotice): void {
    if (!this.noticeListener) return;
    try {
      this.noticeListener(notice);
    } catch (err) {
      console.warn("Sound notice listener threw:", err);
    }
  }

  /** Update sound configuration (mode, chord voicing, instruments, crossings) */
  setConfig(config: SoundConfigInput): void {
    const prevChord = this.config.chordVoicing;
    const prevMode = this.config.mode;
    const prevTrailVoices = this.config.trailVoices;
    const prevProgression = this.config.progression;
    const { crossingDissonance, ...rest } = config;
    Object.assign(this.config, rest);

    // A different rotation is a different set of chords, so the index into the
    // old one means nothing. Starting from the top also means switching
    // progressions always begins on that rotation's home chord.
    if (this.config.progression !== prevProgression) {
      this.chordIndex = 0;
      this.chordStartedMs = this.lastTickMs;
    }

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
      this.lastHarshCrossingMs = Number.NEGATIVE_INFINITY;
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
      // The seeds, bands and rate budget are audio state and are dropped. The
      // arrival times are not: they are how the engine knows which trails have
      // announced themselves, which decides whether an arrival happened at all
      // and so is still reported while the chime is off.
      this.arrivalSeeds.clear();
      this.arrivalBands.clear();
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
      this.lastSpotlightTickMs = null;
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
      // Notes mode holds no sustained voices of its own, but the map may still
      // carry voices from a mode switch, so the palette stays tracked here too.
      this.releadSoundingVoices();
      this.updateEnergyReverb();
      // The accent instruments sit outside the mode split — they mark scene
      // and structure, not trail motion, so they sound the same either way.
      this.updateBassPedal();
      this.updateArrivals(elapsedMs, activeTrails);
      this.updateCantus(elapsedMs);
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
    // Before the voice loop: a rotation must reach every sounding voice, not
    // only the ones whose trails happen to select a new note this frame.
    this.releadSoundingVoices();
    this.updateEnergyReverb();
    this.updateBassPedal();
    this.updateArrivals(elapsedMs, activeTrails);
    this.updateCantus(elapsedMs);
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
      const chosenPitch = fingerprint
        ? this.applyHomeToneBias(directionPitch, fingerprint)
        : directionPitch;
      // The descant is the promotion itself: while this trail holds the
      // spotlight its own sustained voice sings a chord tone an octave up,
      // rather than a separate run of notes sounding over it.
      const frequency = this.descantPitchFor(
        frame.trailIndex,
        chosenPitch,
        scale,
      );
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

      // The descant's lift and its return are the promotion itself, so they
      // move on the promotion rather than waiting out the note interval — a
      // trail sustaining one pitch would otherwise hold the wrong octave for
      // as long as it kept going.
      const descantMoved =
        this.isDescanting(frame.trailIndex) !== voice.descanting;
      if (
        frequency !== voice.currentFrequency &&
        (descantMoved || elapsedMs - voice.lastNoteTimeMs > MIN_NOTE_INTERVAL_MS)
      ) {
        // The first pitch this voice takes from a new palette is its move into
        // the new chord, so it slides rather than snapping. A voice that has
        // already spoken in this palette moves at the ordinary note rate.
        const isVoiceLeadingMove =
          voice.lastPitchScale !== null && voice.lastPitchScale !== scale;
        this.setVoiceFrequency(
          voice,
          frequency,
          descantMoved
            ? this.isDescanting(frame.trailIndex)
              ? DESCANT_TUNING.swellSeconds
              : DESCANT_TUNING.returnSeconds
            : isVoiceLeadingMove
              ? VOICE_LEADING_GLIDE_SECONDS
              : NOTE_GLIDE_SECONDS,
        );
        voice.lastPitchScale = scale ?? null;
        voice.lastNoteTimeMs = elapsedMs;
        voice.currentFrequency = frequency;
      }
      voice.descanting = this.isDescanting(frame.trailIndex);

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

  /**
   * Sound a crossing as tension that resolves. The chord tone the two trails
   * meet on is held against the step above it, and the upper voice then falls
   * onto it — a suspension, drawn from the harmony in force rather than from a
   * fixed ratio against nothing.
   *
   * How much tension the moment can carry is decided by the scene: a quiet
   * canvas gets a beating shimmer instead of an interval, and only a genuinely
   * busy one earns the harsh tritone.
   */
  private triggerCrossingDissonance(
    trailIndexA: number,
    trailIndexB: number,
    x: number,
    y: number,
    distance: number,
    forcedVariant?: CrossingTensionVariant,
  ): void {
    if (!this.ctx || !this.masterGain) return;

    const variant = forcedVariant ?? this.crossingTensionVariant();
    // Closer crossings press harder, the same proximity weighting the old
    // dissonance used.
    const proximity =
      distance >= CROSSING_DISTANCE_THRESHOLD
        ? 1
        : 1 - distance / CROSSING_DISTANCE_THRESHOLD;

    // The chord tone the figure sits on. With fingerprints on this is one of
    // the crossing trails' own home tones, so the tension is between the two
    // voices that actually met; otherwise it is the chord root.
    const home = this.homeToneFor(trailIndexA) ?? this.homeToneFor(trailIndexB);
    const base =
      (home ?? this.currentRoot()) *
      CROSSING_TENSION_TUNING.registerMultiplier;

    if (variant === "shimmer") {
      this.triggerCrossingShimmer(base, x, proximity, trailIndexA + trailIndexB);
      return;
    }
    if (variant === "harsh") {
      this.triggerCrossingHarsh(base, x, y, proximity);
      return;
    }
    this.triggerCrossingSuspension(base, x, proximity);
  }

  /**
   * The suspension: a chord tone and the step above it held together, then the
   * upper voice falling onto the chord tone with a soft decay. Tension, then
   * release, both inside the current pitch collection.
   */
  private triggerCrossingSuspension(
    base: number,
    x: number,
    proximity: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const {
      gain,
      attackSeconds,
      suspensionSeconds,
      resolutionDecaySeconds,
      upperVoiceGain,
    } = CROSSING_TENSION_TUNING;
    const peak = gain * proximity;
    const now = ctx.currentTime;
    const endsAt = now + attackSeconds + suspensionSeconds + resolutionDecaySeconds;

    // The chord tone underneath, held plainly through the whole figure.
    const lower = this.buildCrossingTone(base, x, peak, {
      attackSeconds,
      holdSeconds: suspensionSeconds,
      decaySeconds: resolutionDecaySeconds,
    });

    // The suspended voice: the step above, falling onto the chord tone at the
    // end of the hold. Stepwise and downward — a suspension that resolved
    // upward would read as a new note rather than as a release.
    const suspended = this.suspensionPitch(base);
    const upper = this.buildCrossingTone(
      suspended,
      x,
      peak * upperVoiceGain,
      {
        attackSeconds,
        holdSeconds: suspensionSeconds,
        decaySeconds: resolutionDecaySeconds,
      },
    );
    if (upper) {
      // The resolution itself: the upper voice glides down onto the tone below
      // it once the suspension has been held.
      upper.oscillator.frequency.setValueAtTime(
        suspended,
        now + attackSeconds + suspensionSeconds,
      );
      upper.oscillator.frequency.linearRampToValueAtTime(
        base,
        now + attackSeconds + suspensionSeconds + 0.12,
      );
    }

    for (const tone of [lower, upper]) {
      tone?.oscillator.stop(endsAt + 0.05);
    }
  }

  /**
   * The gentle variant: two tones a few Hz apart on the same chord tone. No
   * interval at all — the tension is the beating between them, which a quiet
   * canvas can carry where a second could not.
   */
  private triggerCrossingShimmer(
    base: number,
    x: number,
    proximity: number,
    seed: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const {
      gain,
      attackSeconds,
      shimmerMinBeatHz,
      shimmerMaxBeatHz,
      shimmerGainScale,
      shimmerDecaySeconds,
    } = CROSSING_TENSION_TUNING;
    const peak = gain * shimmerGainScale * proximity;
    // Beat rate from the pair, so the same two trails shimmer the same way.
    const beatHz =
      shimmerMinBeatHz +
      hashUnit(hashIdentity(`crossing-${seed}`), 13) *
        (shimmerMaxBeatHz - shimmerMinBeatHz);

    const envelope = {
      attackSeconds,
      holdSeconds: 0,
      decaySeconds: shimmerDecaySeconds,
    };
    const tones = [
      this.buildCrossingTone(base, x, peak, envelope),
      this.buildCrossingTone(base + beatHz, x, peak, envelope),
    ];
    const endsAt = ctx.currentTime + attackSeconds + shimmerDecaySeconds;
    for (const tone of tones) tone?.oscillator.stop(endsAt + 0.05);
  }

  /**
   * The harsh variant, reserved for busy scenes and rate-limited hard: the
   * tritone the flavor used to fire on every crossing. It still does not
   * resolve, which is the point — at high energy an unresolved clash reads as
   * the scene straining rather than as a wrong note.
   */
  private triggerCrossingHarsh(
    base: number,
    x: number,
    y: number,
    proximity: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const { gain, attackSeconds, harshGainScale, harshDecaySeconds } =
      CROSSING_TENSION_TUNING;
    const peak = gain * harshGainScale * proximity;
    // Height on the canvas still colours the strike, as it did before.
    const lift = 1 + (1 - Math.min(1, y / (window.innerHeight || 800))) * 0.5;
    const envelope = {
      attackSeconds,
      holdSeconds: 0,
      decaySeconds: harshDecaySeconds,
    };
    const tones = [
      this.buildCrossingTone(base * lift, x, peak, envelope),
      this.buildCrossingTone(base * lift * Math.SQRT2, x, peak, envelope),
    ];
    const endsAt = ctx.currentTime + attackSeconds + harshDecaySeconds;
    for (const tone of tones) tone?.oscillator.stop(endsAt + 0.05);
  }

  /**
   * The pitch a suspension hangs on: the diatonic step above the chord tone,
   * drawn from the collection the current progression uses so dorian
   * crossings hang on B natural where natural-minor ones hang on Bb.
   */
  private suspensionPitch(base: number): number {
    const collection = this.currentProgression().collection;
    // The base has been lifted into the crossing register, so fold it back to
    // find its neighbour in the collection's own octave, then lift the result
    // by the same amount.
    const register = CROSSING_TENSION_TUNING.registerMultiplier;
    const neighbor = upperNeighbor(base / register, collection);
    // Nothing above it in the collection means the tone is already at the top;
    // a whole tone up is still a step, and still lands inside the key an
    // octave higher.
    return neighbor === null ? base * Math.pow(2, 2 / 12) : neighbor * register;
  }

  /**
   * One sine voice of a crossing figure, on an attack/hold/decay envelope,
   * panned at the crossing and routed to the crossing bus. Returns the nodes
   * so a caller can schedule pitch moves on it (the suspension's resolution)
   * and stop it.
   */
  private buildCrossingTone(
    frequency: number,
    x: number,
    peakGain: number,
    envelope: {
      attackSeconds: number;
      holdSeconds: number;
      decaySeconds: number;
    },
  ): { oscillator: OscillatorNode; gainNode: GainNode } | null {
    const ctx = this.ctx;
    if (!ctx) return null;

    const now = ctx.currentTime;
    const { attackSeconds, holdSeconds, decaySeconds } = envelope;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = frequency;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + attackSeconds);
    if (holdSeconds > 0) {
      gain.gain.setValueAtTime(peakGain, now + attackSeconds + holdSeconds);
    }
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + attackSeconds + holdSeconds + decaySeconds,
    );

    const pan = ctx.createStereoPanner();
    pan.pan.value = positionToPan(x, this.canvasWidth);

    osc.connect(gain);
    gain.connect(pan);
    pan.connect(this.busFor("crossing"));
    osc.start(now);

    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
        pan.disconnect();
      } catch {
        /* already disconnected */
      }
    };

    return { oscillator: osc, gainNode: gain };
  }

  /**
   * Which tension figure this crossing sounds, from how busy the scene is.
   *
   * Reads the energy arc's own value when it is running, and otherwise falls
   * back to a rolling average of recent scene motion — the variant choice
   * should track the room whether or not the arc happens to be switched on.
   */
  private crossingTensionVariant(): CrossingTensionVariant {
    const energy = this.crossingSceneEnergy();
    const {
      gentleEnergyThreshold,
      harshEnergyThreshold,
      harshMinIntervalMs,
    } = CROSSING_TENSION_TUNING;

    if (energy < gentleEnergyThreshold) return "shimmer";
    if (energy >= harshEnergyThreshold) {
      // Rate-limited far harder than the per-pair cooldown: the harsh variant
      // is an occasional strain in a busy scene, not its texture.
      const sinceHarsh = this.lastTickMs - this.lastHarshCrossingMs;
      if (sinceHarsh >= harshMinIntervalMs) {
        this.lastHarshCrossingMs = this.lastTickMs;
        return "harsh";
      }
    }
    return "suspension";
  }

  /** 0-1 scene busyness behind the crossing variant choice. */
  private crossingSceneEnergy(): number {
    if (this.config.energyArc) return this.energy;
    const { motionWindowMs, motionFullScale } = CROSSING_TENSION_TUNING;
    const cutoff = this.lastTickMs - motionWindowMs;
    let sum = 0;
    let count = 0;
    for (const [time, motion] of this.recentSceneMotion) {
      if (time < cutoff) continue;
      sum += motion;
      count++;
    }
    if (count === 0) return 0;
    return Math.min(1, sum / count / motionFullScale);
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
      descanting: false,
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
    const band = this.bandForFrame(frame);
    const fingerprint: TrailFingerprint = {
      hash,
      // A brand-new trail takes its seat from its identity; only trails already
      // sounding are led from where they are. The seat is then voiced in the
      // part its colour assigns it.
      homeTone: foldPitchIntoBand(homeToneForHash(hash, scale), band),
      homeToneScale: scale,
      band,
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

  /**
   * The choral part a trail sings, read off the colour it is drawn in under
   * whichever mapping `REGISTER_MAPPING` selects. A colour the parser does not
   * recognise falls to alto — the middle of the range — rather than silently
   * dropping the trail into the bass.
   */
  private bandForFrame(frame: TrailSoundFrame): RegisterBand {
    const hsl = parseColorToHsl(frame.color);
    return hsl === null ? "alto" : registerBandForColor(hsl, REGISTER_MAPPING);
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
    // Lead against the palette folded into this trail's band, so "nearest" is
    // measured among the tones the trail can actually sing. Leading in the raw
    // palette and folding afterwards would let a one-step move in D3-C5 come
    // out as an octave leap once folded.
    const inBand = scale.map((pitch) =>
      foldPitchIntoBand(pitch, fingerprint.band),
    );
    fingerprint.homeTone = leadHomeTone(fingerprint.homeTone, inBand);
    fingerprint.homeToneScale = scale;
    return fingerprint.homeTone;
  }

  /** The dial's position, clamped, so a caller cannot push past either end. */
  private traceability(): number {
    return Math.min(1, Math.max(0, this.config.traceability));
  }

  /**
   * How often a note change lands on the trail's home tone rather than on the
   * note its heading picked. Falls as the dial moves toward traceable, so the
   * crowd stops collectively voicing the chord and each trail's own motion
   * comes through instead.
   */
  private homeToneBias(): number {
    const { homeToneBias } = TRAIL_VOICE_TUNING;
    return (
      homeToneBias +
      (TRACEABILITY_LIMITS.homeToneBias - homeToneBias) * this.traceability()
    );
  }

  /**
   * Multiplier on how long a swell takes to start and to build. Shortens
   * toward the traceable end so a gesture is heard as it happens rather than
   * arriving as part of a slower ensemble breath.
   */
  private swellTimeScale(): number {
    return 1 + (TRACEABILITY_LIMITS.swellTimeScale - 1) * this.traceability();
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
    // Both branches are voiced in the trail's own part: the melody a trail
    // sings still comes from its motion, but it sings it in its own register.
    return roll < this.homeToneBias()
      ? home
      : foldPitchIntoBand(frequency, fingerprint.band);
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
    // That is a question of whether the trail left, so it gates the notice
    // too; the audio toggle only decides whether the chime sounds.
    const departed =
      this.lastTickMs >= this.arrivalsSuppressedUntilMs &&
      this.arrivalTimesMs.has(trailIndex);
    if (departed && !this.config.trailArrivals) {
      this.emitNotice({
        kind: "arrival",
        trailIndex,
        rising: false,
        noteOffsetsSeconds: [],
        played: false,
      });
    }
    if (departed && this.config.trailArrivals) {
      const position = this.prevPositions.get(trailIndex);
      // Departure reuses the arrival's seed and band, so a trail leaves in the
      // same voice and the same register it arrived in.
      this.triggerArrivalFigure(
        position?.x ?? this.canvasWidth / 2,
        false,
        this.arrivalSeeds.get(trailIndex) ?? hashIdentity(String(trailIndex)),
        this.arrivalBands.get(trailIndex) ?? "alto",
        0,
        trailIndex,
      );
    }
    this.arrivalTimesMs.delete(trailIndex);
    this.arrivalSeeds.delete(trailIndex);
    this.arrivalBands.delete(trailIndex);
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
    let motion = 0;
    for (const frame of activeTrails) {
      const prev = this.prevPositions.get(frame.trailIndex);
      if (!prev) continue;
      motion += computeVelocity(prev.x, prev.y, frame.x, frame.y);
    }

    // Recorded whether or not the arc is running: crossings read this as their
    // fallback measure of how busy the scene is.
    this.recentSceneMotion.push([elapsedMs, motion]);
    const motionCutoff =
      elapsedMs - CROSSING_TENSION_TUNING.motionWindowMs;
    while (
      this.recentSceneMotion.length > 0 &&
      this.recentSceneMotion[0][0] < motionCutoff
    ) {
      this.recentSceneMotion.shift();
    }

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

    const progression = this.currentProgression();
    // Progressions with fewer chords hold each one longer, so a two-chord
    // rotation is weather rather than a fast alternation.
    let dwell = CHORD_DWELL_MS * progression.dwellScale;
    if (this.config.energyArc) {
      const { dwellAtLowEnergy, dwellAtHighEnergy } = ENERGY_TUNING;
      dwell *=
        dwellAtLowEnergy + (dwellAtHighEnergy - dwellAtLowEnergy) * this.energy;
    }

    if (elapsedMs - this.chordStartedMs >= dwell) {
      this.chordIndex = (this.chordIndex + 1) % progression.chords.length;
      this.chordStartedMs = elapsedMs;
    }
  }

  /**
   * Move every sounding voice onto the palette now in force.
   *
   * A voice only re-pitches when its trail's motion selects a different note,
   * so a trail that has stalled — faded but not released, which is what a
   * paused cursor does while swells are on — holds its previous chord's tone
   * for the whole of the next chord. That held tone is the discordant string
   * heard over a rotation, and the swell keeps it audible. Re-leading here
   * makes the rotation reach the whole ensemble rather than only the trails
   * that happen to still be moving.
   *
   * Each voice glides to the nearest tone of the new palette folded into its
   * own register band, over the same `VOICE_LEADING_GLIDE_SECONDS` a moving
   * voice uses, so the ensemble leans into the chord rather than snapping onto
   * it. A voice already inside the new palette is left alone.
   */
  private releadSoundingVoices(): void {
    const scale = this.currentScale();
    if (!scale) {
      this.lastReleadScale = null;
      return;
    }
    if (this.lastReleadScale === scale) return;
    this.lastReleadScale = scale;

    for (const [trailIndex, voice] of this.voices) {
      if (!voice.oscillator || voice.currentFrequency <= 0) continue;

      // Fold the palette into the band this trail sings in, so "nearest" is
      // measured among the tones the voice can actually take. Without a
      // fingerprint the voice sings the palette as written.
      const band = this.fingerprints.get(trailIndex)?.band;
      const candidates = band
        ? scale.map((pitch) => foldPitchIntoBand(pitch, band))
        : scale;

      const led = leadHomeTone(voice.currentFrequency, candidates);
      if (led === voice.currentFrequency) continue;

      this.setVoiceFrequency(voice, led, VOICE_LEADING_GLIDE_SECONDS);
      voice.currentFrequency = led;
      voice.lastPitchScale = scale;
      // The glide is the note change, so the ordinary note-interval guard must
      // not let motion re-pitch this voice out from under it mid-slide.
      voice.lastNoteTimeMs = this.lastTickMs;
    }
  }

  /** The rotation currently selected. */
  private currentProgression(): Progression {
    return progressionById(this.config.progression);
  }

  /** The chord in force this frame. */
  private currentChord(): Chord {
    const chords = this.currentProgression().chords;
    return chords[this.chordIndex % chords.length];
  }

  /** The pitch palette for this frame — the base scale unless rotating. */
  private currentScale(): number[] | undefined {
    if (!this.config.chordRotation) return undefined;
    return scaleForChord(this.currentChord());
  }

  /**
   * Pitch set for click bells. While the progression rotates, bells draw from
   * the current chord's upper register so a click always lands consonant with
   * whatever the sustained voices are holding. With rotation off the bells
   * keep their original fixed D minor ring.
   */
  private currentBellScale(): number[] {
    if (!this.config.chordRotation) return FIXED_BELL_SCALE;
    return bellScaleForChord(this.currentChord());
  }

  /** Name of the chord currently in force (diagnostics). */
  getCurrentChordName(): string {
    return this.config.chordRotation ? this.currentChord().name : "Dm";
  }

  /** The rotation currently selected (diagnostics, and the pad's readout). */
  getProgressionId(): ProgressionId {
    return this.config.progression;
  }

  /** Current 0-1 scene energy (diagnostics). */
  getEnergy(): number {
    return this.energy;
  }

  /**
   * Move the story-to-traceable dial. 0 holds the tuned arrangement; 1 lets
   * each trail's own motion through at the cost of the crowd voicing one chord.
   */
  setTraceability(traceability: number): void {
    this.setConfig({ traceability });
  }

  /** Where the dial currently sits, clamped to 0-1. */
  getTraceability(): number {
    return this.traceability();
  }

  /**
   * The chord tone a trail is currently biased toward, or null when it has no
   * fingerprint (diagnostics, and how the playground labels each trail).
   */
  getHomeTone(trailIndex: number): number | null {
    if (!this.config.trailVoices) return null;
    return this.homeToneFor(trailIndex);
  }

  /**
   * The choral part a trail is singing, or null when it has no fingerprint.
   * The playground shows this beside the home tone so the colour-to-register
   * mapping can be checked by eye against what is being heard.
   */
  getRegisterBand(trailIndex: number): RegisterBand | null {
    if (!this.config.trailVoices) return null;
    return this.fingerprints.get(trailIndex)?.band ?? null;
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
      this.lastSpotlightTickMs = null;
      return;
    }

    const cutoff = elapsedMs - SPOTLIGHT_TUNING.velocityWindowMs;

    // How long this tick covered. The thresholds below are expressed in pixels
    // per reference frame, so the raw per-tick distance has to be converted to
    // that unit before it is compared against them — otherwise the same gesture
    // measures ~15x larger on a 250ms hidden-tab tick than on a 60fps one, and
    // the promotion floor means a different speed on every page and tab state.
    const tickIntervalMs =
      this.lastSpotlightTickMs === null
        ? REFERENCE_FRAME_DURATION_MS
        : Math.max(1, Math.min(500, elapsedMs - this.lastSpotlightTickMs));
    this.lastSpotlightTickMs = elapsedMs;
    const perFrame = REFERENCE_FRAME_DURATION_MS / tickIntervalMs;

    let soloistIndex: number | null = null;
    let soloistVelocity = 0;
    const present = new Set<number>();
    for (const frame of activeTrails) {
      const prev = this.prevPositions.get(frame.trailIndex);
      // A trail with no previous position has no measurable velocity yet; it
      // is sampled next frame rather than counted as still.
      if (!prev) continue;
      present.add(frame.trailIndex);
      const velocity =
        computeVelocity(prev.x, prev.y, frame.x, frame.y) * perFrame;
      let samples = this.spotlightVelocitySamples.get(frame.trailIndex);
      if (!samples) {
        samples = [];
        this.spotlightVelocitySamples.set(frame.trailIndex, samples);
      }
      samples.push([elapsedMs, velocity]);

      const previousSmoothed = this.spotlightSmoothedVelocities.get(
        frame.trailIndex,
      );
      // The smoothing constant is a duration, so the step has to be the tick's
      // real length. A fixed FRAME_MS makes a slow tick smooth far too gently,
      // holding the EMA down for seconds after a sweep has already started.
      const rate = Math.min(
        1,
        tickIntervalMs / SPOTLIGHT_TUNING.velocitySmoothingMs,
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
    const descanting = this.isDescanting(trailIndex);
    const target = !hasSoloist
      ? 1
      : isSoloist
        ? descanting
          ? // The descant has no discrete notes to step back for: its own
            // sustained voice is the promotion, so it leans in rather than out.
            SPOTLIGHT_TUNING.soloistGain * DESCANT_TUNING.gain
          : // The soloist's sustained voice steps back while it flourishes, so
            // the discrete notes carry the promotion instead of competing with
            // a louder drone from the same trail.
            SPOTLIGHT_TUNING.soloistGain * FLOURISH_TUNING.sustainedDuck
        : SPOTLIGHT_TUNING.duckedGain;

    const current = this.spotlightGains.get(trailIndex) ?? 1;
    // Ducking engages faster than it recovers, so the soloist reads clearly
    // but the scene does not pump back up the instant they slow. A demoted
    // soloist gets its own, slower walk back so the drone swells in behind
    // the resolving note rather than snapping back.
    const durationSeconds = descanting
      ? // The descant enters on its own swell and leaves on its own return, so
        // the gain moves with the lift instead of on the spotlight's cue-speed
        // attack.
        target > current
          ? DESCANT_TUNING.swellSeconds
          : DESCANT_TUNING.returnSeconds
      : target < current
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
      peakScale,
      releaseSeconds,
      movingVelocity,
      motionGraceMs,
    } = SWELL_TUNING;
    // Only the onset and the build shorten with the dial. The release is how
    // a stopped trail falls away, which is a property of the instrument rather
    // than of how traceable the scene should be.
    const timeScale = this.swellTimeScale();
    const onsetMs = SWELL_TUNING.onsetMs * timeScale;
    const crescendoSeconds = SWELL_TUNING.crescendoSeconds * timeScale;

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

  /** Whether this trail is currently singing the descant. */
  private isDescanting(trailIndex: number): boolean {
    return (
      this.config.spotlight &&
      this.config.soloistVoice === "descant" &&
      this.spotlightTrailIndex === trailIndex
    );
  }

  /**
   * The pitch a trail's sustained voice takes this frame.
   *
   * Unchanged for every trail but the descanting soloist. For that one the
   * pitch is led onto the nearest tone of the chord — never a colour tone, so
   * the lifted line stays consonant with the bed it is rising out of — and
   * then raised an octave, capped at the ensemble's own ceiling so a trail
   * already singing near the top does not climb over it.
   */
  private descantPitchFor(
    trailIndex: number,
    pitch: number,
    scale: number[] | undefined,
  ): number {
    if (!this.isDescanting(trailIndex)) return pitch;
    return descantLift(
      nearestChordTone(pitch, scale ?? this.flourishPalette()),
    );
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
          // A descant hands its brightness back over its own return, so the
          // lift and the colour fall away together rather than at two rates.
          this.config.soloistVoice === "descant"
            ? DESCANT_TUNING.returnSeconds
            : SPOTLIGHT_TUNING.releaseSeconds,
        );
      }
      return;
    }

    // The descant's brightness is a fixed opening rather than a velocity
    // sweep: its promotion is a swell into a higher, brighter register, and a
    // filter tracking speed on top of that would make the lift waver.
    if (this.config.soloistVoice === "descant") {
      if (!voice.spotlightBrightened) {
        voice.spotlightBrightened = true;
        this.rampParam(
          voice.filterNode.frequency,
          Math.max(instrument.filterFrequency, DESCANT_TUNING.filterHz),
          DESCANT_TUNING.swellSeconds,
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
   *
   * The debounce and the still-here test decide whether a trail arrived at
   * all, so a suppression there is silent for a visual too. The audio toggle
   * and the rate cap decide only whether the chime sounds, so an arrival they
   * suppress is still reported — with `played` false.
   */
  private updateArrivals(
    elapsedMs: number,
    activeTrails: TrailSoundFrame[],
  ): void {
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
      // The arrival happened either way. The audio toggle and the rate cap
      // decide only whether it is heard, so a suppression here still reports
      // the arrival with `played` false.
      if (!this.config.trailArrivals || !this.claimArrivalSlot(elapsedMs)) {
        this.emitNotice({
          kind: "arrival",
          trailIndex: frame.trailIndex,
          rising: true,
          noteOffsetsSeconds: [],
          played: false,
        });
        continue;
      }
      // Seeded from the trail's own identity, so a participant's chime is
      // recognisably theirs every time they appear.
      this.arrivalSeeds.set(
        frame.trailIndex,
        hashIdentity(this.identityKeyFor(frame)),
      );
      // The band comes off the frame's colour rather than off the trail-voice
      // register map, so an arrival is voiced correctly even when the
      // sustained voices are switched off and no band has been assigned.
      const band = this.bandForFrame(frame);
      this.arrivalBands.set(frame.trailIndex, band);
      this.triggerArrivalFigure(
        frame.x,
        true,
        this.arrivalSeeds.get(frame.trailIndex)!,
        band,
        0,
        frame.trailIndex,
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
   * quick notes for an arrival, a shorter falling one for a departure, voiced
   * in the arriving trail's own register band.
   *
   * The pattern is drawn from `seed`, so the same trail chimes the same way
   * every time it appears while different trails sound distinct. The band
   * decides the register and the timbre, so a bass trail knocks and a soprano
   * one rings.
   */
  private triggerArrivalFigure(
    x: number,
    rising: boolean,
    seed: number,
    band: RegisterBand,
    /** Push the whole cluster into the future, for auditioning two in a row. */
    startDelaySeconds = 0,
    /**
     * The trail this figure belongs to. Given for a real arrival or departure
     * and omitted by the audition buttons, which chime for no trail — only a
     * figure with a trail behind it is worth reporting to a visual.
     */
    trailIndex?: number,
  ): void {
    if (!this.ctx) {
      // No graph to sound on, but the arrival still happened.
      if (trailIndex !== undefined) {
        this.emitNotice({
          kind: "arrival",
          trailIndex,
          rising,
          noteOffsetsSeconds: [],
          played: false,
        });
      }
      return;
    }

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
      bandTimbre,
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

    // Soprano is the register the chime was tuned in, so it is the reference:
    // the palette top at registerMultiplier, unchanged. The lower parts drop
    // from there by whole octaves, which keeps every chime note the same
    // pitch class as the soprano one — the same chime, sung lower, rather
    // than a different figure.
    //
    // The octave step itself is fixed at the ARRIVAL_REGISTER_STEP baseline
    // rather than at `registerMultiplier`: bass, tenor and alto were each
    // tuned to land inside their own REGISTER_BAND_RANGES against that
    // baseline, and those bands did not move when the soprano ceiling did.
    // Deriving the step from `registerMultiplier` directly would drag every
    // lower band down with it whenever the ceiling changes.
    const octavesBelowSoprano =
      REGISTER_BANDS.length - 1 - REGISTER_BANDS.indexOf(band);
    const bandMultiplier =
      band === "soprano"
        ? registerMultiplier
        : ARRIVAL_REGISTER_STEP / 2 ** octavesBelowSoprano;

    const gain =
      noteGain * (rising ? 1 : departureGainScale) * bandTimbre.gainScale[band];

    let delaySeconds = startDelaySeconds;
    // When each note lands, collected as the cluster is scheduled so a visual
    // can be paced by the chime it stands for rather than by its own timing.
    const noteOffsetsSeconds: number[] = [];
    pitches.forEach((pitch, order) => {
      noteOffsetsSeconds.push(delaySeconds);
      const decay =
        (rising
          ? minDecaySeconds +
            hashUnit(seed, 40 + order) * (maxDecaySeconds - minDecaySeconds)
          : departureDecaySeconds) * bandTimbre.decayScale[band];
      this.triggerFlourishNote(pitch * bandMultiplier, x, gain, decay, {
        delaySeconds,
        attackSeconds,
        partialGain: partialGain * bandTimbre.partialScale[band],
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

    if (trailIndex !== undefined) {
      this.emitNotice({
        kind: "arrival",
        trailIndex,
        rising,
        noteOffsetsSeconds,
        played: true,
      });
    }
  }

  /**
   * A deep resonant note marking one page navigation. Rate-limited globally —
   * a burst of navigations should read as one structural event, not a run.
   */
  triggerNavigation(event: NavigationSoundEvent = {}): void {
    // The notice reports the navigation, not the note, so it is emitted for
    // every navigation the engine is told about — before the audio toggle and
    // before the rate limiter. A visual standing for a page change should be
    // drawn whether or not the gong is switched on; `played` is how a listener
    // that cares about the note tells the two apart.
    const ctx = this.ctx;
    const startTime = ctx?.currentTime ?? 0;
    // Rate-limit against the audio clock rather than the render tick. The
    // navigation views draw no trails, so tick() never runs there and
    // lastTickMs would stay frozen at 0 — every note after the first would
    // measure a zero-length gap and be dropped. ctx.currentTime always
    // advances, whichever view is on screen.
    const nowMs = startTime * 1000;
    const willPlay =
      this.enabled &&
      ctx !== null &&
      this.masterGain !== null &&
      this.config.navigationSounds &&
      nowMs - this.lastNavigationNoteMs >= NAVIGATION_TUNING.minIntervalMs;

    this.emitNotice({
      kind: "navigation",
      trailIndex: event.trailIndex,
      x: event.x,
      played: willPlay,
    });

    if (!willPlay || !ctx) return;
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
        this.auditionChimePair(true);
        return;
      case "trailDeparture":
        this.auditionChimePair(false);
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
        // quantized register selection the soloist uses, at half the
        // velocity that reaches the top register.
        const palette = this.flourishPalette();
        const normalized = 0.5;
        const {
          registerMinMultiplier: registerMin,
          registerMaxMultiplier: registerMax,
        } = FLOURISH_TUNING;
        const octaves =
          Math.round(
            (Math.log2(registerMin) +
              normalized * (Math.log2(registerMax) - Math.log2(registerMin))) *
              6,
          ) / 6;
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
      case "soloistArpeggio": {
        // The whole roll rather than one note of it: an arpeggio is a shape,
        // and a single plucked chord tone says nothing about it.
        const tones = chordTones(this.flourishPalette());
        const start = Math.floor(tones.length * ARPEGGIO_TUNING.startFraction);
        for (let step = 0; step < Math.min(5, tones.length); step++) {
          this.triggerFlourishNote(
            tones[(start + step) % tones.length],
            centre,
            FLOURISH_TUNING.noteGain,
            ARPEGGIO_TUNING.decaySeconds,
            {
              delaySeconds: step * 0.12,
              attackSeconds: ARPEGGIO_TUNING.attackSeconds,
              partialGain: ARPEGGIO_TUNING.partialGain,
            },
          );
        }
        return;
      }
      case "soloistDescant": {
        // The descant has no note of its own to play, so the audition stands
        // one chord tone against the same tone lifted an octave: the interval
        // the promotion opens, heard without needing a scene to promote in.
        //
        // A quiet pad of the neighbouring chord tones holds underneath, because
        // the point of this voice is that it rises above a choir. Two lone
        // tones in sequence demonstrate an octave; the same two over a held
        // chord demonstrate a descant.
        const tones = chordTones(this.flourishPalette());
        if (tones.length === 0) return;
        const base = tones[0];
        const lifted = descantLift(base);
        for (const tone of tones.slice(1, 1 + DESCANT_TUNING.auditionPadTones)) {
          this.triggerFlourishNote(
            tone,
            centre,
            FLOURISH_TUNING.noteGain * DESCANT_TUNING.auditionPadGain,
            DESCANT_TUNING.auditionPadSeconds,
            { attackSeconds: DESCANT_TUNING.swellSeconds },
          );
        }
        this.triggerFlourishNote(base, centre, FLOURISH_TUNING.noteGain, 2, {
          attackSeconds: DESCANT_TUNING.swellSeconds,
        });
        this.triggerFlourishNote(
          lifted,
          centre,
          FLOURISH_TUNING.noteGain * DESCANT_TUNING.gain,
          2,
          { delaySeconds: 0.9, attackSeconds: DESCANT_TUNING.swellSeconds },
        );
        return;
      }
      // Mid-canvas, at the closest distance the detector accepts, so each
      // audition is the loudest version of what a crossing actually sounds.
      // The variant is forced rather than read from scene energy: the point of
      // three buttons is to hear all three without having to arrange for the
      // scene to be quiet or busy enough to trigger them.
      case "crossingShimmer":
        this.triggerCrossingDissonance(0, 1, centre, 0, 0, "shimmer");
        return;
      case "crossingSuspension":
        this.triggerCrossingDissonance(0, 1, centre, 0, 0, "suspension");
        return;
      case "crossingHarsh":
        this.triggerCrossingDissonance(0, 1, centre, 0, 0, "harsh");
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
      case "clickTap":
        this.triggerClickTap(centre, "tap");
        return;
      case "clickTapNoThump":
        this.triggerClickTap(centre, "tapNoThump");
        return;
      case "clickTapHybrid":
        this.triggerClickTap(centre, "hybrid");
        return;
      // Auditioned at mid-window height, which puts the pluck in the middle of
      // the bell palette — the representative note rather than an extreme.
      case "pizzicatoSoft":
        this.triggerPizzicato(centre, this.auditionClickHeight(), "soft");
        return;
      case "pizzicatoCrisp":
        this.triggerPizzicato(centre, this.auditionClickHeight(), "crisp");
        return;
      case "pizzicatoDouble":
        this.triggerPizzicato(centre, this.auditionClickHeight(), "double");
        return;
      case "timpaniRoot":
        this.triggerTimpani(centre, "root");
        return;
      case "timpaniRootFifth":
        this.triggerTimpani(centre, "rootFifth");
        return;
      case "timpaniSwell":
        this.triggerTimpani(centre, "swell");
        return;
      // The cantus is a running line rather than a one-shot, so auditioning it
      // sounds a single note of it — the same synthesis, at the tone the line
      // would next sing. Switching the voice on is what starts the line.
      case "cantusTenor":
        this.auditionCantusNote("tenor");
        return;
      case "cantusSoprano":
        this.auditionCantusNote("soprano");
        return;
      case "cantusDuet":
        this.auditionCantusNote("duet");
        return;
    }
  }

  /** Mid-window, the height an audition plucks at. */
  private auditionClickHeight(): number {
    return (window.innerHeight || 800) / 2;
  }

  /**
   * One note of the cantus, in the variant's register. The duet sounds both
   * its voices, offset, so the audition shows what makes it a duet rather than
   * a thicker single voice.
   */
  private auditionCantusNote(variant: CantusVariant): void {
    const palette = this.flourishPalette();
    if (palette.length === 0) return;
    const {
      sopranoOctaves,
      sopranoGainScale,
      duetScaleSteps,
      duetGainScale,
    } = CANTUS_TUNING;

    if (variant === "soprano") {
      this.singCantusNote(
        palette[0] * Math.pow(2, sopranoOctaves),
        0,
        sopranoGainScale,
      );
      return;
    }

    this.singCantusNote(palette[0], -0.2, 1);
    if (variant !== "duet") return;
    this.singCantusNote(
      palette[Math.min(palette.length - 1, duetScaleSteps)],
      0.2,
      duetGainScale,
    );
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.max(
      1,
      Math.floor(ctx.sampleRate * PERCUSSION_TUNING.noiseBufferSeconds),
    );
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  /**
   * One filtered burst of noise, the shared body of every percussion sound
   * here. Returns the gain node so the caller shapes its own envelope; the
   * graph disconnects itself when the source ends.
   */
  private startNoiseBurst(
    startAt: number,
    durationSeconds: number,
    filter: { type: BiquadFilterType; frequency: number; Q: number },
    pan: number,
    layer: SoundLayer,
  ): { gain: GainNode; panNode: StereoPannerNode } | null {
    if (!this.ctx) return null;
    const ctx = this.ctx;

    const source = ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer(ctx);
    // Looped so a burst longer than the buffer still reads as continuous
    // noise rather than stopping partway through.
    source.loop = true;

    const biquad = ctx.createBiquadFilter();
    biquad.type = filter.type;
    biquad.frequency.value = filter.frequency;
    biquad.Q.value = filter.Q;

    const gain = ctx.createGain();
    const panNode = ctx.createStereoPanner();
    panNode.pan.value = pan;

    source.connect(biquad);
    biquad.connect(gain);
    gain.connect(panNode);
    panNode.connect(this.busFor(layer));

    source.start(startAt);
    source.stop(startAt + durationSeconds);
    source.onended = () => {
      try {
        source.disconnect();
        biquad.disconnect();
        gain.disconnect();
        panNode.disconnect();
      } catch {
        /* already disconnected */
      }
    };

    return { gain, panNode };
  }

  /**
   * An unpitched percussive tap for a click: a short filtered noise edge over
   * a sine falling fast from 180Hz to 80Hz. Woodblock rather than bell — no
   * ring-out, so it can fire as often as a click does without accumulating.
   *
   * The variant decides what sits under the edge. "tapNoThump" drops the
   * falling sine entirely, which is the version to reach for when a run of
   * taps reads as too heavy in the low end; "hybrid" adds a faint, short bell
   * at a quarter of the shipped click-bell level.
   */
  private triggerClickTap(x: number, variant: ClickPercussionVariant): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const {
      noiseDurationSeconds,
      noiseFilterHz,
      noiseFilterQ,
      noiseGain,
      thumpStartHz,
      thumpEndHz,
      thumpDurationSeconds,
      thumpGain,
      attackSeconds,
      ghostGainScale,
      ghostDecaySeconds,
      ghostHz,
    } = PERCUSSION_TUNING.clickTap;
    const pan = positionToPan(x, this.canvasWidth);

    const burst = this.startNoiseBurst(
      now,
      noiseDurationSeconds,
      { type: "bandpass", frequency: noiseFilterHz, Q: noiseFilterQ },
      pan,
      "clickBell",
    );
    if (burst) {
      burst.gain.gain.setValueAtTime(0, now);
      burst.gain.gain.linearRampToValueAtTime(noiseGain, now + attackSeconds);
      burst.gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + noiseDurationSeconds,
      );
    }

    if (variant === "tapNoThump") return;

    // The thump. An exponential fall rather than linear, so the pitch drops
    // away the way a struck body does instead of sliding.
    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(thumpStartHz, now);
    thump.frequency.exponentialRampToValueAtTime(
      thumpEndHz,
      now + thumpDurationSeconds,
    );

    const thumpLevel = ctx.createGain();
    thumpLevel.gain.setValueAtTime(0, now);
    thumpLevel.gain.linearRampToValueAtTime(thumpGain, now + attackSeconds);
    thumpLevel.gain.exponentialRampToValueAtTime(
      0.0001,
      now + thumpDurationSeconds,
    );

    const thumpPan = ctx.createStereoPanner();
    thumpPan.pan.value = pan;

    thump.connect(thumpLevel);
    thumpLevel.connect(thumpPan);
    thumpPan.connect(this.busFor("clickBell"));
    thump.start(now);
    thump.stop(now + thumpDurationSeconds + 0.02);
    thump.onended = () => {
      try {
        thump.disconnect();
        thumpLevel.disconnect();
        thumpPan.disconnect();
      } catch {
        /* already disconnected */
      }
    };

    if (variant !== "hybrid") return;

    this.triggerFlourishNote(
      ghostHz,
      x,
      CLICK_BELL.gain * ghostGainScale,
      ghostDecaySeconds,
      { attackSeconds, layer: "clickBell" },
    );
  }

  /**
   * The pitch a click is plucked or rung at: the current chord's bell palette,
   * indexed by how high up the window the click landed. Shared with
   * `triggerClick` so a pizzicato lands on the same note the bell would have.
   */
  private clickPitchIndex(y: number, paletteLength: number): number {
    const pitchRatio = 1 - y / (window.innerHeight || 800);
    return Math.min(
      paletteLength - 1,
      Math.max(0, Math.floor(pitchRatio * paletteLength)),
    );
  }

  /**
   * One plucked string for a click: an oscillator through a filter that sweeps
   * shut across the decay, with a sine an octave down for body. Short and dry
   * — the note is over before the next click can land, which is what makes a
   * run of them rhythmic rather than a pile of ringing bells.
   *
   * The variant decides the body: "soft" is a triangle with a slow sweep,
   * "crisp" is a sawtooth with a fingernail of noise on the attack and half
   * the length, and "double" is the soft pluck with a quieter grace note a
   * palette step away in front of it.
   */
  private triggerPizzicato(
    x: number,
    y: number,
    variant: PizzicatoVariant,
  ): void {
    if (!this.ctx) return;

    const palette = this.currentBellScale();
    const index = this.clickPitchIndex(y, palette.length);

    if (variant === "double") {
      const { graceLeadSeconds, graceGainScale, graceDecayScale, graceScaleSteps } =
        PIZZICATO_TUNING.double;
      // Wrap downward at the top of the palette so the ornament is always a
      // neighbouring chord tone rather than a repeat of the main note.
      const graceIndex =
        index + graceScaleSteps < palette.length
          ? index + graceScaleSteps
          : Math.max(0, index - graceScaleSteps);
      this.pluckString(palette[graceIndex], x, "soft", {
        gainScale: graceGainScale,
        decayScale: graceDecayScale,
      });
      this.pluckString(palette[index], x, "soft", {
        delaySeconds: graceLeadSeconds,
      });
      return;
    }

    this.pluckString(palette[index], x, variant);
  }

  /**
   * The string itself. Split out from `triggerPizzicato` because the "double"
   * variant plucks twice, and both plucks are the same instrument at different
   * levels rather than two different sounds.
   */
  private pluckString(
    frequency: number,
    x: number,
    body: "soft" | "crisp",
    options: {
      delaySeconds?: number;
      gainScale?: number;
      decayScale?: number;
    } = {},
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const tuning =
      body === "crisp" ? PIZZICATO_TUNING.crisp : PIZZICATO_TUNING.soft;
    const now = ctx.currentTime + (options.delaySeconds ?? 0);
    const decaySeconds = tuning.decaySeconds * (options.decayScale ?? 1);
    const peak = tuning.gain * (options.gainScale ?? 1);
    const pan = positionToPan(x, this.canvasWidth);

    // Filter shutting across the decay: high partials die before the
    // fundamental does, which is the difference between a pluck and a beep.
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(tuning.filterStartHz, now);
    filter.frequency.exponentialRampToValueAtTime(
      tuning.filterEndHz,
      now + tuning.attackSeconds + decaySeconds,
    );
    filter.Q.value = tuning.filterQ;

    const level = ctx.createGain();
    level.gain.setValueAtTime(0, now);
    level.gain.linearRampToValueAtTime(peak, now + tuning.attackSeconds);
    level.gain.exponentialRampToValueAtTime(
      0.0001,
      now + tuning.attackSeconds + decaySeconds,
    );

    const panNode = ctx.createStereoPanner();
    panNode.pan.value = pan;

    const string = ctx.createOscillator();
    string.type = body === "crisp" ? "sawtooth" : "triangle";
    string.frequency.value = frequency;

    // The octave-down sine. A pluck this short has almost no time to establish
    // a fundamental on its own, so the sub is what gives it weight.
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = frequency / 2;
    const subLevel = ctx.createGain();
    subLevel.gain.value = tuning.subGain;

    string.connect(filter);
    sub.connect(subLevel);
    subLevel.connect(filter);
    filter.connect(level);
    level.connect(panNode);
    panNode.connect(this.busFor("clickBell"));

    const stopAt = now + tuning.attackSeconds + decaySeconds + 0.05;
    string.start(now);
    sub.start(now);
    string.stop(stopAt);
    sub.stop(stopAt);
    string.onended = () => {
      try {
        string.disconnect();
        sub.disconnect();
        subLevel.disconnect();
        filter.disconnect();
        level.disconnect();
        panNode.disconnect();
      } catch {
        /* already disconnected */
      }
    };

    if (body !== "crisp") return;

    // The fingernail: a few milliseconds of bandpassed noise on the attack
    // only. An attack component, not a body — it is gone long before the
    // string is, so the sound stays pitched.
    const {
      edgeDurationSeconds,
      edgeFilterHz,
      edgeFilterQ,
      edgeGain,
    } = PIZZICATO_TUNING.crisp;
    const edge = this.startNoiseBurst(
      now,
      edgeDurationSeconds,
      { type: "bandpass", frequency: edgeFilterHz, Q: edgeFilterQ },
      pan,
      "clickBell",
    );
    if (!edge) return;
    edge.gain.gain.setValueAtTime(edgeGain, now);
    edge.gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + edgeDurationSeconds,
    );
  }

  /**
   * The timpani roll under a held click, pitched on the current chord root.
   *
   * Built as a fundamental plus partials at 2x and 3x rather than a bare low
   * sine: down in D2-D3 the fundamental alone is inaudible on a laptop
   * speaker, and the partials are what carry the pitch through. The lowpass
   * sits above them deliberately.
   *
   * "root" and "rootFifth" roll — an LFO cutting into the level, building
   * across the hold. "swell" drops the tremolo for a single crescendoing tone.
   * `holdSeconds` lets a real hold set the length; the audition uses the
   * default.
   */
  private triggerTimpani(
    x: number,
    variant: TimpaniVariant,
    holdSeconds?: number,
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const {
      registerMultiplier,
      durationSeconds: defaultDuration,
      minDurationSeconds,
      maxDurationSeconds,
      gain,
      octavePartialGain,
      twelfthPartialGain,
      filterHz,
      filterQ,
      tremoloHz,
      tremoloDepth,
      buildFraction,
      releaseSeconds,
      alternateSeconds,
      swellBuildFraction,
      swellGainScale,
    } = TIMPANI_TUNING;

    const durationSeconds = Math.min(
      maxDurationSeconds,
      Math.max(minDurationSeconds, holdSeconds ?? defaultDuration),
    );
    const root = this.currentRoot() * registerMultiplier;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterHz;
    filter.Q.value = filterQ;

    const level = ctx.createGain();
    const peak = gain * (variant === "swell" ? swellGainScale : 1);
    const build = variant === "swell" ? swellBuildFraction : buildFraction;
    level.gain.setValueAtTime(0, now);
    level.gain.linearRampToValueAtTime(peak, now + durationSeconds * build);
    level.gain.setValueAtTime(peak, now + durationSeconds - releaseSeconds);
    level.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

    const panNode = ctx.createStereoPanner();
    panNode.pan.value = positionToPan(x, this.canvasWidth);

    const stopAt = now + durationSeconds + 0.05;
    const oscillators: OscillatorNode[] = [];
    const scratch: AudioNode[] = [filter, level, panNode];

    // The tremolo, for the two rolled variants. Depth short of 1, so the tone
    // pulses rather than switching on and off.
    let head: AudioNode = filter;
    if (variant !== "swell") {
      const tremolo = ctx.createOscillator();
      tremolo.type = "sine";
      tremolo.frequency.value = tremoloHz;
      const tremoloDepthGain = ctx.createGain();
      tremoloDepthGain.gain.value = tremoloDepth / 2;
      const tremoloLevel = ctx.createGain();
      tremoloLevel.gain.value = 1 - tremoloDepth / 2;
      tremolo.connect(tremoloDepthGain);
      tremoloDepthGain.connect(tremoloLevel.gain);
      filter.connect(tremoloLevel);
      head = tremoloLevel;
      tremolo.start(now);
      tremolo.stop(stopAt);
      oscillators.push(tremolo);
      scratch.push(tremoloDepthGain, tremoloLevel);
    }

    head.connect(level);
    level.connect(panNode);
    panNode.connect(this.busFor("clickBell"));

    const partials: Array<{ ratio: number; level: number }> = [
      { ratio: 1, level: 1 },
      { ratio: 2, level: octavePartialGain },
      { ratio: 3, level: twelfthPartialGain },
    ];

    for (const partial of partials) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(root * partial.ratio, now);

      // The alternating variant steps the whole partial stack between root and
      // fifth, so the drum reads as retuning between strokes rather than as
      // two drums sounding at once.
      if (variant === "rootFifth") {
        let at = now + alternateSeconds;
        let onFifth = true;
        while (at < now + durationSeconds) {
          osc.frequency.setValueAtTime(
            root * partial.ratio * (onFifth ? 1.5 : 1),
            at,
          );
          onFifth = !onFifth;
          at += alternateSeconds;
        }
      }

      const partialLevel = ctx.createGain();
      partialLevel.gain.value = partial.level;
      osc.connect(partialLevel);
      partialLevel.connect(filter);
      osc.start(now);
      osc.stop(stopAt);
      oscillators.push(osc);
      scratch.push(partialLevel);
    }

    oscillators[oscillators.length - 1].onended = () => {
      for (const node of [...oscillators, ...scratch]) {
        try {
          node.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    };
  }

  // ── Cantus firmus ─────────────────────────────────────────────────────────

  /**
   * Start the autonomous slow voice, or switch which variant it sings.
   *
   * Nothing else starts it: it runs off `tick`, so it sounds only while the
   * scene is being driven — the pad and the replay both do that, and a live
   * page would too if this ever graduated, which is why the toggle rather than
   * the trigger is the gate.
   */
  setCantus(variant: CantusVariant | null): void {
    if (variant === null) {
      this.cantus = null;
      return;
    }
    if (this.cantus?.variant === variant) return;
    this.cantus = {
      variant,
      pitch: null,
      partnerPitch: null,
      // Due immediately, so switching it on is audible rather than a wait of
      // up to fifteen seconds before anything happens.
      nextNoteMs: Number.NEGATIVE_INFINITY,
      nextPartnerNoteMs: Number.NEGATIVE_INFINITY,
      noteCount: 0,
    };
  }

  /** Which cantus variant is running, or null (diagnostics, and the pad's readout). */
  getCantus(): CantusVariant | null {
    return this.cantus?.variant ?? null;
  }

  /**
   * Sound the cantus's next note when its moment arrives.
   *
   * The line is voice-led rather than re-drawn: each note is the palette tone
   * nearest the one before, so when the chord turns over the voice steps to
   * its neighbour instead of leaping. The first note has nothing to lead from,
   * so it takes the palette root.
   */
  private updateCantus(elapsedMs: number): void {
    const cantus = this.cantus;
    if (!cantus || !this.ctx) return;

    const {
      minIntervalSeconds,
      maxIntervalSeconds,
      duetScaleSteps,
      duetGainScale,
      duetPhaseOffset,
      sopranoOctaves,
      sopranoGainScale,
      panSpread,
    } = CANTUS_TUNING;

    const palette = this.flourishPalette();
    if (palette.length === 0) return;

    const intervalMsFor = (salt: number): number => {
      const span = maxIntervalSeconds - minIntervalSeconds;
      return (
        (minIntervalSeconds + hashUnit(cantus.noteCount + 1, salt) * span) * 1000
      );
    };

    if (elapsedMs >= cantus.nextNoteMs) {
      const pitch =
        cantus.pitch === null ? palette[0] : leadHomeTone(cantus.pitch, palette);
      cantus.pitch = pitch;

      const octaves = cantus.variant === "soprano" ? sopranoOctaves : 0;
      const gainScale = cantus.variant === "soprano" ? sopranoGainScale : 1;
      // Pan wanders note to note rather than sitting still, which is most of
      // what stops a sustained tone reading as a test tone.
      const pan = (hashUnit(cantus.noteCount, 11) * 2 - 1) * panSpread;
      this.singCantusNote(pitch * Math.pow(2, octaves), pan, gainScale);

      cantus.noteCount += 1;
      cantus.nextNoteMs = elapsedMs + intervalMsFor(7);

      // Seed the duet's partner half an interval behind, so the two voices
      // alternate instead of landing together.
      if (
        cantus.variant === "duet" &&
        cantus.nextPartnerNoteMs === Number.NEGATIVE_INFINITY
      ) {
        cantus.nextPartnerNoteMs =
          elapsedMs + (cantus.nextNoteMs - elapsedMs) * duetPhaseOffset;
      }
    }

    if (cantus.variant !== "duet") return;
    if (elapsedMs < cantus.nextPartnerNoteMs) return;

    // The partner sits a couple of palette steps above whatever the first
    // voice last sang — a chord tone, so it is a third-ish rather than a
    // fixed interval — and is voice-led from its own previous note.
    const anchor = cantus.pitch ?? palette[0];
    const anchorIndex = palette.indexOf(anchor);
    const partnerIndex = Math.min(
      palette.length - 1,
      (anchorIndex < 0 ? 0 : anchorIndex) + duetScaleSteps,
    );
    const target = palette[partnerIndex];
    const partnerPitch =
      cantus.partnerPitch === null
        ? target
        : leadHomeTone(cantus.partnerPitch, palette);
    cantus.partnerPitch = partnerPitch;

    const partnerPan = (hashUnit(cantus.noteCount, 23) * 2 - 1) * panSpread;
    this.singCantusNote(partnerPitch, partnerPan, duetGainScale);
    cantus.nextPartnerNoteMs = elapsedMs + intervalMsFor(19);
  }

  /**
   * One cantus note: a long soft swell in and out, with the pan drifting
   * across it. The attack and release are both seconds long, so consecutive
   * notes overlap and the line never fully stops — that overlap is what makes
   * it read as a voice rather than as a sequence of tones.
   */
  private singCantusNote(
    frequency: number,
    pan: number,
    gainScale: number,
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const {
      attackSeconds,
      sustainSeconds,
      releaseSeconds,
      registerMultiplier,
      gain,
      partialGain,
      panTravel,
      filterHz,
      filterQ,
    } = CANTUS_TUNING;

    const pitch = frequency * registerMultiplier;
    const peak = gain * gainScale;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterHz;
    filter.Q.value = filterQ;

    const level = ctx.createGain();
    level.gain.setValueAtTime(0.0001, now);
    level.gain.linearRampToValueAtTime(peak, now + attackSeconds);
    level.gain.setValueAtTime(peak, now + attackSeconds + sustainSeconds);
    level.gain.exponentialRampToValueAtTime(
      0.0001,
      now + attackSeconds + sustainSeconds + releaseSeconds,
    );

    const panNode = ctx.createStereoPanner();
    const totalSeconds = attackSeconds + sustainSeconds + releaseSeconds;
    const from = Math.max(-1, Math.min(1, pan - panTravel / 2));
    const to = Math.max(-1, Math.min(1, pan + panTravel / 2));
    panNode.pan.setValueAtTime(from, now);
    panNode.pan.linearRampToValueAtTime(to, now + totalSeconds);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = pitch;

    // A triangle a fifth up rather than a second sine: just enough edge that
    // the voice has a body without ever becoming bright.
    const partial = ctx.createOscillator();
    partial.type = "triangle";
    partial.frequency.value = pitch * 1.5;
    const partialLevel = ctx.createGain();
    partialLevel.gain.value = partialGain;

    osc.connect(filter);
    partial.connect(partialLevel);
    partialLevel.connect(filter);
    filter.connect(level);
    level.connect(panNode);
    panNode.connect(this.busFor("cantus"));

    const stopAt = now + totalSeconds + 0.1;
    osc.start(now);
    partial.start(now);
    osc.stop(stopAt);
    partial.stop(stopAt);
    osc.onended = () => {
      try {
        osc.disconnect();
        partial.disconnect();
        partialLevel.disconnect();
        filter.disconnect();
        level.disconnect();
        panNode.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  }

  // ── Percussion, for the playground's replay driver ────────────────────────
  //
  // These are the only public doors onto the percussion candidates, and they
  // exist so real recorded events can drive them in the sound playground. The
  // engine itself never calls them: no `tick`, `triggerClick`, `triggerNavigation`
  // or `retireTrail` path reaches percussion, so a live page stays pitched
  // whatever it does. If percussion graduates, it graduates by the live paths
  // calling these deliberately.

  /**
   * A click, voiced as percussion. "bells" is a no-op here — the caller rings
   * the shipped `triggerClick` bell for that variant instead, so the two never
   * double up.
   */
  triggerClickPercussion(x: number, variant: ClickPercussionVariant): void {
    if (!this.enabled || variant === "bells") return;
    this.triggerClickTap(x, variant);
  }

  /**
   * A click, voiced as a plucked string on the current chord. Pitched, unlike
   * `triggerClickPercussion` — the note comes from the click's height the same
   * way the shipped bell's does, so this is a change of instrument rather than
   * a change of what a click means.
   */
  triggerClickPizzicato(x: number, y: number, variant: PizzicatoVariant): void {
    if (!this.enabled) return;
    this.triggerPizzicato(x, y, variant);
  }

  /**
   * A held click, voiced as a timpani roll on the current chord root.
   * `holdSeconds` sets the roll's length, clamped to the tuning's bounds; the
   * default is used when the caller has no duration.
   */
  triggerHold(
    x: number,
    variant: TimpaniVariant = "root",
    holdSeconds?: number,
  ): void {
    if (!this.enabled) return;
    this.triggerTimpani(x, variant, holdSeconds);
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
   * The same chime figure in two contrasting bands, one after the other, so
   * the register the arriving trail's colour buys it is audible without
   * needing two real trails to walk on and off the canvas.
   *
   * Bass first, then soprano — the two ends of the range, panned apart the way
   * the voice-pair audition does it. The seed is fixed and shared between the
   * two, so what changes between them is only the register and the timbre;
   * pressing the button twice sounds the same pair, not a new one.
   */
  private auditionChimePair(rising: boolean): void {
    if (!this.ctx) return;
    const seed = hashIdentity("audition-chime");
    const width = this.canvasWidth;
    // Scheduled on the audio clock rather than a timer: the gap has to be
    // exact for the two to read as a comparison, and a timer would drift.
    this.triggerArrivalFigure(width * 0.25, rising, seed, "bass");
    this.triggerArrivalFigure(
      width * 0.75,
      rising,
      seed,
      "soprano",
      ARRIVAL_TUNING.auditionPairGapSeconds,
    );
  }

  /**
   * Two example fingerprints side by side, so the difference a trail voice
   * makes is audible without needing two real trails to cross the canvas. Each
   * holds for a couple of seconds on its own home tone, with its own detune
   * and vibrato, panned apart.
   *
   * The pair is deliberately drawn from two different register bands — a cool
   * colour and a warm one — because that spread is now the loudest thing a
   * fingerprint does. Comparing two trails in the same octave would understate
   * it.
   */
  private auditionVoicePair(): void {
    if (!this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const scale = this.flourishPalette();
    const holdSeconds = 2;

    // Two fixed keys chosen so their fingerprints differ audibly, each with a
    // colour that puts it in a different part; the live engine derives both
    // the same way from a real trail's identity and colour.
    const examples: Array<{ key: string; band: RegisterBand }> = [
      // A blue trail, low.
      { key: "audition-voice-a", band: registerBandForHue(210) },
      // A red trail, high.
      { key: "audition-voice-b", band: registerBandForHue(10) },
    ];
    examples.forEach(({ key, band }, order) => {
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
      // Voiced in its own band rather than a fixed octave up, so the audition
      // demonstrates the spread the live crowd actually gets.
      osc.frequency.value = foldPitchIntoBand(
        homeToneForHash(hash, scale),
        band,
      );
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
    // The descant is the sustained voice itself lifting, so it has no discrete
    // notes to advance. Its treatment rides on the voice loop instead.
    if (this.config.soloistVoice === "descant") return;

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

    if (this.config.soloistVoice === "arpeggio") {
      this.triggerArpeggioNote(state, frame, velocity);
      return;
    }

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
    // Register selection is quantized to two-semitone steps rather than
    // sliding continuously, so the run still lands on discrete degrees. A
    // full-octave step no longer fits under the register ceiling — the
    // window only reaches a major third above the base pitch — so the
    // quantum has to be finer than an octave to produce any audible climb.
    const octaves =
      Math.round(
        (Math.log2(registerMin) +
          normalized * (Math.log2(registerMax) - Math.log2(registerMin))) *
          6,
      ) / 6;

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
   * One note of an ascending roll through the chord's own tones.
   *
   * The pitch is a chord tone and nothing else: no register multiplier is
   * applied on top, because the ladder already spans the palette's octaves and
   * multiplying it would carry the roll off the chord and over the ceiling.
   * Velocity only opens the roll's step, so a faster sweep climbs the chord
   * faster rather than climbing out of it.
   */
  private triggerArpeggioNote(
    state: FlourishState,
    frame: TrailSoundFrame,
    velocity: number,
  ): void {
    const tones = chordTones(this.flourishPalette());
    if (tones.length === 0) return;

    const start = Math.floor(tones.length * ARPEGGIO_TUNING.startFraction);
    // A faster soloist takes bigger steps up the ladder, so the roll opens out
    // rather than merely repeating faster.
    const stride =
      1 +
      Math.round(
        Math.min(1, velocity / FLOURISH_TUNING.registerFullVelocity) * 1,
      );
    const pitch = tones[(start + state.paletteStep * stride) % tones.length];
    state.paletteStep++;

    this.triggerFlourishNote(
      pitch,
      frame.x,
      FLOURISH_TUNING.noteGain,
      ARPEGGIO_TUNING.decaySeconds,
      {
        attackSeconds: ARPEGGIO_TUNING.attackSeconds,
        partialGain: ARPEGGIO_TUNING.partialGain,
      },
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
    this.noticeListener = null;
    this.notesEngine.detach();
    this.clearFlourish();
    this.releaseBassPedal();
    this.arrivalTimesMs.clear();
    this.arrivalSeeds.clear();
    this.arrivalBands.clear();
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
    this.lastHarshCrossingMs = Number.NEGATIVE_INFINITY;
    this.recentSceneMotion.length = 0;
    this.trailPaths.clear();
    this.fingerprints.clear();
    this.fingerprintKeys.clear();
    this.mergePullsUntilMs.clear();
    this.swells.clear();
    for (const bus of this.layerBuses.values()) {
      try { bus.disconnect(); } catch { /* already disconnected */ }
    }
    this.layerBuses.clear();
    this.cantus = null;
    if (this.ctx) {
      // Only a context the engine opened is its to close. An injected one
      // belongs to the caller, which may still be rendering from it.
      if (!this.providedCtx) this.ctx.close();
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
    this.arrivalBands.clear();
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
    this.lastHarshCrossingMs = Number.NEGATIVE_INFINITY;
    this.recentSceneMotion.length = 0;
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
    // The playback clock rewinds across a loop boundary, so the next tick must
    // start a fresh interval rather than measure against the end of last pass.
    this.lastSpotlightTickMs = null;
    this.clearFlourish();
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
