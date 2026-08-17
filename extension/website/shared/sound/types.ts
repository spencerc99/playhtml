// ABOUTME: Type definitions for the generative sound engine
// ABOUTME: Shared interfaces for trail-to-sound mapping

/** Data extracted from a single trail frame for sonification */
export interface TrailSoundFrame {
  trailIndex: number;
  /** Current cursor position in canvas coordinates */
  x: number;
  y: number;
  /** Previous cursor position (for direction/velocity calculation) */
  prevX: number;
  prevY: number;
  /** Cursor type from the trail data (pointer, text, grab, etc.) */
  cursorType: string | undefined;
  /** 0-1 progress through this trail's animation */
  progress: number;
  /** Trail color (used for visual correlation, not sound) */
  color: string;
  /** Whether this trail just became active this frame */
  isNewlyActive: boolean;
  /**
   * Stable identity for the participant behind this trail, used to derive a
   * per-trail sonic fingerprint. Trail indices are positions in a re-derived
   * array and shuffle as the data window slides, so a trail keyed only by
   * index would change voice underneath the listener. Producers that have a
   * participant-scoped id (`Trail.id`) pass it; the engine falls back to
   * colour plus index when it is absent.
   */
  identityKey?: string;
}

/** A click/hold event to be sonified as a percussive bell */
export interface ClickSoundEvent {
  x: number;
  y: number;
  /** Hold duration in ms. undefined = normal click */
  holdDuration: number | undefined;
}

/** A page navigation to be sonified as one deep resonant note */
export interface NavigationSoundEvent {
  /** Canvas x of the arriving node, used for stereo placement. Centred if omitted. */
  x?: number;
}

/**
 * How a click is voiced when percussion is driving the replay.
 *
 * "bells" is what ships: the pitched click bell, no percussion. The other
 * three are the candidates, and they differ only in what sits under the noise
 * edge — nothing, a falling sine, or a falling sine plus a faint bell.
 */
export type ClickPercussionVariant =
  /** Noise edge plus the falling sine thump. */
  | "tap"
  /** Noise edge alone — the variant for judging whether the thump earns itself. */
  | "tapNoThump"
  /** The full tap with a quiet bell ghost underneath. */
  | "hybrid"
  /** No percussion: the shipped pitched bell. */
  | "bells";

/**
 * One accent sound playable in isolation, on demand, for auditioning. Each
 * maps to the same synthesis the corresponding live feature uses.
 */
export type AuditionAccent =
  | "trailArrival"
  | "trailDeparture"
  | "navigation"
  | "soloistFlourish"
  | "soloistResolve"
  /** The consonant dyad two trails sound when their paths merge. */
  | "crossingMerge"
  /**
   * The three tension figures a crossing can sound, quiet scene to busy one:
   * a beating shimmer, a suspension that resolves, and the harsh tritone the
   * flavor reserves for a genuinely busy canvas.
   */
  | "crossingShimmer"
  | "crossingSuspension"
  | "crossingHarsh"
  /** Two contrasting trail fingerprints, side by side, to hear the difference. */
  | "trailVoicePair"
  /** One sustained voice through its full swell, in the choral timbre. */
  | "choralSwell"
  /**
   * Unpitched percussion candidates. The playground's replay driver plays
   * these against real events when its percussion toggles are on; no live page
   * path triggers any of them.
   */
  | "clickTap"
  | "clickTapNoThump"
  | "clickTapHybrid"
  | "typingTick"
  | "typingBurst"
  | "scrollBrush"
  | "holdRoll";

/**
 * One mixable family of sounds. Every source in the engine routes through
 * exactly one of these, so a family can be silenced without touching the rest
 * of the graph. Used only by the sound playground's mixer strip — live pages
 * leave every family audible.
 */
export type SoundLayer =
  /** The sustained trail voices: the bed the whole scene rests on. */
  | "bed"
  /** The soloist's flourish and its resolving note. */
  | "flourish"
  /** Percussive bells from clicks and holds. */
  | "clickBell"
  /** The chime figures marking a trail arriving or departing. */
  | "chime"
  /** The deep struck note marking a page navigation. */
  | "navigation"
  /** The low drone holding the chord root. */
  | "bassPedal"
  /** Both crossing accents: the dissonant interval and the merged dyad. */
  | "crossing"
  /** Keystroke ticks. Percussion, so only the playground's replay feeds it. */
  | "typing"
  /**
   * The scroll brush. Its own family rather than part of `typing`, because a
   * swish and a tick are the two percussion textures most worth hearing
   * against each other.
   */
  | "brush";

/** Every layer, in the order a mixer strip should present them. */
export const SOUND_LAYERS: SoundLayer[] = [
  "bed",
  "flourish",
  "clickBell",
  "chime",
  "navigation",
  "bassPedal",
  "crossing",
  "typing",
  "brush",
];

/** Configuration for an instrument voice */
export interface InstrumentConfig {
  /** Web Audio oscillator type */
  oscillatorType: OscillatorType;
  /** Attack time in seconds */
  attack: number;
  /** Decay time in seconds */
  decay: number;
  /** Sustain level 0-1 */
  sustain: number;
  /** Release time in seconds */
  release: number;
  /** Lowpass filter cutoff frequency in Hz */
  filterFrequency: number;
  /** Filter Q factor */
  filterQ: number;
  /** Gain multiplier for this instrument */
  gain: number;
}
