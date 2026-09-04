// ABOUTME: Audition buttons for every individual sound, grouped by family
// ABOUTME: A reference shelf — hearing one sound alone, including candidates nothing selects

import React, { useCallback } from "react";
import { SoundEngine } from "../shared/sound/SoundEngine";
import { AuditionAccent } from "../shared/sound/types";

const labelStyle: React.CSSProperties = {
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  color: "#8a8279",
};

const buttonStyle: React.CSSProperties = {
  padding: "8px 14px",
  border: "1px solid #e0dbd4",
  background: "#f5f0e8",
  cursor: "pointer",
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  color: "#3d3833",
};

const AUDITION_CARDS: Array<{
  accent: AuditionAccent;
  label: string;
  description: string;
}> = [
  {
    accent: "trailArrival",
    label: "trail arrival",
    description:
      "A door-chime scatter as a trail enters, in the register its colour buys it — a bass trail's woody knock, then a soprano trail's high shimmer.",
  },
  {
    accent: "trailDeparture",
    label: "trail departure",
    description:
      "A shorter falling chime as a trail leaves, in that trail's own register — bass first, then soprano.",
  },
  {
    accent: "navigation",
    label: "navigation gong",
    description: "One deep resonant note marking a page change.",
  },
  {
    accent: "soloistFlourish",
    label: "soloist flourish",
    description: "A single bell from the soloist run, at mid velocity.",
  },
  {
    accent: "soloistResolve",
    label: "soloist resolve",
    description: "The closing note as the spotlight leaves a trail.",
  },
  {
    accent: "crossingShimmer",
    label: "crossing — shimmer",
    description:
      "The gentle variant, for a quiet scene: two tones a few Hz apart on one chord tone, beating slowly.",
  },
  {
    accent: "crossingSuspension",
    label: "crossing — suspension",
    description:
      "The usual variant: a step above a chord tone, held, then falling onto it. Tension, then release.",
  },
  {
    accent: "crossingHarsh",
    label: "crossing — harsh",
    description:
      "The tritone, reserved for busy scenes and rate-limited hard. Does not resolve.",
  },
  {
    accent: "crossingMerge",
    label: "crossing merge",
    description:
      "The consonant dyad two trails sound instead, when crossings merge.",
  },
  {
    accent: "choralSwell",
    label: "choral swell",
    description:
      "One voice through the whole swell — onset, crescendo, release — in the choral vowel.",
  },
  {
    accent: "trailVoicePair",
    label: "two trail voices",
    description:
      "Two example fingerprints in turn, two seconds each — one cool-coloured trail low, one warm-coloured trail high, so the colour-to-register mapping is audible.",
  },
];


/**
 * Unpitched percussion candidates, in isolation. The sample replay below
 * plays the same sounds against real events; these buttons are for judging
 * one on its own, so each description names the event it maps to.
 */
const PERCUSSION_CARDS: Array<{
  accent: AuditionAccent;
  label: string;
  description: string;
}> = [
  {
    accent: "clickTap",
    label: "click tap (pure percussion)",
    description:
      "For a click. A filtered noise edge over a fast pitch drop — woodblock, no ring-out.",
  },
  {
    accent: "clickTapNoThump",
    label: "click tap (no thump)",
    description:
      "The same tap with the falling sine removed — the noise edge alone. Reach for this if a run of taps reads as too heavy in the low end.",
  },
  {
    accent: "clickTapHybrid",
    label: "click tap + bell ghost (hybrid)",
    description:
      "The same tap with a faint short bell underneath, at a quarter of the current click-bell level. Pure vs hybrid, back to back.",
  },
];


/**
 * The pitched orchestral instruments. Unlike the percussion above, every one
 * of these draws its notes from the chord in force, so what they sound depends
 * on where the rotation currently is.
 */
