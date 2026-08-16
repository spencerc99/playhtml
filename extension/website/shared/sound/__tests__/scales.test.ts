// ABOUTME: Tests the chord palettes behind the movement visualization's harmony.
// ABOUTME: Verifies every rotating chord stays diatonic to D natural minor and in register.

import { describe, expect, it } from "vitest";
import {
  bellScaleForChord,
  CHORD_PROGRESSION,
  DEFAULT_PROGRESSION_ID,
  D_DORIAN_PITCHES,
  D_NATURAL_MINOR_PITCHES,
  directionToPitch,
  isPitchInCollection,
  PITCH_COLLECTIONS,
  upperNeighbor,
  progressionById,
  PROGRESSION_IDS,
  PROGRESSIONS,
  hashIdentity,
  hashUnit,
  homeToneForHash,
  foldPitchIntoBand,
  leadHomeTone,
  REGISTER_BANDS,
  REGISTER_BAND_RANGES,
  registerBandForHue,
  scaleForChord,
  semitonesBetween,
} from "../scales";

const DIATONIC_PITCHES = new Set(Object.values(D_NATURAL_MINOR_PITCHES));

/** The register the fixed palette occupies, which rotation must not leave. */
const LOWEST_HZ = D_NATURAL_MINOR_PITCHES.D3;
const HIGHEST_HZ = D_NATURAL_MINOR_PITCHES.C5;

describe("progression library", () => {
  it("keeps every palette inside its own progression's collection", () => {
    // Transposing a pentatonic shape onto each root is what made a rotation
    // sound chromatic: Bb yielded Db/Eb/Ab against a D minor context. The
    // collection is per-progression, so B natural is legal in dorian and
    // nowhere else.
    for (const id of PROGRESSION_IDS) {
      const { chords, collection } = PROGRESSIONS[id];
      for (const chord of chords) {
        for (const pitch of chord.pitches) {
          expect(
            isPitchInCollection(pitch, collection),
            `${id}/${chord.name}: ${pitch}Hz is outside ${collection}`,
          ).toBe(true);
        }
      }
    }
  });

  it("admits B natural in dorian and rejects it everywhere else", () => {
    const bNatural = D_DORIAN_PITCHES.B3;
    expect(isPitchInCollection(bNatural, "dorian")).toBe(true);
    expect(isPitchInCollection(bNatural, "naturalMinor")).toBe(false);
    // And the converse: Bb belongs to natural minor, not to dorian.
    expect(isPitchInCollection(P("Bb3"), "naturalMinor")).toBe(true);
    expect(isPitchInCollection(P("Bb3"), "dorian")).toBe(false);
  });

  it("spells the dorian G chord with a B natural", () => {
    // The whole point of the dorian rotation: a major fourth, which needs the
    // raised sixth of the mode to exist at all.
    const g = PROGRESSIONS.dorian.chords.find((c) => c.name === "G")!;
    expect(g.pitches).toContain(D_DORIAN_PITCHES.B3);
    expect(g.pitches).not.toContain(P("Bb3"));
  });

  it("keeps every progression inside the base register", () => {
    for (const id of PROGRESSION_IDS) {
      for (const chord of PROGRESSIONS[id].chords) {
        for (const pitch of chord.pitches) {
          expect(pitch).toBeGreaterThanOrEqual(LOWEST_HZ);
          expect(pitch).toBeLessThanOrEqual(HIGHEST_HZ);
        }
      }
    }
  });

  it("gives every progression eight pitches per palette", () => {
    // The compass mapping reads eight scale degrees, so a short palette would
    // leave some directions silent.
    for (const id of PROGRESSION_IDS) {
      for (const chord of PROGRESSIONS[id].chords) {
        expect(chord.pitches).toHaveLength(8);
      }
    }
  });

  it("matches the named chord sequence Spencer picked", () => {
    const names = (id: (typeof PROGRESSION_IDS)[number]) =>
      PROGRESSIONS[id].chords.map((c) => c.name);
    expect(names("circular")).toEqual(["Dm", "Bb", "F", "C"]);
    expect(names("drifter")).toEqual(["Dm", "C", "Bb", "C"]);
    expect(names("lament")).toEqual(["Dm", "Gm", "Bb", "Am"]);
    expect(names("dorian")).toEqual(["Dm", "G", "C", "Dm"]);
    expect(names("breath")).toEqual(["Dm", "Bb"]);
  });

  it("holds the two-chord rotation twice as long", () => {
    expect(PROGRESSIONS.breath.dwellScale).toBe(2);
    for (const id of PROGRESSION_IDS) {
      if (id === "breath") continue;
      expect(PROGRESSIONS[id].dwellScale).toBe(1);
    }
  });

  it("defaults to circular and resolves an unknown id back to it", () => {
    expect(DEFAULT_PROGRESSION_ID).toBe("circular");
    expect(CHORD_PROGRESSION).toBe(PROGRESSIONS.circular.chords);
    expect(progressionById(undefined)).toBe(PROGRESSIONS.circular);
    expect(progressionById("lament")).toBe(PROGRESSIONS.lament);
    expect(
      progressionById("nonexistent" as (typeof PROGRESSION_IDS)[number]),
    ).toBe(PROGRESSIONS.circular);
  });

  it("supplies a pitch for every compass direction in every progression", () => {
    for (const id of PROGRESSION_IDS) {
      for (const chord of PROGRESSIONS[id].chords) {
        const scale = scaleForChord(chord);
        for (let step = 0; step < 8; step++) {
          const angle = (step / 8) * Math.PI * 2;
          expect(directionToPitch(angle, scale)).toBeGreaterThan(0);
        }
      }
    }
  });

  it("rings bells from the top of every progression's chords", () => {
    for (const id of PROGRESSION_IDS) {
      for (const chord of PROGRESSIONS[id].chords) {
        const bells = bellScaleForChord(chord);
        expect(bells).toHaveLength(6);
        for (const pitch of bells) {
          expect(chord.pitches).toContain(pitch);
        }
        for (let i = 1; i < bells.length; i++) {
          expect(bells[i]).toBeGreaterThan(bells[i - 1]);
        }
      }
    }
  });

  it("leads home tones across every progression without leaping", () => {
    // Voice leading has to work in all of them, including the dorian one whose
    // collection differs.
    for (const id of PROGRESSION_IDS) {
      const { chords } = PROGRESSIONS[id];
      let home = homeToneForHash(hashIdentity("person-a"), chords[0].pitches);
      for (let turn = 1; turn <= chords.length * 2; turn++) {
        const next = chords[turn % chords.length];
        const led = leadHomeTone(home, next.pitches);
        expect(next.pitches).toContain(led);
        expect(Math.abs(semitonesBetween(home, led))).toBeLessThanOrEqual(4);
        home = led;
      }
    }
  });
});

