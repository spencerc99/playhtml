// ABOUTME: Core generative sound engine driven by cursor trail animation data
// ABOUTME: Manages Web Audio voices, maps trail frames to musical parameters each animation frame

import { TrailSoundFrame, ClickSoundEvent, InstrumentConfig } from "./types";
import {
  directionToPitch,
  computeDirection,
  computeVelocity,
  velocityToGain,
  positionToPan,
} from "./scales";
import { getInstrument, CLICK_BELL } from "./instruments";

/** Minimum time between note changes for a single voice (ms) */
const MIN_NOTE_INTERVAL_MS = 80;

/** Minimum velocity to trigger any sound (pixels per frame at ~60fps) */
const SILENCE_VELOCITY_THRESHOLD = 0.05;

/** Per-trail voice state */
interface Voice {
  oscillator: OscillatorNode | null;
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
  panNode: StereoPannerNode;
  currentFrequency: number;
  lastNoteTimeMs: number;
  lastCursorType: string | undefined;
  /** Track whether voice is currently sounding */
  active: boolean;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverbGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private voices: Map<number, Voice> = new Map();
  private canvasWidth: number = 0;
  private enabled: boolean = false;
  /** Tracks previous frame positions for direction calculation */
  private prevPositions: Map<number, { x: number; y: number }> = new Map();

  /**
   * Initialize the AudioContext. Must be called from a user gesture.
   */
  async init(): Promise<void> {
    if (this.ctx) return;

    this.ctx = new AudioContext();

    // Master gain (overall volume)
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5;

    // Reverb send via convolver with synthetic impulse response
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.createReverbImpulse(this.ctx, 3.0, 2.0);

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.3;

    // Routing: voices -> masterGain -> destination
    //                  -> reverbGain -> convolver -> destination
    this.masterGain.connect(this.ctx.destination);
    this.masterGain.connect(this.reverbGain);
    this.reverbGain.connect(this.convolver);
    this.convolver.connect(this.ctx.destination);

    this.enabled = true;
  }

  /**
   * Create a synthetic reverb impulse response.
   * Generates exponentially decaying white noise.
   */
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

  /** Update canvas width for pan calculations */
  setCanvasWidth(width: number): void {
    this.canvasWidth = width;
  }

  /**
   * Called each animation frame with the current trail states.
   * This is the main sonification loop.
   *
   * @param elapsedMs - Current looped elapsed time in the animation
   * @param activeTrails - Trail frames that are currently visible/animating
   */
  tick(elapsedMs: number, activeTrails: TrailSoundFrame[]): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;

    // Resume context if suspended (autoplay policy)
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    const activeIndices = new Set(activeTrails.map((t) => t.trailIndex));

    // Release voices for trails that are no longer active
    for (const [idx, voice] of this.voices) {
      if (!activeIndices.has(idx) && voice.active) {
        this.releaseVoice(voice);
      }
    }