const ORCHESTRAL_CARDS: Array<{
  accent: AuditionAccent;
  label: string;
  description: string;
}> = [
  {
    accent: "pizzicatoSoft",
    label: "pizzicato — soft",
    description:
      "For a click. A warm nylon-ish pluck on a chord tone, the filter closing across a quarter-second decay. Pitched from the click's height, like the bells.",
  },
  {
    accent: "pizzicatoCrisp",
    label: "pizzicato — crisp",
    description:
      "The same pluck, brighter and half the length, with a fingernail of noise on the attack only.",
  },
  {
    accent: "pizzicatoDouble",
    label: "pizzicato — double",
    description:
      "A quieter grace note a chord tone away, then the soft pluck 60ms later. One ornamented gesture rather than two clicks.",
  },
  {
    accent: "timpaniRoot",
    label: "timpani — root",
    description:
      "For a click held down. A tremolo roll on the current chord root, down in D2-D3, building with the hold.",
  },
  {
    accent: "timpaniRootFifth",
    label: "timpani — root + fifth",
    description:
      "The same roll retuning between root and fifth every fifth of a second, so the drum reads as two strokes rather than one pitch.",
  },
  {
    accent: "timpaniSwell",
    label: "timpani — swell",
    description:
      "No tremolo: one sustained low tone crescendoing across the hold and cutting off.",
  },
  {
    accent: "cantusTenor",
    label: "cantus — tenor",
    description:
      "One note of the slow autonomous voice, C3-C4, three seconds in and four out. Switch the voice on below to hear it as a line.",
  },
  {
    accent: "cantusSoprano",
    label: "cantus — soprano",
    description: "The same note an octave up, brighter and quieter.",
  },
  {
    accent: "cantusDuet",
    label: "cantus — duet",
    description:
      "Both duet voices at once, a chord tone apart. Running as a line they alternate rather than land together.",
  },
];


/** One titled grid of audition buttons, each with the event it stands for. */
const AuditionSection = ({
  title,
  blurb,
  cards,
  onAudition,
}: {
  title: string;
  blurb: string;
  cards: Array<{ accent: AuditionAccent; label: string; description: string }>;
  onAudition: (accent: AuditionAccent) => void;
}) => (
  <div style={{ marginTop: "20px" }}>
    <div style={{ ...labelStyle, marginBottom: "4px", color: "#3d3833" }}>
      {title}
    </div>
    <div style={{ ...labelStyle, marginBottom: "10px" }}>{blurb}</div>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
        gap: "8px",
      }}
    >
      {cards.map((card) => (
        <div
          key={card.accent}
          style={{
            border: "1px solid #e0dbd4",
            background: "#faf7f2",
            padding: "10px",
          }}
        >
          <button
            onClick={() => onAudition(card.accent)}
            style={{ ...buttonStyle, width: "100%" }}
          >
            {card.label}
          </button>
          <div style={{ ...labelStyle, marginTop: "8px", lineHeight: 1.4 }}>
            {card.description}
          </div>
        </div>
      ))}
    </div>
  </div>
);


interface SoundLibraryProps {
  /** The shared engine, so an audition rings at whatever chord is in force. */
  getEngine: () => Promise<SoundEngine>;
}

/**
 * Every sound on its own, including candidates the Sound Layers panel does not
 * offer as a live voice. The panel decides what plays; this is where a sound
 * can be heard by itself before deciding.
 */
export const SoundLibrary = ({ getEngine }: SoundLibraryProps) => {
  const handleAudition = useCallback(
    async (accent: AuditionAccent) => {
      // Auditioning is often the first thing pressed on a cold page, so the
      // engine may not exist yet and its context may still be suspended.
      const engine = await getEngine();
      engine.audition(accent);
    },
    [getEngine],
  );

  return (
    <div style={{ marginBottom: "32px" }}>
      <div
        style={{
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "1px",
          marginBottom: "12px",
          fontFamily: "'Martian Mono', monospace",
          fontSize: "11px",
        }}
      >
        Sound Library
      </div>
      <div style={{ ...labelStyle, marginBottom: "4px" }}>
        Each sound on its own, at the current chord. Nothing here needs its
        layer switched on, and some of these are candidates the panel above does
        not offer as a live voice.
      </div>

      <AuditionSection
        title="Accents"
        blurb="The figures that mark an event or a moment in the scene."
        cards={AUDITION_CARDS}
        onAudition={handleAudition}
      />

      <AuditionSection
        title="Percussion (candidates)"
        blurb="Unpitched, so none of these depends on the chord. The noise-tap clicks were auditioned and set aside — they stay here to be heard, but nothing selects them."
        cards={PERCUSSION_CARDS}
        onAudition={handleAudition}
      />

      <AuditionSection
        title="Orchestral (candidates)"
        blurb="Pitched, so all of these sit inside whatever chord is in force. The pizzicati and the timpani are selectable as click and hold voices in Sound Layers above."
        cards={ORCHESTRAL_CARDS}
        onAudition={handleAudition}
      />
    </div>
  );
};