describe("chord palettes", () => {
  it("draws every pitch from D natural minor", () => {
    for (const chord of CHORD_PROGRESSION) {
      for (const pitch of chord.pitches) {
        expect(DIATONIC_PITCHES).toContain(pitch);
      }
    }
  });

  it("keeps every chord inside the base register", () => {
    for (const chord of CHORD_PROGRESSION) {
      for (const pitch of chord.pitches) {
        expect(pitch).toBeGreaterThanOrEqual(LOWEST_HZ);
        expect(pitch).toBeLessThanOrEqual(HIGHEST_HZ);
      }
    }
  });

  it("supplies a pitch for every compass direction", () => {
    for (const chord of CHORD_PROGRESSION) {
      const scale = scaleForChord(chord);
      for (let step = 0; step < 8; step++) {
        const angle = (step / 8) * Math.PI * 2;
        expect(directionToPitch(angle, scale)).toBeGreaterThan(0);
      }
    }
  });

  it("puts each chord's own tones on the first four directions", () => {
    // The compass mapping fills indices 0-3 first, so chord tones there mean a
    // typical gesture lands on the harmony rather than on a colour note.
    const chordTones: Record<string, number[]> = {
      Dm: [P("D3"), P("F3"), P("A3"), P("D4"), P("F4"), P("A4")],
      Bb: [P("Bb3"), P("D3"), P("F3"), P("D4"), P("F4"), P("Bb4")],
      F: [P("F3"), P("A3"), P("C4"), P("F4"), P("A4"), P("C5")],
      C: [P("C4"), P("E3"), P("G3"), P("E4"), P("G4"), P("C5")],
    };

    for (const chord of CHORD_PROGRESSION) {
      const tones = new Set(chordTones[chord.name]);
      for (const pitch of chord.pitches.slice(0, 3)) {
        expect(tones).toContain(pitch);
      }
    }
  });

  it("rings bells from the top of the active chord", () => {
    for (const chord of CHORD_PROGRESSION) {
      const bells = bellScaleForChord(chord);
      expect(bells).toHaveLength(6);
      for (const pitch of bells) {
        expect(chord.pitches).toContain(pitch);
      }
      // Ascending, so the click's y-position maps monotonically to pitch.
      for (let i = 1; i < bells.length; i++) {
        expect(bells[i]).toBeGreaterThan(bells[i - 1]);
      }
    }
  });

  it("hashes an identity deterministically and spreads distinct keys", () => {
    expect(hashIdentity("person-a")).toBe(hashIdentity("person-a"));
    expect(hashIdentity("person-a")).not.toBe(hashIdentity("person-b"));

    // A realistic identity population must not collapse onto a few values, or
    // whole groups of trails would share one voice.
    const keys = Array.from({ length: 200 }, (_, i) => `pk_${i}#https://a.b/c`);
    const hashes = new Set(keys.map(hashIdentity));
    expect(hashes.size).toBe(keys.length);
  });

  it("derives independent unit values from one hash", () => {
    const hash = hashIdentity("person-a");
    const values = [0, 1, 2, 3, 4].map((salt) => hashUnit(hash, salt));

    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    // Different salts must not move together, or detune, vibrato and attack
    // would all be the same knob wearing different names.
    expect(new Set(values).size).toBe(values.length);
    expect(hashUnit(hash, 2)).toBe(hashUnit(hash, 2));
  });

  it("picks a home tone inside whichever palette is in force", () => {
    const hash = hashIdentity("person-a");
    for (const chord of CHORD_PROGRESSION) {
      const home = homeToneForHash(hash, chord.pitches);
      expect(chord.pitches).toContain(home);
    }
    // Stable within one palette.
    expect(homeToneForHash(hash, CHORD_PROGRESSION[0].pitches)).toBe(
      homeToneForHash(hash, CHORD_PROGRESSION[0].pitches),
    );
  });

  it("spreads home tones across the palette rather than crowding one seat", () => {
    const palette = CHORD_PROGRESSION[0].pitches;
    const homes = new Set(
      Array.from({ length: 200 }, (_, i) =>
        homeToneForHash(hashIdentity(`pk_${i}`), palette),
      ),
    );
    // A crowd should collectively voice the chord, so every seat gets taken.
    expect(homes.size).toBe(palette.length);
  });
});

