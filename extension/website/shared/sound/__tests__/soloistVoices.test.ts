// ABOUTME: The arpeggio and descant soloist voices stay on the chord and under the ceiling
// ABOUTME: Both are constrained to chord tones, which is what separates them from the bell run

import { describe, expect, it } from "vitest";
import {
  chordTones,
  nearestChordTone,
  CHORD_TONE_COUNT,
  PROGRESSIONS,
  PROGRESSION_IDS,
} from "../scales";
import { descantLift, DESCANT_TUNING } from "../SoundEngine";

/** How many semitones apart two pitches are, ignoring direction and octave. */
const pitchClassDistance = (a: number, b: number): number => {
  const semitones = Math.abs(12 * Math.log2(a / b));
  const withinOctave = semitones % 12;
  return Math.min(withinOctave, 12 - withinOctave);
};

describe("chord tones", () => {
  it("are the palette's own triad, plus its octave duplicates", () => {
    for (const id of PROGRESSION_IDS) {
      for (const chord of PROGRESSIONS[id].chords) {
        const tones = chordTones(chord.pitches);
        const triad = chord.pitches.slice(0, CHORD_TONE_COUNT);

        // Every named chord tone is present.
        for (const member of triad) {
          expect(
            tones.some((tone) => Math.abs(tone - member) < 1e-6),
            `${id}/${chord.name} is missing ${member}`,
          ).toBe(true);
        }

        // And nothing else is: every tone shares a pitch class with the triad,
        // so a voice constrained to this list can never land on a colour tone.
        for (const tone of tones) {
          const onChord = triad.some(
            (member) => pitchClassDistance(tone, member) < 1e-6,
          );
          expect(onChord, `${id}/${chord.name} admitted ${tone}`).toBe(true);
        }

        // The list is ascending, which is what makes the arpeggio a roll.
        for (let i = 1; i < tones.length; i++) {
          expect(tones[i]).toBeGreaterThan(tones[i - 1]);
        }
      }
    }
  });

  it("excludes the palette's colour tones", () => {
    // Dm coloured with G and C: the fourth and the seventh are in the palette
    // and must not be in the chord-tone ladder.
    const dm = PROGRESSIONS.circular.chords[0];
    const tones = chordTones(dm.pitches);
    const colour = dm.pitches.slice(CHORD_TONE_COUNT);
    const excluded = colour.filter(
      (pitch) =>
        !dm.pitches
          .slice(0, CHORD_TONE_COUNT)
          .some((member) => pitchClassDistance(pitch, member) < 1e-6),
    );
    expect(excluded.length).toBeGreaterThan(0);
    for (const pitch of excluded) {
      expect(tones.some((tone) => Math.abs(tone - pitch) < 1e-6)).toBe(false);
    }
  });

  it("leads a pitch onto the nearest chord tone, never past one", () => {
    const dm = PROGRESSIONS.circular.chords[0].pitches;
    const tones = chordTones(dm);
    for (const pitch of dm) {
      const led = nearestChordTone(pitch, dm);
      expect(tones).toContain(led);
      // Nothing in the ladder is closer than the one it chose.
      const chosenDistance = Math.abs(12 * Math.log2(led / pitch));
      for (const tone of tones) {
        expect(Math.abs(12 * Math.log2(tone / pitch))).toBeGreaterThanOrEqual(
          chosenDistance - 1e-6,
        );
      }
    }
    // A pitch already on the chord stays exactly where it is.
    expect(nearestChordTone(dm[0], dm)).toBe(dm[0]);
  });

  it("returns the pitch unchanged when there is no palette to lead onto", () => {
    expect(chordTones([])).toEqual([]);
    expect(nearestChordTone(440, [])).toBe(440);
  });
});

describe("the descant's lift", () => {
  const CEILING_HZ = DESCANT_TUNING.ceilingHz;

  it("raises a chord tone by exactly an octave, so it stays the same chord tone", () => {
    const dm = PROGRESSIONS.circular.chords[0].pitches;
    for (const tone of chordTones(dm)) {
      const lifted = descantLift(tone);
      expect(pitchClassDistance(lifted, tone)).toBeLessThan(1e-6);
    }
  });

  it("never carries a voice over the ensemble's ceiling", () => {
    for (const id of PROGRESSION_IDS) {
      for (const chord of PROGRESSIONS[id].chords) {
        for (const tone of chordTones(chord.pitches)) {
          // A tone already at the top stays where it is rather than climbing
          // out of the band — the alternative is a partial lift, which lands
          // off the octave and reads as out of tune.
          expect(descantLift(tone)).toBeLessThanOrEqual(CEILING_HZ);
        }
      }
    }
  });
});
