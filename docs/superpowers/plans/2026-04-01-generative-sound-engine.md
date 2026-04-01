# Generative Sound Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generative sound engine that derives music from cursor trail data in the movement visualization, with all instruments sharing a key so they harmonize.

**Architecture:** A `SoundEngine` class using the Web Audio API, called from the existing `AnimatedTrails` rAF loop. Each animation frame, the engine receives trail frame data (cursor position, direction, velocity, cursor type) and maps these to musical parameters. Direction selects pitch from a shared pentatonic scale, velocity controls dynamics, cursor type selects instrument timbre, and multiple simultaneous trails produce polyphony. Clicks trigger percussive bell tones with reverb decay.

**Tech Stack:** Web Audio API (OscillatorNode, GainNode, ConvolverNode, BiquadFilterNode), no external audio libraries.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `website/internet-series/movement/sound/SoundEngine.ts` | Core engine: AudioContext lifecycle, frame-by-frame tick, voice management, master gain/reverb |
| `website/internet-series/movement/sound/scales.ts` | Scale definitions, direction-to-pitch mapping |
| `website/internet-series/movement/sound/instruments.ts` | Instrument definitions: oscillator types, envelopes, filter settings per cursor type |
| `website/internet-series/movement/sound/types.ts` | Shared types for sound system (TrailSoundFrame, InstrumentConfig, etc.) |
| `website/internet-series/movement/components/AnimatedTrails.tsx` | Modify: integrate SoundEngine into the rAF loop |
| `website/internet-series/movement/components/MovementCanvas.tsx` | Modify: add sound toggle UI, pass sound-enabled prop |

---

### Task 1: Sound Type Definitions

**Files:**
- Create: `website/internet-series/movement/sound/types.ts`

- [ ] **Step 1: Create the sound types file**

```ts
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
}

/** A click/hold event to be sonified as a percussive bell */
export interface ClickSoundEvent {
  x: number;
  y: number;
  /** Hold duration in ms. undefined = normal click */
  holdDuration: number | undefined;
}

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
```

- [ ] **Step 2: Commit**

```bash
git add website/internet-series/movement/sound/types.ts
git commit -m "feat(movement): add type definitions for generative sound engine"
```

---

### Task 2: Scale and Direction-to-Pitch Mapping

**Files:**
- Create: `website/internet-series/movement/sound/scales.ts`

- [ ] **Step 1: Create the scales file**

The scale is D minor pentatonic (D, F, G, A, C) across two octaves, mapped to 8 compass directions. Movement direction determines which scale degree plays.

```ts
// ABOUTME: Musical scale definitions and direction-to-pitch mapping
// ABOUTME: Maps cursor movement direction to notes in a shared pentatonic scale

/** D minor pentatonic across two octaves (Hz values) */
const D_MINOR_PENTATONIC = [
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
 * Map a direction angle (radians) to a scale degree.
 * 0 = right, PI/2 = down, PI = left, -PI/2 = up.
 * Quantizes to 8 compass directions, each mapped to a scale degree.
 */
export function directionToPitch(angleRadians: number): number {
  // Normalize to 0-2PI
  const normalized = ((angleRadians % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  // 8 compass directions, each covering a 45-degree arc
  // Index 0 = right (centered on 0 radians)
  const directionIndex = Math.round((normalized / (2 * Math.PI)) * 8) % 8;

  // Map 8 directions to scale degrees across two octaves:
  // Right=D3, UpRight=F3, Up=G3, UpLeft=A3,
  // Left=C4, DownLeft=D4, Down=F4, DownRight=G4
  const DIRECTION_TO_SCALE_INDEX = [0, 1, 2, 3, 4, 5, 6, 7];

  return D_MINOR_PENTATONIC[DIRECTION_TO_SCALE_INDEX[directionIndex]];
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
  const MIN_VELOCITY = 0.5; // Below this, silence (cursor is basically still)
  const MAX_VELOCITY = 30;  // Above this, max volume
  if (velocity < MIN_VELOCITY) return 0;
  const normalized = Math.min(1, (velocity - MIN_VELOCITY) / (MAX_VELOCITY - MIN_VELOCITY));
  // Ease-in curve so quiet movements are more common than loud ones
  return normalized * normalized * 0.3; // Max gain 0.3 to keep it ambient
}

/**
 * Map x position to stereo pan (-1 = left, 1 = right).
 * canvasWidth is needed to normalize.
 */
export function positionToPan(x: number, canvasWidth: number): number {
  if (canvasWidth <= 0) return 0;
  return (x / canvasWidth) * 2 - 1;
}
```