describe("register bands", () => {
  it("maps each hue quadrant to its choral part, warm low to cool high", () => {
    // The cross-modal contract: the colour you see is the register you hear.
    expect(registerBandForHue(0)).toBe("bass");
    expect(registerBandForHue(45)).toBe("bass");
    expect(registerBandForHue(90)).toBe("tenor");
    expect(registerBandForHue(179)).toBe("tenor");
    expect(registerBandForHue(180)).toBe("alto");
    expect(registerBandForHue(269)).toBe("alto");
    expect(registerBandForHue(270)).toBe("soprano");
    expect(registerBandForHue(359)).toBe("soprano");
  });

  it("wraps hues outside 0-360 rather than falling off an end", () => {
    expect(registerBandForHue(360)).toBe(registerBandForHue(0));
    expect(registerBandForHue(-10)).toBe(registerBandForHue(350));
    expect(registerBandForHue(730)).toBe(registerBandForHue(10));
  });

  it("is deterministic for a given hue", () => {
    for (const hue of [0, 37, 120, 200, 300]) {
      expect(registerBandForHue(hue)).toBe(registerBandForHue(hue));
    }
  });

  it("orders the bands low to high without gaps", () => {
    // Adjacent bands overlap the way real voice parts do; a hard split at the
    // octave makes the crowd read as four instruments rather than one choir.
    for (let i = 1; i < REGISTER_BANDS.length; i++) {
      const lower = REGISTER_BAND_RANGES[REGISTER_BANDS[i - 1]];
      const upper = REGISTER_BAND_RANGES[REGISTER_BANDS[i]];
      expect(upper.minHz).toBeGreaterThan(lower.minHz);
      expect(upper.minHz).toBeLessThan(lower.maxHz);
    }
  });

  it("folds every palette tone into every band and keeps it there", () => {
    for (const band of REGISTER_BANDS) {
      const { minHz, maxHz } = REGISTER_BAND_RANGES[band];
      for (const chord of CHORD_PROGRESSION) {
        for (const pitch of chord.pitches) {
          const folded = foldPitchIntoBand(pitch, band);
          expect(folded).toBeGreaterThanOrEqual(minHz);
          expect(folded).toBeLessThanOrEqual(maxHz);
        }
      }
    }
  });

  it("folds by octave, so a tone keeps its pitch class", () => {
    for (const band of REGISTER_BANDS) {
      for (const pitch of CHORD_PROGRESSION[0].pitches) {
        const octaves = Math.log2(foldPitchIntoBand(pitch, band) / pitch);
        expect(Math.abs(octaves - Math.round(octaves))).toBeLessThan(1e-9);
      }
    }
  });

  it("leaves a pitch already inside its band untouched", () => {
    // D4 sits inside alto, so folding is a no-op rather than an octave move.
    expect(foldPitchIntoBand(P("D4"), "alto")).toBe(P("D4"));
  });

  it("spreads a mixed-hue crowd across all four parts", () => {
    // The point of the whole feature: a crowd arranged rather than crowded
    // into one octave.
    const hues = [10, 60, 100, 150, 200, 250, 290, 340];
    expect(new Set(hues.map(registerBandForHue)).size).toBe(4);
  });
});

