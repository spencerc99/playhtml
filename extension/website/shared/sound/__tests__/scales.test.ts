// ABOUTME: Tests the chord palettes behind the movement visualization's harmony.
// ABOUTME: Verifies every rotating chord stays diatonic to D natural minor and in register.

import { describe, expect, it } from "vitest";
import {
  bellScaleForChord,
  CHORD_PROGRESSION,
  D_NATURAL_MINOR_PITCHES,
  directionToPitch,
  hashIdentity,
  hashUnit,
  homeToneForHash,
  leadHomeTone,
  scaleForChord,
  semitonesBetween,
} from "../scales";

const DIATONIC_PITCHES = new Set(Object.values(D_NATURAL_MINOR_PITCHES));

/** The register the fixed palette occupies, which rotation must not leave. */
const LOWEST_HZ = D_NATURAL_MINOR_PITCHES.D3;
const HIGHEST_HZ = D_NATURAL_MINOR_PITCHES.C5;

describe("chord palettes", () => {
  it("draws every pitch from D natural minor", () => {
    // Transposing a pentatonic shape onto each root is what made the rotation
    // sound chromatic: Bb yielded Db/Eb/Ab against a D minor context.
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