- [ ] **Step 2: Commit**

```bash
git add website/internet-series/movement/sound/scales.ts
git commit -m "feat(movement): add scale definitions and direction-to-pitch mapping"
```

---

### Task 3: Instrument Definitions

**Files:**
- Create: `website/internet-series/movement/sound/instruments.ts`

- [ ] **Step 1: Create instrument configs mapped to cursor types**

Each cursor type gets a different timbre. The instruments are ambient and soft — sine/triangle waves with long releases.

```ts
// ABOUTME: Instrument definitions mapped to cursor types
// ABOUTME: Each cursor type produces a different timbre via oscillator type and envelope

import { InstrumentConfig } from "./types";

/** Default instrument for unknown cursor types */
const DEFAULT_INSTRUMENT: InstrumentConfig = {
  oscillatorType: "sine",
  attack: 0.1,
  decay: 0.3,
  sustain: 0.2,
  release: 1.5,
  filterFrequency: 2000,
  filterQ: 1,
  gain: 0.15,
};

/**
 * Map of cursor type string to instrument configuration.
 * Cursor types come from the CSS cursor property captured in trail data:
 * "default", "pointer", "text", "grab", "grabbing", "crosshair", etc.
 */
const CURSOR_INSTRUMENTS: Record<string, InstrumentConfig> = {
  // Standard arrow cursor — warm sine tone
  default: {
    oscillatorType: "sine",
    attack: 0.1,
    decay: 0.4,
    sustain: 0.15,
    release: 2.0,
    filterFrequency: 1800,
    filterQ: 1,
    gain: 0.12,
  },
  // Pointer/link cursor — brighter triangle tone
  pointer: {
    oscillatorType: "triangle",
    attack: 0.05,
    decay: 0.2,
    sustain: 0.3,
    release: 1.0,
    filterFrequency: 3000,
    filterQ: 1.5,
    gain: 0.15,
  },
  // Text cursor — soft, airy square wave (heavily filtered)
  text: {
    oscillatorType: "square",
    attack: 0.15,
    decay: 0.5,
    sustain: 0.1,
    release: 2.5,
    filterFrequency: 800,
    filterQ: 2,
    gain: 0.08,
  },
  // Grab cursor — deep, resonant triangle
  grab: {
    oscillatorType: "triangle",
    attack: 0.2,
    decay: 0.6,
    sustain: 0.25,
    release: 1.8,
    filterFrequency: 1200,
    filterQ: 3,
    gain: 0.12,
  },
  // Grabbing (actively dragging) — slightly brighter than grab
  grabbing: {
    oscillatorType: "triangle",
    attack: 0.05,
    decay: 0.3,
    sustain: 0.35,
    release: 1.2,
    filterFrequency: 1600,
    filterQ: 2,
    gain: 0.14,
  },
  // Crosshair — precise, thin sawtooth (heavily filtered)
  crosshair: {
    oscillatorType: "sawtooth",
    attack: 0.02,
    decay: 0.15,
    sustain: 0.2,
    release: 0.8,
    filterFrequency: 1000,
    filterQ: 4,
    gain: 0.06,
  },
};

/**
 * Get the instrument config for a cursor type.
 * Falls back to DEFAULT_INSTRUMENT for unknown types.
 */
export function getInstrument(cursorType: string | undefined): InstrumentConfig {
  if (!cursorType) return DEFAULT_INSTRUMENT;
  return CURSOR_INSTRUMENTS[cursorType] ?? DEFAULT_INSTRUMENT;
}

/**
 * Bell instrument config for click events.
 * Uses a sine wave with fast attack and long, reverberant decay.
 */
export const CLICK_BELL: InstrumentConfig = {
  oscillatorType: "sine",
  attack: 0.005,
  decay: 0.1,
  sustain: 0.0,
  release: 3.0,
  filterFrequency: 4000,
  filterQ: 0.5,
  gain: 0.2,
};
```