describe("diatonic upper neighbour", () => {
  it("finds the next step up inside the collection", () => {
    expect(upperNeighbor(P("D3"), "naturalMinor")).toBe(P("E3"));
    expect(upperNeighbor(P("A3"), "naturalMinor")).toBe(P("Bb3"));
    expect(upperNeighbor(P("G4"), "naturalMinor")).toBe(P("A4"));
  });

  it("takes the sixth from the collection in force", () => {
    // The one note that separates the two collections, and the reason the
    // suspension has to know which one it is drawing from.
    expect(upperNeighbor(P("A3"), "naturalMinor")).toBe(P("Bb3"));
    expect(upperNeighbor(D_DORIAN_PITCHES.A3, "dorian")).toBe(
      D_DORIAN_PITCHES.B3,
    );
  });

  it("never returns a leap — every neighbour is a step", () => {
    for (const collection of ["naturalMinor", "dorian"] as const) {
      for (const pitch of Object.values(PITCH_COLLECTIONS[collection])) {
        const neighbor = upperNeighbor(pitch, collection);
        if (neighbor === null) continue;
        const step = semitonesBetween(pitch, neighbor);
        expect(step).toBeGreaterThan(0);
        // A step is a semitone or a whole tone; anything wider would be a
        // chord tone, and the figure would stop being a suspension.
        expect(step).toBeLessThanOrEqual(2.5);
      }
    }
  });

  it("returns null at the top of the collection", () => {
    expect(upperNeighbor(P("C5"), "naturalMinor")).toBeNull();
    expect(upperNeighbor(P("C5") * 4, "naturalMinor")).toBeNull();
  });
});

describe("voice leading", () => {
  it("measures distance in semitones, not in Hz", () => {
    expect(semitonesBetween(P("D3"), P("D4"))).toBeCloseTo(12, 5);
    expect(semitonesBetween(P("D4"), P("D3"))).toBeCloseTo(-12, 5);
    expect(semitonesBetween(P("D3"), P("E3"))).toBeCloseTo(2, 1);
  });

  it("moves a home tone to the nearest tone of the new palette", () => {
    // A3 is not in the Bb palette; the nearest tones are G3 (2 semitones down)
    // and Bb3 (1 semitone up), so the lead takes Bb3.
    const bb = CHORD_PROGRESSION.find((c) => c.name === "Bb")!;
    expect(leadHomeTone(P("A3"), bb.pitches)).toBe(P("Bb3"));
  });

  it("holds still when the tone is already in the new palette", () => {
    const f = CHORD_PROGRESSION.find((c) => c.name === "F")!;
    expect(leadHomeTone(P("F3"), f.pitches)).toBe(P("F3"));
  });

  it("breaks an equal-distance tie downward", () => {
    // D4 sits exactly two semitones from C4 below and E4 above, so the tie
    // must resolve down: the ensemble should settle rather than climb.
    const scale = [P("C4"), P("E4")];
    expect(leadHomeTone(P("D4"), scale)).toBe(P("C4"));
    // Order-independent — the lower tone wins whichever way the palette is
    // listed, so a palette that is not sorted still leads the same way.
    expect(leadHomeTone(P("D4"), [P("E4"), P("C4")])).toBe(P("C4"));
  });

  it("moves by small steps rather than leaping across the register", () => {
    // The point of leading: a trail's home tone walks, so no single chord
    // change should throw it more than a few semitones.
    let home = homeToneForHash(hashIdentity("person-a"), CHORD_PROGRESSION[0].pitches);
    for (let turn = 0; turn < 12; turn++) {
      const next = CHORD_PROGRESSION[(turn + 1) % CHORD_PROGRESSION.length];
      const led = leadHomeTone(home, next.pitches);
      expect(Math.abs(semitonesBetween(home, led))).toBeLessThanOrEqual(3);
      expect(next.pitches).toContain(led);
      home = led;
    }
  });

  it("leaves an empty palette alone rather than inventing a pitch", () => {
    expect(leadHomeTone(P("D4"), [])).toBe(P("D4"));
  });
});

function P(name: string): number {
  return D_NATURAL_MINOR_PITCHES[name];
}
