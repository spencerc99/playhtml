// ABOUTME: Core generative sound engine driven by cursor trail animation data
// ABOUTME: Manages Web Audio voices, maps trail frames to musical parameters each animation frame

import { TrailSoundFrame, ClickSoundEvent, InstrumentConfig } from "./types";
import {
  directionToPitch,
  computeDirection,
  computeVelocity,
  velocityToGain,
  positionToPan,
  scaleForChord,
  CHORD_PROGRESSION,
  CHORD_DWELL_MS,
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
}

const DEFAULT_CONFIG: SoundConfig = {
  mode: "sustained",
  chordVoicing: false,
  cursorInstruments: false,
  crossingDissonance: false,
  spotlight: false,
  chordRotation: false,
  energyArc: false,
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
  /** Absolute floor so a calm scene never promotes near-still noise. */
  minVelocity: 4,
  /** Gain multiplier applied to the soloist. */
  soloistGain: 1.35,
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
  private spotlightSceneAverage = 0;
  /** Per-trail smoothed spotlight gain multiplier, so ramps stay continuous. */
  private spotlightGains: Map<number, number> = new Map();
  /** Index into CHORD_PROGRESSION, and when the current chord started. */
  private chordIndex = 0;
  private chordStartedMs = 0;
  /** Smoothed 0-1 scene energy driving the swell. */
  private energy = 0;
  private lastEnergyTickMs: number | null = null;
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
      this.spotlightTrailIndex = null;
      this.spotlightSceneAverage = 0;
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

    if (this.config.mode === "notes") {
      // Notes runs its own graph, so it needs the arc and progression applied
      // here rather than through the sustained voice loop below.
      this.updateEnergy(elapsedMs, activeTrails);
      this.updateChord(elapsedMs);
      this.updateEnergyReverb();
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
      const velocity =
        computeVelocity(prevX, prevY, frame.x, frame.y) *
        (REFERENCE_FRAME_DURATION_MS / sampleIntervalMs);
      const gain = velocityToGain(velocity);

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

    const BELL_SCALE = [
      293.66, // D4
      349.23, // F4
      392.0,  // G4
      440.0,  // A4
      523.25, // C5
      587.33, // D5
    ];
    const pitchRatio = 1 - (click.y / (window.innerHeight || 800));
    const scaleIndex = Math.min(
      BELL_SCALE.length - 1,
      Math.floor(pitchRatio * BELL_SCALE.length),
    );
    const baseFreq = BELL_SCALE[scaleIndex];
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
    if (this.spotlightTrailIndex === trailIndex) {
      this.spotlightTrailIndex = null;
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
        this.spotlightGains.clear();
      }
      return;
    }

    const cutoff = elapsedMs - SPOTLIGHT_TUNING.velocityWindowMs;

    let soloistIndex: number | null = null;
    let soloistVelocity = 0;
    for (const frame of activeTrails) {
      const prev = this.prevPositions.get(frame.trailIndex);
      // A trail with no previous position has no measurable velocity yet; it
      // is sampled next frame rather than counted as still.
      if (!prev) continue;
      const velocity = computeVelocity(prev.x, prev.y, frame.x, frame.y);
      let samples = this.spotlightVelocitySamples.get(frame.trailIndex);
      if (!samples) {
        samples = [];
        this.spotlightVelocitySamples.set(frame.trailIndex, samples);
      }
      samples.push([elapsedMs, velocity]);
      if (velocity > soloistVelocity) {
        soloistIndex = frame.trailIndex;
        soloistVelocity = velocity;
      }
    }

    for (const [index, samples] of this.spotlightVelocitySamples) {
      let dropCount = 0;
      while (dropCount < samples.length && samples[dropCount][0] < cutoff) {
        dropCount++;
      }
      if (dropCount > 0) samples.splice(0, dropCount);
      if (samples.length === 0) this.spotlightVelocitySamples.delete(index);
    }

    // The candidate is judged against the rest of the scene, not against a
    // pool that includes itself. Pooling makes the bar rise with the very
    // speed being measured, so a lone fast cursor — the commonest case — can
    // never clear 2.5x its own average and nothing is ever promoted.
    let restSum = 0;
    let restCount = 0;
    for (const [index, samples] of this.spotlightVelocitySamples) {
      if (index === soloistIndex) continue;
      for (const [, velocity] of samples) {
        restSum += velocity;
        restCount++;
      }
    }
    const restAverage = restCount > 0 ? restSum / restCount : 0;
    this.spotlightSceneAverage = restAverage;

    const qualifies =
      soloistIndex !== null &&
      soloistVelocity >= SPOTLIGHT_TUNING.minVelocity &&
      // With no other trail to compare against, clearing the absolute floor is
      // enough: a single fast mover is by definition the scene's outlier.
      (restCount === 0 ||
        soloistVelocity > restAverage * SPOTLIGHT_TUNING.velocityRatio);

    this.spotlightTrailIndex = qualifies ? soloistIndex : null;

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

  /** Step one trail's spotlight multiplier toward its target for this frame. */
  private advanceSpotlightGain(trailIndex: number): number {
    const hasSoloist = this.spotlightTrailIndex !== null;
    const isSoloist = this.spotlightTrailIndex === trailIndex;
    const target = !hasSoloist
      ? 1
      : isSoloist
        ? SPOTLIGHT_TUNING.soloistGain
        : SPOTLIGHT_TUNING.duckedGain;

    const current = this.spotlightGains.get(trailIndex) ?? 1;
    // Ducking engages faster than it recovers, so the soloist reads clearly
    // but the scene does not pump back up the instant they slow.
    const durationSeconds =
      target < current
        ? SPOTLIGHT_TUNING.attackSeconds
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
    this.spotlightTrailIndex = null;
    this.spotlightSceneAverage = 0;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