- [ ] **Step 2: Commit**

```bash
git add website/internet-series/movement/sound/instruments.ts
git commit -m "feat(movement): add instrument definitions per cursor type"
```

---

### Task 4: SoundEngine Core

**Files:**
- Create: `website/internet-series/movement/sound/SoundEngine.ts`

- [ ] **Step 1: Create the SoundEngine class**

The engine manages an AudioContext, a pool of voices (one per active trail), and a master output chain with reverb. The `tick()` method is called each rAF frame.

```ts
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

/** Minimum velocity to trigger any sound */
const SILENCE_VELOCITY_THRESHOLD = 0.5;

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

    // Click pitch based on y position (higher on screen = higher pitch)
    // Using a pentatonic-safe frequency range
    const pitchRatio = 1 - (click.y / (window.innerHeight || 800));
    const baseFreq = 400 + pitchRatio * 800; // 400-1200 Hz range
    osc.frequency.value = baseFreq;

    // Second harmonic for bell-like quality
    const osc2 = this.ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = baseFreq * 2.76; // Inharmonic partial for bell timbre

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
    osc.frequency.value = 0; // Will be set on first note

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
```

- [ ] **Step 2: Commit**

```bash
git add website/internet-series/movement/sound/SoundEngine.ts
git commit -m "feat(movement): add SoundEngine core with voice management and click bells"
```

---

### Task 5: Integrate SoundEngine into AnimatedTrails

**Files:**
- Modify: `website/internet-series/movement/components/AnimatedTrails.tsx`

This is the key integration. The sound engine taps into the existing rAF loop, receiving trail frame data that's already being computed for rendering.

- [ ] **Step 1: Add SoundEngine import and prop**

At the top of `AnimatedTrails.tsx`, add the import and extend the props interface:

```ts
// Add import at top of file, after existing imports:
import { SoundEngine } from "../sound/SoundEngine";
import type { TrailSoundFrame } from "../sound/types";
```

In the `AnimatedTrailsProps` interface (line ~298), add:

```ts
  /** Optional sound engine instance. When provided, trail frame data is fed to it each animation frame. */
  soundEngine?: SoundEngine | null;
```

- [ ] **Step 2: Feed trail frame data to the sound engine in the rAF loop**

Inside the `animate` function (around line 508-551, the `for` loop that updates all trails imperatively), collect trail frames and feed them to the sound engine after the loop.

After the existing `for` loop that updates all trails (after line 551 `}` closing the for loop, before the `visibleSetRef.current = newVisible;` line), add:

```ts
        // Feed active trail frames to sound engine
        if (soundEngineRef.current?.isEnabled()) {
          const soundFrames: TrailSoundFrame[] = [];
          for (let idx = 0; idx < currentTrailStates.length; idx++) {
            const fade = fades[idx];
            if (fade <= 0) continue;

            const frame = computeTrailFrame(
              currentTrailStates[idx],
              loopedElapsed,
              generatePath,
            );
            if (!frame || frame.isFinished) continue;

            soundFrames.push({
              trailIndex: idx,
              x: frame.cursorPosition.x,
              y: frame.cursorPosition.y,
              prevX: frame.cursorPosition.x, // SoundEngine tracks prev internally
              prevY: frame.cursorPosition.y,
              cursorType: frame.cursorType,
              progress: frame.trailProgress,
              color: currentTrailStates[idx].trail.color,
              isNewlyActive: false,
            });
          }
          soundEngineRef.current.tick(loopedElapsed, soundFrames);
        }
```

Note: `computeTrailFrame` is already called per-trail inside each `ImperativeTrailHandle.update()`. To avoid double-computing, we can instead collect frame results from the existing update calls. Modify the existing trail update loop to collect results:

Replace the existing trail update loop (lines ~508-551) with:

