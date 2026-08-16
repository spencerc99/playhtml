// ABOUTME: Core generative sound engine driven by cursor trail animation data
// ABOUTME: Manages Web Audio voices, maps trail frames to musical parameters each animation frame

import {
  TrailSoundFrame,
  ClickSoundEvent,
  InstrumentConfig,
  NavigationSoundEvent,
} from "./types";
import {
  directionToPitch,
  computeDirection,
  computeVelocity,
  velocityToGain,
  positionToPan,
  scaleForChord,
  bellScaleForChord,
  CHORD_PROGRESSION,
  CHORD_DWELL_MS,
  D_MINOR_PENTATONIC,
} from "./scales";
import { getInstrument, CLICK_BELL } from "./instruments";
import { NotesEngine } from "./NotesEngine";

/** Minimum time between note changes for a single voice (ms) */
const MIN_NOTE_INTERVAL_MS = 80;

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

/** Configurable sound modes */
export interface SoundConfig {
  mode: SoundMode;
  chordVoicing: boolean;
  cursorInstruments: boolean;
  crossingDissonance: boolean;
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

const DEFAULT_CONFIG: SoundConfig = {
  mode: "sustained",
  chordVoicing: false,
  cursorInstruments: false,
  crossingDissonance: false,
  spotlight: false,
  chordRotation: false,
  energyArc: false,
  trailArrivals: false,
  navigationSounds: false,
  bassPedal: false,
};

/**
 * Trail arrival/departure tuning. A trail entering the scene rises through two
 * notes, one leaving falls through them, so the population of the canvas is
 * audible without needing to watch it.
 */
const ARRIVAL_TUNING = {
  /** Root and the fifth above it, as multipliers on the chord root. */
  intervalRatio: 1.5,
  /** Octave multiplier placing the figure in a mid register above the bed. */
  registerMultiplier: 2,
  /** Gap between the two notes of the figure (seconds). */
  noteSpacingSeconds: 0.16,
  /** Peak gain, kept under the flourish so arrivals stay background texture. */
  noteGain: 0.03,
  /** Level of the 3x partial relative to the fundamental. */
  partialGain: 0.22,
  attackSeconds: 0.01,
  decaySeconds: 1.1,
  /** Departure sits slightly quieter and rings a touch longer than arrival. */
  departureGainScale: 0.8,
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
  /** Octave multiplier on the chord root, placing the note in D2-D3. */
  registerMultiplier: 0.5,
  /** Detune of the two supporting partials, in cents either side. */
  detuneCents: 7,
  /** Level of the detuned partials relative to the fundamental. */
  partialGain: 0.35,
  /** Level of the octave-up shimmer that gives the strike its edge. */
  octaveGain: 0.12,
  peakGain: 0.14,
  attackSeconds: 0.008,
  decaySeconds: 3.5,
  /** Lowpass cutoff, so the note is felt more than heard (Hz). */
  filterHz: 900,
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
  setConfig(config: Partial<SoundConfig>): void {
    const prevChord = this.config.chordVoicing;
    const prevMode = this.config.mode;
    Object.assign(this.config, config);

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
      this.recentArrivalsMs.length = 0;
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
      if (this.config.crossingDissonance) {
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
          this.fadeVoice(voice, 0.05);
        }
        continue;
      }

      const direction = computeDirection(prevX, prevY, frame.x, frame.y);
      // Only newly-selected pitches use the current chord, so voices already
      // sounding drift into the new harmony at their own next note change
      // rather than all retuning together on the chord boundary.
      const frequency = directionToPitch(direction, scale);
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

      // Update instrument if cursor type changed and cursor instruments mode is on
      if (this.config.cursorInstruments && frame.cursorType !== voice.lastCursorType) {
        this.updateVoiceInstrument(voice, instrument);
        voice.lastCursorType = frame.cursorType;
      }

      if (
        frequency !== voice.currentFrequency &&
        elapsedMs - voice.lastNoteTimeMs > MIN_NOTE_INTERVAL_MS
      ) {
        this.setVoiceFrequency(voice, frequency);
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
          gain * instrument.gain * spotlightGain,
          VOICE_CONTROL_RAMP_SECONDS,
        );
      }

