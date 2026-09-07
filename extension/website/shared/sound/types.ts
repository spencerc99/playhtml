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
  /**
   * Which trail navigated, so a visual can be drawn at that trail's position.
   * The sound itself is placed from `x` alone and does not read this.
   */
  trailIndex?: number;
}

/**
 * An event the engine has just handled, reported to whoever is drawing the
 * scene, along with whether it actually made a sound.
 *
 * A notice is emitted for the event, not for the note. The two are separate
 * because the toggles are separate: a sound toggle decides whether audio
 * plays, a visual toggle decides whether a gesture is drawn, and neither
 * should silently gate the other. Emitting only when a note sounded is what
 * made the navigation visual invisible whenever navigation audio was off.
 *
 * `played` says whether audio actually resulted — the engine drops arrivals
 * for its per-trail debounce and its global rate cap, and drops navigations
 * inside their minimum interval. A visual that stands for a note rather than
 * for the event (the gathering, which is paced by the chime's own notes)
 * should draw only when this is true; one that stands for the event (the
 * navigation knot) draws either way.
 */
export type SoundNotice =
  | {
      kind: "arrival";
      trailIndex: number;
      /** True for a trail entering, false for one leaving. */
      rising: boolean;
      /**
       * When each note of the chime lands, in seconds from the moment the
       * figure was triggered. One entry per note, in order. Empty when no
       * chime sounded.
       */
      noteOffsetsSeconds: number[];
      /** Whether the chime actually sounded. */
      played: boolean;
    }
  | {
      kind: "navigation";
      /** The trail that navigated, when the caller named one. */
      trailIndex?: number;
      /** Canvas x the note was panned to. */
      x?: number;
      /** Whether the gong actually sounded. */
      played: boolean;
    };

/** Receives every sound the engine commits to. */
export type SoundNoticeListener = (notice: SoundNotice) => void;

/**
 * How a pizzicato click is plucked.
 *
 * All three draw their pitch from the same place the click bell does — the
 * current chord's bell palette, indexed by click height — so the difference
 * between them is entirely in the attack and the decay, not the note.
 */
export type PizzicatoVariant =
  /** Warm nylon-ish pluck: triangle over sine, filter sweeping down, ~250ms. */
  | "soft"
  /** Tighter and brighter, with a noise edge on the attack only, ~150ms. */
  | "crisp"
  /** The soft pluck preceded by a quieter grace note a chord tone away. */
  | "double";

/** Every pizzicato variant, in the order a selector should present them. */
export const PIZZICATO_VARIANTS: PizzicatoVariant[] = [
  "soft",
  "crisp",
  "double",
];

/**
 * How a held click is voiced by the timpani.
 *
 * Pitched on the current chord root, low but with enough overtone content to
 * survive a laptop speaker — a pure low sine disappears on one, which is what
 * the navigation gong's partials exist to solve.
 */
export type TimpaniVariant =
  /** Tremolo roll on the root, building with the hold. */
  | "root"
  /** The same roll, alternating softly between root and fifth. */
  | "rootFifth"
  /** One sustained tone crescendoing instead of a tremolo. */
  | "swell";

/** Every timpani variant, in the order a selector should present them. */
export const TIMPANI_VARIANTS: TimpaniVariant[] = ["root", "rootFifth", "swell"];

/**
 * How the cantus firmus is voiced.
 *
 * The cantus belongs to no trail: it is one slow autonomous line drawn from
 * whatever chord is in force, moving to the nearest tone each time the chord
 * turns over, the way a trail's home tone does.
 */
export type CantusVariant =
  /** One warm voice in C3-C4. */
  | "tenor"
  /** The same line an octave up, brighter and quieter. */
  | "soprano"
  /** Tenor plus a second voice a chord tone above, alternating rather than together. */
  | "duet";

/** Every cantus variant, in the order a selector should present them. */
export const CANTUS_VARIANTS: CantusVariant[] = ["tenor", "soprano", "duet"];

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
  /** The two alternative soloist voices, each heard as the shape it makes. */
  | "soloistArpeggio"
  | "soloistPresence"
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
   * Pitched orchestral instruments, each in its variants. The pad auditions
   * them and the replay drives them; no live page path reaches any of them.
   */
  | "pizzicatoSoft"
  | "pizzicatoCrisp"
  | "pizzicatoDouble"
  | "timpaniRoot"
  | "timpaniRootFifth"
  | "timpaniSwell"
  | "cantusTenor"
  | "cantusSoprano"
  | "cantusDuet";

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
  /**
   * The autonomous cantus firmus line. Its own family because it belongs to no
   * trail and no event — it has to be silenceable on its own to judge whether
   * the scene still holds together without it.
   */
  | "cantus";

/** Every layer, in the order a mixer strip should present them. */
export const SOUND_LAYERS: SoundLayer[] = [
  "bed",
  "flourish",
  "clickBell",
  "chime",
  "navigation",
  "bassPedal",
  "crossing",
  "cantus",
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
