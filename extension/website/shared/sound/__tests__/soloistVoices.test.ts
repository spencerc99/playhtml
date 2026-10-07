// ABOUTME: The arpeggio soloist and the presence halo stay on the chord and under the ceiling
// ABOUTME: Both are constrained to chord tones, which is what separates them from the bell run

import { describe, expect, it } from "vitest";
import {
  chordTones,
  nearestChordTone,
  CHORD_TONE_COUNT,
  PROGRESSIONS,
  PROGRESSION_IDS,
} from "../scales";
import { haloPitch, PRESENCE_TUNING } from "../SoundEngine";

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

describe("how far forward presence steps", () => {
  /**
   * The retune Spencer asked for after hearing the promoted voice as "too
   * sharp and sheer". Pinned literally, because each of these was moved down
   * from a value that measured fine and sounded wrong: a regression here is a
   * number creeping back up, which no behavioural test would catch.
   */
  it("is pinned to the values settled on by ear", () => {
    expect(PRESENCE_TUNING.filterHz).toBe(2300);
    expect(PRESENCE_TUNING.vibratoDepthScale).toBe(1.6);
    expect(PRESENCE_TUNING.haloFilterHz).toBe(2000);
    expect(PRESENCE_TUNING.haloGain).toBe(0.2);

    // The lift and the gain that were kept: the promotion is still carried by
    // brightness and closeness rather than by volume.
    expect(PRESENCE_TUNING.vibratoRateScale).toBe(1.2);
    expect(PRESENCE_TUNING.gain).toBe(1.15);
    expect(PRESENCE_TUNING.reverbSendScale).toBe(0.4);
    expect(PRESENCE_TUNING.haloOnsetMs).toBe(800);
  });

  it("keeps the halo darker than the voice it sits above", () => {
    // A sine doubling a filtered voice: brighter than the voice bought only
    // the edge that put the double on top of the singer.
    expect(PRESENCE_TUNING.haloFilterHz).toBeLessThan(PRESENCE_TUNING.filterHz);
  });
});

describe("the presence halo's pitch", () => {
  const CEILING_HZ = PRESENCE_TUNING.haloCeilingHz;

  /** Whether a pitch is a member of a tone set, allowing for octave folding. */
  const isMemberOf = (pitch: number, tones: number[]): boolean =>
    tones.some((tone) => pitchClassDistance(pitch, tone) < 1e-6);

  it("lands on a chord tone whatever pitch the voice is singing", () => {
    for (const id of PROGRESSION_IDS) {
      for (const chord of PROGRESSIONS[id].chords) {
        const tones = chordTones(chord.pitches);
        // Every pitch of the palette, not only its chord tones: the voice
        // spends most of its time on the colour tones the direction mapping
        // hands it, and those are exactly the cases the halo must not double.
        for (const pitch of chord.pitches) {
          const halo = haloPitch(pitch, tones);
          expect(
            isMemberOf(halo, tones),
            `${id}/${chord.name}: halo ${halo} above ${pitch} is off the chord`,
          ).toBe(true);
        }
      }
    }
  });

  it("keeps the double under the soprano band's ceiling wherever it can", () => {
    for (const id of PROGRESSION_IDS) {
      for (const chord of PROGRESSIONS[id].chords) {
        const tones = chordTones(chord.pitches);
        for (const pitch of chord.pitches) {
          // Only a voice already at the ceiling has no harmony left above it
          // to reach; every other pitch stays inside the band.
          if (pitch >= CEILING_HZ) continue;
          expect(
            haloPitch(pitch, tones),
            `${id}/${chord.name}: halo above ${pitch} left the band`,
          ).toBeLessThanOrEqual(CEILING_HZ);
        }
      }
    }
  });

  it("is always a real interval above the voice, never a unison", () => {
    // The tones nearest the top are the ones a lift would carry over the
    // ceiling. That used to collapse the double onto the voice's own pitch,
    // which is heard as the halo vanishing — a cliff rather than a limit.
    for (const id of PROGRESSION_IDS) {
      for (const chord of PROGRESSIONS[id].chords) {
        const tones = chordTones(chord.pitches);
        for (const pitch of chord.pitches) {
          expect(
            haloPitch(pitch, tones),
            `${id}/${chord.name}: halo collapsed onto ${pitch}`,
          ).toBeGreaterThan(pitch);
        }
      }
    }
  });

  it("takes the plain octave when the voice is already at the ceiling", () => {
    const tones = chordTones(PROGRESSIONS.circular.chords[0].pitches);
    const atCeiling = CEILING_HZ * 2;
    // Above the ceiling is the honest answer here: there is no harmony left
    // in the gap, and an octave is still an interval where a unison is not.
    expect(haloPitch(atCeiling, tones)).toBe(
      atCeiling * PRESENCE_TUNING.haloMultiple,
    );
  });

  it("falls back to the plain octave when there is no harmony to land on", () => {
    expect(haloPitch(220, [])).toBe(440);
  });
});