    // Process each active trail
    for (const frame of activeTrails) {
      const prev = this.prevPositions.get(frame.trailIndex);
      const prevX = prev?.x ?? frame.x;
      const prevY = prev?.y ?? frame.y;

      const velocity = computeVelocity(prevX, prevY, frame.x, frame.y);
      const gain = velocityToGain(velocity);

      // Store current position for next frame
      this.prevPositions.set(frame.trailIndex, { x: frame.x, y: frame.y });

      // Below velocity threshold = silence for this trail
      if (velocity < SILENCE_VELOCITY_THRESHOLD) {
        const voice = this.voices.get(frame.trailIndex);
        if (voice?.active) {
          this.fadeVoice(voice, 0.05);
        }
        continue;
      }

      const direction = computeDirection(prevX, prevY, frame.x, frame.y);
      const frequency = directionToPitch(direction);
      const pan = positionToPan(frame.x, this.canvasWidth);
      const instrument = getInstrument(frame.cursorType);

      let voice = this.voices.get(frame.trailIndex);

      // Create voice if it doesn't exist
      if (!voice) {
        voice = this.createVoice(instrument);
        this.voices.set(frame.trailIndex, voice);
      }

      // Update instrument if cursor type changed
      if (frame.cursorType !== voice.lastCursorType) {
        this.updateVoiceInstrument(voice, instrument);
        voice.lastCursorType = frame.cursorType;
      }

      // Update pitch (with rate limiting to avoid glitchy rapid changes)
      if (
        frequency !== voice.currentFrequency &&
        elapsedMs - voice.lastNoteTimeMs > MIN_NOTE_INTERVAL_MS
      ) {
        this.setVoiceFrequency(voice, frequency);
        voice.lastNoteTimeMs = elapsedMs;
        voice.currentFrequency = frequency;
      }

      // Update gain based on velocity
      voice.gainNode.gain.linearRampToValueAtTime(
        gain * instrument.gain,
        this.ctx.currentTime + 0.05,
      );

      // Update pan based on x position
      voice.panNode.pan.linearRampToValueAtTime(
        pan,
        this.ctx.currentTime + 0.05,
      );

      voice.active = true;
    }
  }

  /**
   * Trigger a bell/percussion sound for a click event.
   */
  triggerClick(click: ClickSoundEvent): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;

    const instrument = CLICK_BELL;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = instrument.oscillatorType;

    // Click pitch from D minor pentatonic, selected by y position
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

    // Octave + fifth partial for bell-like quality (stays consonant)
    const osc2 = this.ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = baseFreq * 3; // 3rd harmonic (octave + fifth)

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

  /** Create a new voice with oscillator, gain, filter, pan */
  private createVoice(instrument: InstrumentConfig): Voice {
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = instrument.oscillatorType;
    osc.frequency.value = 220; // A3 default, will be set on first note

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = instrument.filterFrequency;
    filter.Q.value = instrument.filterQ;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);

    const pan = ctx.createStereoPanner();

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.masterGain!);

    osc.start(now);

    return {
      oscillator: osc,
      gainNode: gain,
      filterNode: filter,
      panNode: pan,
      currentFrequency: 0,
      lastNoteTimeMs: 0,
      lastCursorType: undefined,
      active: false,
    };
  }

  /** Smoothly transition to a new frequency */
  private setVoiceFrequency(voice: Voice, frequency: number): void {
    if (!this.ctx || !voice.oscillator) return;
    voice.oscillator.frequency.exponentialRampToValueAtTime(
      frequency,
      this.ctx.currentTime + 0.08,
    );
  }

  /** Update voice filter/envelope when cursor type changes */
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

    // If oscillator type changed, we need to swap oscillators
    if (voice.oscillator && voice.oscillator.type !== instrument.oscillatorType) {
      const oldOsc = voice.oscillator;
      const newOsc = this.ctx.createOscillator();
      newOsc.type = instrument.oscillatorType;
      newOsc.frequency.value = voice.currentFrequency || 220;
      newOsc.connect(voice.filterNode);
      newOsc.start(this.ctx.currentTime);
      oldOsc.stop(this.ctx.currentTime + 0.05);
      voice.oscillator = newOsc;
    }
  }

  /** Fade a voice to silence quickly (cursor stopped moving) */
  private fadeVoice(voice: Voice, duration: number): void {
    if (!this.ctx) return;
    voice.gainNode.gain.linearRampToValueAtTime(
      0,
      this.ctx.currentTime + duration,
    );
    voice.active = false;
  }

  /** Release a voice (trail ended) and clean up */
  private releaseVoice(voice: Voice): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    voice.gainNode.gain.linearRampToValueAtTime(0, now + 0.5);
    voice.active = false;

    // Stop oscillator after release
    if (voice.oscillator) {
      voice.oscillator.stop(now + 0.6);
      voice.oscillator = null;
    }
  }

  /** Set master volume (0-1) */
  setVolume(volume: number): void {
    if (!this.masterGain || !this.ctx) return;
    this.masterGain.gain.linearRampToValueAtTime(
      volume,
      this.ctx.currentTime + 0.05,
    );
  }

  /** Clean up all audio resources */
  dispose(): void {
    this.enabled = false;
    for (const [, voice] of this.voices) {
      if (voice.oscillator) {
        try {
          voice.oscillator.stop();
        } catch {
          // already stopped
        }
      }
    }
    this.voices.clear();
    this.prevPositions.clear();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }

  /** Reset state (e.g., on animation loop wrap) */
  reset(): void {
    for (const [, voice] of this.voices) {
      this.releaseVoice(voice);
    }
    this.voices.clear();
    this.prevPositions.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
