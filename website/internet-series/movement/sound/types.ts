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