```ts
        // Update all trails imperatively and collect frame data for sound
        const trailResults: Array<{
          idx: number;
          result: { trailProgress: number; cursorPosition: { x: number; y: number } } | null;
          cursorType: string | undefined;
        }> = [];

        for (let idx = 0; idx < currentTrailStates.length; idx++) {
          const handle = trailHandles.current[idx];
          if (!handle) continue;

          const fade = fades[idx];
          const result = handle.update(
            loopedElapsed,
            trailOpacity,
            strokeWidth,
            fade,
          );

          if (fade > 0) newVisible.add(idx);

          // Collect result for sound engine
          if (result) {
            const ts = currentTrailStates[idx];
            const currentPointIndex = Math.min(
              Math.floor((ts.trail.points.length - 1) * result.trailProgress),
              ts.trail.points.length - 1,
            );
            trailResults.push({
              idx,
              result,
              cursorType: ts.trail.points[currentPointIndex]?.cursor,
            });
          }

          // Spawn clicks (existing logic unchanged)
          if (result && showClickRipplesRef.current) {
            const ts = currentTrailStates[idx];
            const trailKey = `trail-${idx}`;
            if (!spawnedClicksRef.current.has(trailKey)) {
              spawnedClicksRef.current.set(trailKey, new Set());
            }
            const spawnedSet = spawnedClicksRef.current.get(trailKey)!;

            ts.clicksWithProgress.forEach((click, clickIdx) => {
              if (
                result.trailProgress >= click.progress &&
                !spawnedSet.has(clickIdx)
              ) {
                spawnedSet.add(clickIdx);

                // Trigger click sound
                if (soundEngineRef.current?.isEnabled()) {
                  soundEngineRef.current.triggerClick({
                    x: result.cursorPosition.x,
                    y: result.cursorPosition.y,
                    holdDuration: click.duration,
                  });
                }

                pendingClicks.current.push({
                  id: `${idx}-${clickIdx}-${Date.now()}`,
                  x: result.cursorPosition.x,
                  y: result.cursorPosition.y,
                  color: ts.trail.color,
                  radiusFactor: Math.random(),
                  durationFactor: Math.random(),
                  startTime: Date.now(),
                  trailIndex: idx,
                  holdDuration: click.duration,
                });
              }
            });
          }
        }

        // Feed sound engine with collected trail frames
        if (soundEngineRef.current?.isEnabled()) {
          const soundFrames: TrailSoundFrame[] = trailResults.map((tr) => ({
            trailIndex: tr.idx,
            x: tr.result!.cursorPosition.x,
            y: tr.result!.cursorPosition.y,
            prevX: tr.result!.cursorPosition.x,
            prevY: tr.result!.cursorPosition.y,
            cursorType: tr.cursorType,
            progress: tr.result!.trailProgress,
            color: currentTrailStates[tr.idx].trail.color,
            isNewlyActive: false,
          }));
          soundEngineRef.current.tick(loopedElapsed, soundFrames);
        }
```

- [ ] **Step 3: Add soundEngine ref and loop-wrap reset**

Near the top of the component function (around line 393 where other refs are declared), add:

```ts
    const soundEngineRef = useRef<SoundEngine | null>(null);

    useEffect(() => {
      soundEngineRef.current = soundEngine ?? null;
    }, [soundEngine]);
```

Where `soundEngine` comes from the destructured props.

In the loop-wrap detection block (line ~486-489), add sound engine reset:

```ts
        if (loopedElapsed < prevElapsedRef.current) {
          spawnedClicksRef.current.clear();
          setActiveClickEffects([]);
          soundEngineRef.current?.reset();
        }
```

- [ ] **Step 4: Commit**

```bash
git add website/internet-series/movement/components/AnimatedTrails.tsx
git commit -m "feat(movement): integrate SoundEngine into AnimatedTrails rAF loop"
```

---

### Task 6: Add Sound Toggle to MovementCanvas

**Files:**
- Modify: `website/internet-series/movement/components/MovementCanvas.tsx`

- [ ] **Step 1: Add SoundEngine lifecycle management**

Add imports at top:

```ts
import { SoundEngine } from "../sound/SoundEngine";
```

Inside the `MovementCanvas` component, add state and refs for the sound engine (after the existing state declarations, around line 148):

