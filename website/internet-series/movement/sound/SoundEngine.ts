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

/** Interval between repeated plucks for percussive cursor types like text (ms) */
const PLUCK_REPEAT_INTERVAL_MS = 120;

/** Distance threshold for trail crossing detection (pixels) */
const CROSSING_DISTANCE_THRESHOLD = 15;

/** Minimum time between crossing triggers for the same pair (ms) */
const CROSSING_COOLDOWN_MS = 500;

/** Configurable sound modes */
export interface SoundConfig {
  chordVoicing: boolean;
  cursorInstruments: boolean;
  crossingDissonance: boolean;
}

const DEFAULT_CONFIG: SoundConfig = {
  chordVoicing: false,
  cursorInstruments: false,
  crossingDissonance: false,
};

/** Cursor types that use repeating pluck instead of sustained tone */
const PERCUSSIVE_CURSOR_TYPES = new Set(["text"]);

/** Per-trail voice state */
interface Voice {
  oscillator: OscillatorNode | null;
  /** Fifth oscillator for chord voicing mode */
  fifthOscillator: OscillatorNode | null;
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
  private prevPositions: Map<number, { x: number; y: number }> = new Map();
  /** Accumulated path history per trail for crossing detection */
  private trailPaths: Map<number, Array<{ x: number; y: number }>> = new Map();
  private config: SoundConfig = { ...DEFAULT_CONFIG };
  /** Tracks recent crossing events to prevent rapid re-triggering */
  private crossingCooldowns: Map<string, number> = new Map();

  async init(): Promise<void> {
    if (this.ctx) return;

    this.ctx = new AudioContext();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5;

    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.createReverbImpulse(this.ctx, 3.0, 2.0);

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.3;

    this.masterGain.connect(this.ctx.destination);
    this.masterGain.connect(this.reverbGain);
    this.reverbGain.connect(this.convolver);
    this.convolver.connect(this.ctx.destination);

    this.enabled = true;
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
  }

  /** Update sound configuration (chord voicing, cursor instruments, crossings) */
  setConfig(config: Partial<SoundConfig>): void {
    const prevChord = this.config.chordVoicing;
    Object.assign(this.config, config);

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

    const activeIndices = new Set(activeTrails.map((t) => t.trailIndex));

    for (const [idx, voice] of this.voices) {
      if (!activeIndices.has(idx) && voice.active) {
        this.releaseVoice(voice);
      }
    }

    for (const frame of activeTrails) {
      const prev = this.prevPositions.get(frame.trailIndex);
      const prevX = prev?.x ?? frame.x;
      const prevY = prev?.y ?? frame.y;

      const velocity = computeVelocity(prevX, prevY, frame.x, frame.y);
      const gain = velocityToGain(velocity);

      this.prevPositions.set(frame.trailIndex, { x: frame.x, y: frame.y });

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
      const frequency = directionToPitch(direction);
      const pan = positionToPan(frame.x, this.canvasWidth);

      // When cursor instruments are off, use the default instrument for all
      const instrument = this.config.cursorInstruments
        ? getInstrument(frame.cursorType)
        : getInstrument(undefined);

      let voice = this.voices.get(frame.trailIndex);

      if (!voice) {
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

      if (isPercussive) {
        if (elapsedMs - voice.lastPluckMs > PLUCK_REPEAT_INTERVAL_MS) {
          voice.lastPluckMs = elapsedMs;
          const now = this.ctx.currentTime;
          const pluckGain = gain * instrument.gain;
          // Sharp attack, quick decay — percussive envelope
          voice.gainNode.gain.cancelScheduledValues(now);
          voice.gainNode.gain.setValueAtTime(pluckGain, now);
          voice.gainNode.gain.exponentialRampToValueAtTime(
            0.001,
            now + instrument.attack + instrument.decay + instrument.release,
          );
        }
      } else {
        voice.gainNode.gain.linearRampToValueAtTime(
          gain * instrument.gain,
          this.ctx.currentTime + 0.05,
        );
      }

      voice.panNode.pan.linearRampToValueAtTime(
        pan,
        this.ctx.currentTime + 0.05,
      );

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
    const now = this.ctx.currentTime;

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

    osc.connect(filter);
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

    fifthOsc.connect(filter); // Share the same filter chain
    fifthOsc.start(now);

    // Route fifth gain separately so we can control its level
    // Actually, the fifth goes through the same filter -> gain -> pan chain
    // but we control its presence via fifthGain before the filter
    fifthOsc.disconnect();
    fifthOsc.connect(fifthGain);
    fifthGain.connect(filter);

    return {
      oscillator: osc,
      fifthOscillator: fifthOsc,
      gainNode: gain,
      fifthGainNode: fifthGain,
      filterNode: filter,
      panNode: pan,
      currentFrequency: 0,
      lastNoteTimeMs: 0,
      lastCursorType: undefined,
      lastPluckMs: 0,
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

    if (voice.oscillator && voice.oscillator.type !== instrument.oscillatorType) {
      const oldOsc = voice.oscillator;
      const newOsc = this.ctx.createOscillator();
      newOsc.type = instrument.oscillatorType;
      newOsc.frequency.value = voice.currentFrequency || 220;
      newOsc.connect(voice.filterNode);
      newOsc.start(this.ctx.currentTime);
      oldOsc.stop(this.ctx.currentTime + 0.05);
      voice.oscillator = newOsc;

      // Also update the fifth oscillator type to match
      if (voice.fifthOscillator && voice.fifthGainNode) {
        const oldFifth = voice.fifthOscillator;
        const newFifth = this.ctx.createOscillator();
        newFifth.type = instrument.oscillatorType;
        newFifth.frequency.value = (voice.currentFrequency || 220) * 1.5;
        newFifth.connect(voice.fifthGainNode);
        voice.fifthGainNode.connect(voice.filterNode);
        newFifth.start(this.ctx.currentTime);
        oldFifth.stop(this.ctx.currentTime + 0.05);
        voice.fifthOscillator = newFifth;
      }
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
    const now = this.ctx.currentTime;
    voice.gainNode.gain.linearRampToValueAtTime(0, now + 0.5);
    voice.active = false;

    if (voice.oscillator) {
      voice.oscillator.stop(now + 0.6);
      voice.oscillator = null;
    }
    if (voice.fifthOscillator) {
      voice.fifthOscillator.stop(now + 0.6);
      voice.fifthOscillator = null;
    }
  }

  setVolume(volume: number): void {
    if (!this.masterGain || !this.ctx) return;
    this.masterGain.gain.linearRampToValueAtTime(
      volume,
      this.ctx.currentTime + 0.05,
    );
  }

  dispose(): void {
    this.enabled = false;
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
    this.crossingCooldowns.clear();
    this.trailPaths.clear();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }

  reset(): void {
    for (const [, voice] of this.voices) {
      this.releaseVoice(voice);
    }
    this.voices.clear();
    this.prevPositions.clear();
    this.crossingCooldowns.clear();
    this.trailPaths.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