      if (shouldUpdateContinuousParams) {
        this.rampParam(voice.panNode.pan, pan, VOICE_CONTROL_RAMP_SECONDS);
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

    // Detect trail crossings and trigger dissonance
    if (this.config.crossingDissonance && activeTrails.length >= 2) {
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
        this.triggerCrossingDissonance(
          frame,
          { trailIndex: otherIdx, x: frame.x, y: frame.y, prevX: frame.x, prevY: frame.y, cursorType: undefined, progress: 0, color: "", isNewlyActive: false },
          closestDist,
        );
      }
    }
  }

  /** Trigger a brief dissonant tone at the crossing point */
  private triggerCrossingDissonance(
    a: TrailSoundFrame,
    b: TrailSoundFrame,
    distance: number,
  ): void {
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    // Dissonant intervals: minor second (16/15) and tritone (Math.sqrt(2))
    // Pick based on which trails are crossing
    const baseFreq = 220 + (midY / (window.innerHeight || 800)) * 440;
    const dissonantRatio = (a.trailIndex + b.trailIndex) % 2 === 0
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
    pan.pan.value = positionToPan(midX, this.canvasWidth);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(pan);
    pan.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 1.6);
    osc2.stop(now + 1.6);
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
    pan.connect(this.masterGain);

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
    pan.connect(this.masterGain!);

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
      active: false,
    };
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

  private setVoiceFrequency(voice: Voice, frequency: number): void {
    if (!this.ctx) return;
    if (voice.oscillator) {
      voice.oscillator.frequency.exponentialRampToValueAtTime(
        frequency,
        this.ctx.currentTime + 0.08,
      );
    }
    if (voice.fifthOscillator) {
      voice.fifthOscillator.frequency.exponentialRampToValueAtTime(
        frequency * 1.5, // Perfect fifth
        this.ctx.currentTime + 0.08,
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
      this.triggerArrivalFigure(position?.x ?? this.canvasWidth / 2, false);
    }
    this.arrivalTimesMs.delete(trailIndex);
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
      this.triggerArrivalFigure(frame.x, true);
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
   * A two-note figure on the chord root and the fifth above it: rising for an
   * arrival, falling for a departure.
   */
  private triggerArrivalFigure(x: number, rising: boolean): void {
    if (!this.ctx) return;

    const root = this.currentRoot() * ARRIVAL_TUNING.registerMultiplier;
    const fifth = root * ARRIVAL_TUNING.intervalRatio;
    const pitches = rising ? [root, fifth] : [fifth, root];
    const gain =
      ARRIVAL_TUNING.noteGain *
      (rising ? 1 : ARRIVAL_TUNING.departureGainScale);
    const decay = rising
      ? ARRIVAL_TUNING.decaySeconds
      : ARRIVAL_TUNING.departureDecaySeconds;

    pitches.forEach((pitch, order) => {
      this.triggerFlourishNote(
        pitch,
        x,
        gain,
        decay,
        {
          delaySeconds: order * ARRIVAL_TUNING.noteSpacingSeconds,
          attackSeconds: ARRIVAL_TUNING.attackSeconds,
          partialGain: ARRIVAL_TUNING.partialGain,
        },
      );
    });
  }

  /**
   * A deep resonant note marking one page navigation. Rate-limited globally —
   * a burst of navigations should read as one structural event, not a run.
   */
  triggerNavigation(event: NavigationSoundEvent = {}): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    if (!this.config.navigationSounds) return;

    const now = this.lastTickMs;
    if (now - this.lastNavigationNoteMs < NAVIGATION_TUNING.minIntervalMs) {
      return;
    }
    this.lastNavigationNoteMs = now;

    const ctx = this.ctx;
    const startTime = ctx.currentTime;
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
    pan.connect(this.masterGain);

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
    gain.connect(this.masterGain!);
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
    } = {},
  ): void {
    if (!this.ctx || !this.masterGain) return;

    this.enforceFlourishBudget();

    const ctx = this.ctx;
    const now = ctx.currentTime + (options.delaySeconds ?? 0);
    const attackSeconds =
      options.attackSeconds ?? FLOURISH_TUNING.attackSeconds;
    const partialGain = options.partialGain ?? FLOURISH_TUNING.partialGain;

    const osc = ctx.createOscillator();
    osc.type = CLICK_BELL.oscillatorType;
    osc.frequency.value = frequency;

    const partial = ctx.createOscillator();
    partial.type = "sine";
    partial.frequency.value = frequency * 3;

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
    pan.connect(this.masterGain);

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
    // replacing it, so dense scenes still avoid clipping.
    const target = this.baseVolume * polyphonyScale * this.energyGainScale();
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
    this.recentArrivalsMs.length = 0;
    for (const [, voice] of this.voices) {
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
