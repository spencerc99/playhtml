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
