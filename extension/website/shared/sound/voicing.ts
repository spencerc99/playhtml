// ABOUTME: The playground's single source of truth for how each event family is voiced
// ABOUTME: Owned by the Sound Layers panel and read by the sample replay driver

import {
  ClickPercussionVariant,
  PizzicatoVariant,
  PIZZICATO_VARIANTS,
  TimpaniVariant,
} from "./types";

/**
 * How a click is voiced. The bell and the pizzicati are alternatives to each
 * other: a click gets exactly one voice, and "bells" is the shipped one.
 *
 * The unpitched noise-tap candidates were auditioned and set aside, so they are
 * not offered here. Their audition cards remain in the Sound Library, which is
 * where a sound nobody has chosen belongs.
 */
export type ClickVoice = "bells" | PizzicatoVariant;

/** How a held click is voiced: the stretched bell, or a timpani roll. */
export type HoldVoice = "bell" | TimpaniVariant;

/**
 * Everything the panel decides about voicing, in one object so the replay
 * driver reads a single settled answer rather than assembling one from
 * scattered toggles.
 */
export interface VoicingSettings {
  click: ClickVoice;
  hold: HoldVoice;
}

export const VOICING_DEFAULTS: VoicingSettings = {
  click: "bells",
  hold: "bell",
};

export const CLICK_VOICES: Array<{ voice: ClickVoice; label: string }> = [
  { voice: "bells", label: "bells" },
  { voice: "soft", label: "pizz. soft" },
  { voice: "crisp", label: "pizz. crisp" },
  { voice: "double", label: "pizz. double" },
];

export const HOLD_VOICES: Array<{ voice: HoldVoice; label: string }> = [
  { voice: "bell", label: "bell" },
  { voice: "root", label: "timp. root" },
  { voice: "rootFifth", label: "timp. root+5th" },
  { voice: "swell", label: "timp. swell" },
];

/** Whether a click voice is one of the pizzicati, so the driver knows the call. */
export const isPizzicato = (voice: ClickVoice): voice is PizzicatoVariant =>
  (PIZZICATO_VARIANTS as string[]).includes(voice);

/** Whether a hold voice is a timpani roll rather than the stretched bell. */
export const isTimpani = (voice: HoldVoice): voice is TimpaniVariant =>
  voice !== "bell";

/**
 * The noise-tap click candidates, kept only so the Sound Library can still
 * audition them. Nothing selects these as a live voice.
 */
export const SET_ASIDE_CLICK_VARIANTS: ClickPercussionVariant[] = [
  "tap",
  "tapNoThump",
  "hybrid",
];