```ts
  const [soundEnabled, setSoundEnabled] = useState(false);
  const soundEngineRef = useRef<SoundEngine | null>(null);
```

Add an effect to manage the SoundEngine lifecycle:

```ts
  // Manage SoundEngine lifecycle
  useEffect(() => {
    if (soundEnabled) {
      if (!soundEngineRef.current) {
        const engine = new SoundEngine();
        engine.init().then(() => {
          engine.setCanvasWidth(viewportSize.width);
          soundEngineRef.current = engine;
        });
      }
    } else {
      if (soundEngineRef.current) {
        soundEngineRef.current.dispose();
        soundEngineRef.current = null;
      }
    }
    return () => {
      soundEngineRef.current?.dispose();
      soundEngineRef.current = null;
    };
  }, [soundEnabled]);

  // Keep canvas width in sync
  useEffect(() => {
    soundEngineRef.current?.setCanvasWidth(viewportSize.width);
  }, [viewportSize.width]);
```

- [ ] **Step 2: Pass soundEngine to AnimatedTrails**

In the JSX where `<AnimatedTrails>` is rendered (around line 646), add the prop:

```tsx
          <AnimatedTrails
            key={`trails-${settings.domainFilter}`}
            trailStates={trailStates}
            timeRange={timeRange}
            showClickRipples={!showClicks}
            windowSize={settings.maxConcurrentTrails * 2}
            soundEngine={soundEnabled ? soundEngineRef.current : null}
            settings={{
              // ... existing settings unchanged
            }}
          />
```

- [ ] **Step 3: Add a minimal sound toggle button**

Add a sound toggle button in the JSX, near the title span or controls area. Place it after the domain filter badge (around line 592), before the canvas-container div:

```tsx
      <button
        onClick={() => setSoundEnabled((prev) => !prev)}
        style={{
          position: "absolute",
          bottom: 20,
          left: 20,
          zIndex: 200,
          padding: "8px 14px",
          background: soundEnabled ? "#3d3833" : "#faf9f6",
          color: soundEnabled ? "#faf9f6" : "#3d3833",
          border: "1px solid #3d3833",
          fontFamily: "'Martian Mono', monospace",
          fontSize: "11px",
          letterSpacing: "0.5px",
          cursor: "pointer",
          textTransform: "uppercase",
        }}
      >
        {soundEnabled ? "sound on" : "sound off"}
      </button>
```

- [ ] **Step 4: Commit**

```bash
git add website/internet-series/movement/components/MovementCanvas.tsx
git commit -m "feat(movement): add sound toggle and SoundEngine lifecycle to MovementCanvas"
```

---

### Task 7: Manual Testing and Tuning

**Files:**
- No new files

- [ ] **Step 1: Start the dev server and test**

```bash
cd /Users/spencerchang/Projects/playhtml && bun dev
```

Open the movement page in a browser. Click "sound off" to enable sound. Verify:
1. Sound plays as cursor trails animate
2. Different cursor types produce different timbres
3. Movement direction changes pitch
4. Faster cursor movement = louder
5. Click ripples trigger bell sounds
6. Multiple simultaneous trails produce polyphony in the same key
7. Sound stops when trails finish
8. Loop wrap resets sound cleanly
9. Toggling sound off silences everything and cleans up

- [ ] **Step 2: Tune parameters if needed**

Key tuning knobs in `scales.ts`:
- `MIN_VELOCITY` / `MAX_VELOCITY` in `velocityToGain` — adjust sensitivity
- The `0.3` max gain cap — adjust overall volume of trail sounds

Key tuning knobs in `SoundEngine.ts`:
- `MIN_NOTE_INTERVAL_MS` — how fast notes can change (higher = more melodic, lower = more glitchy)
- Master gain value (0.5) — overall volume
- Reverb gain (0.3) — wetness

Key tuning knobs in `instruments.ts`:
- Individual instrument gain values — balance between cursor types
- Filter frequencies — brightness of each instrument
- Release times — how long notes linger

- [ ] **Step 3: Commit any tuning changes**

```bash
git add -u website/internet-series/movement/sound/
git commit -m "fix(movement): tune sound engine parameters"
```
